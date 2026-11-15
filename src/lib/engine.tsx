import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EXTRACTORS,
  PURITY_MULT,
  POWER_EXPONENT,
  RECIPES,
  RECIPES_BY_MAIN,
  RESOURCES,
  BELTS,
  PIPES,
  isRaw,
  extractorsFor,
  type Recipe,
} from './gamedata';
import { allowedRecipeSet, allUnlockedSet, isAvailable } from './recipes';
import { computeMetric, type SolveRequest, type SolveResult } from './solverTypes';
import { mainLane, adviceLane } from './solverClient';
import { analyze, roundUpTo, type Analysis } from './analysis';
import type { NodeEntry, Plan, Settings } from './types';

export function nodeRate(n: NodeEntry): number {
  const ex = EXTRACTORS.find((e) => e.id === n.extractor);
  if (!ex) return 0;
  return ex.base * PURITY_MULT[n.purity] * (n.clock / 100) * n.count;
}

export function limitsOf(plan: Plan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of plan.inputs) if (l.item && l.rate >= 0) out[l.item] = (out[l.item] ?? 0) + l.rate;
  for (const n of plan.nodes) out[n.resource] = (out[n.resource] ?? 0) + nodeRate(n);
  return out;
}

/** MW per unit/min of each raw resource, from your default extraction setup */
export function extractPowerMap(s: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  const miner = EXTRACTORS.find((e) => e.id === s.minerId) ?? EXTRACTORS[2];
  const c = s.minerClock / 100;
  for (const r of Object.values(RESOURCES)) {
    if (r.solid) {
      const rate = miner.base * PURITY_MULT[s.purity] * c;
      out[r.id] = (miner.power * Math.pow(c, POWER_EXPONENT)) / rate;
    }
  }
  out['Desc_Water_C'] = 20 / 120;
  out['Desc_LiquidOil_C'] = 40 / 120;
  out['Desc_NitrogenGas_C'] = 150 / 300;
  return out;
}

export function buildRequest(plan: Plan, settings: Settings, over: Partial<SolveRequest> = {}): SolveRequest {
  return {
    targets: plan.targets.filter((t) => t.item && (t.rate > 0 || t.max)).map((t) => ({ item: t.item, rate: t.rate, max: !!t.max })),
    limits: limitsOf(plan),
    allowed: allowedRecipeSet(plan, settings),
    objective: plan.objective,
    reuse: plan.reuse,
    sloops: plan.sloops,
    selfPower: plan.selfPower,
    extractPower: extractPowerMap(settings),
    mode: plan.objective === 'output' || plan.targets.some((t) => t.item && t.max) ? 'max' : 'target',
    ...over,
  };
}

/** Suggested extractors for a raw resource rate, using your default miner setup */
export function extractionPlan(resource: string, rate: number, s: Settings) {
  const res = RESOURCES[resource];
  const options = extractorsFor(resource).filter((e) => e.tier <= s.tier);
  let ex = res?.solid ? EXTRACTORS.find((e) => e.id === s.minerId) : options[options.length - 1];
  if (!ex || ex.tier > s.tier) ex = options[options.length - 1];
  if (!ex) return null;
  const purity = res?.solid ? s.purity : 'normal';
  const maxClock = res?.solid ? s.minerClock : 100;
  let perNodeMax = ex.base * PURITY_MULT[purity] * (maxClock / 100);
  const belt = maxBelt(s.tier);
  if (res?.solid) perNodeMax = Math.min(perNodeMax, belt.rate);
  const n = Math.max(1, Math.ceil(rate / perNodeMax - 1e-9));
  const clock = Math.min(250, roundUpTo((rate / (n * ex.base * PURITY_MULT[purity])) * 100, s.clockDecimals));
  const shards = Math.max(0, Math.ceil((clock - 100 - 1e-9) / 50));
  const power = n * ex.power * Math.pow(clock / 100, POWER_EXPONENT);
  return { ex, n, clock, shards, purity, power };
}


export const maxBelt = (tier: number) => [...BELTS].reverse().find((b) => b.tier <= tier) ?? BELTS[0];
export const maxPipe = (tier: number) => [...PIPES].reverse().find((b) => b.tier <= tier) ?? PIPES[0];

// ------------------------------------------------------------------------------------------

export interface Suggestion {
  recipe: Recipe;
  item: string;
  metric: number;
  gain: number;
  gainPct: number;
  rawDelta: Record<string, number>;
  buildingsDelta: number;
  powerDelta: number;
  locked: boolean;
}

export interface Advice {
  running: boolean;
  done: number;
  total: number;
  suggestions: Suggestion[];
  advisor: Suggestion[];
  all: { metric: number; gainPct: number; recipes: Recipe[] } | null;
}

interface Ctx {
  plan: Plan;
  settings: Settings;
  req: SolveRequest;
  result: SolveResult | null;
  analysis: Analysis | null;
  maxResult: SolveResult | null;
  loading: boolean;
  advice: Advice;
}

const SolutionContext = createContext<Ctx | null>(null);
export const useSolution = () => {
  const c = useContext(SolutionContext);
  if (!c) throw new Error('no solution context');
  return c;
};

const reqKey = (r: SolveRequest) => JSON.stringify({ ...r, allowed: [...r.allowed].sort() });

export function SolutionProvider({ plan, settings, children }: { plan: Plan; settings: Settings; children: ReactNode }) {
  const req = useMemo(() => buildRequest(plan, settings), [plan, settings]);
  // Settings (unlocks, tier) change what the advisor tests even when the plan itself doesn't change
  const key = useMemo(
    () => reqKey(req) + JSON.stringify([settings.unlockedAlts, settings.mamOff, settings.tier, plan.allowConverter]),
    [req, settings, plan.allowConverter],
  );
  const [result, setResult] = useState<SolveResult | null>(null);
  const [maxResult, setMaxResult] = useState<SolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<Advice>({ running: false, done: 0, total: 0, suggestions: [], advisor: [], all: null });
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      if (mainLane.busy) mainLane.cancel();
      adviceLane.cancel();
      try {
        const res = await mainLane.solve(req);
        if (gen.current !== my) return;
        setResult(res);
        let mx: SolveResult | null = null;
        if (Object.keys(req.limits).length && req.mode === 'target' && res.status === 'ok') {
          mx = await mainLane.solve({ ...req, mode: 'max', objective: 'output' });
          if (gen.current !== my) return;
        }
        setMaxResult(mx);
        setLoading(false);
        if (res.status === 'ok') runAdvice(my, req, res);
        else setAdvice({ running: false, done: 0, total: 0, suggestions: [], advisor: [], all: null });
      } catch {
        /* cancelled */
      }
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function runAdvice(my: number, base: SolveRequest, baseRes: SolveResult) {
    // Candidate recipes: other ways to make the items this plan makes
    const planItems = new Set<string>();
    for (const k of Object.keys(baseRes.x)) {
      const id = k.split('#')[0];
      const r = RECIPES[id];
      if (r) planItems.add(r.out[0][0]);
    }
    for (const it of Object.keys(baseRes.supply)) if (isRaw(it)) planItems.add(it);
    const unlockedCands: Recipe[] = [];
    const lockedCands: Recipe[] = [];
    for (const it of planItems) {
      for (const r of RECIPES_BY_MAIN[it] ?? []) {
        if (base.allowed.has(r.id)) continue;
        if (r.kind === 'unpackage') continue;
        if (r.kind === 'convert' && !plan.allowConverter) continue;
        if (isAvailable(r, settings)) unlockedCands.push(r);
        else if (r.alt && r.tier <= settings.tier) lockedCands.push(r);
      }
    }
    const total = unlockedCands.length + lockedCands.length + (unlockedCands.length ? 1 : 0);
    const state: Advice = { running: true, done: 0, total, suggestions: [], advisor: [], all: null };
    setAdvice({ ...state });
    const timeLimit = base.objective === 'simple' || base.objective === 'buildings' ? 2 : 4;
    const maximizing = base.mode === 'max';
    const better = (m: number) => (maximizing ? m - baseRes.metric : baseRes.metric - m);
    const pct = (g: number) => (baseRes.metric ? (100 * g) / Math.abs(baseRes.metric) : 0);
    const minGain = !maximizing && (base.objective === 'simple' || base.objective === 'buildings') ? 0.5 : Math.abs(baseRes.metric) * 0.002;
    const basePower = computeMetric({ objective: 'power', extractPower: base.extractPower }, baseRes);
    const baseBuildings = computeMetric({ objective: 'buildings', extractPower: base.extractPower }, baseRes);

    const evaluate = async (r: Recipe, locked: boolean) => {
      const allowed = new Set(base.allowed);
      allowed.add(r.id);
      const res = await adviceLane.solve({ ...base, allowed, timeLimit });
      if (gen.current !== my || res.status !== 'ok') return;
      if (Object.keys(res.missing).length > Object.keys(baseRes.missing).length) return;
      const used = Object.keys(res.x).some((k) => k.split('#')[0] === r.id);
      const g = better(res.metric);
      if (!used || g < minGain) return;
      const rawDelta: Record<string, number> = {};
      const keys = new Set([...Object.keys(res.supply), ...Object.keys(baseRes.supply)]);
      for (const k of keys) if (isRaw(k)) {
        const d = (res.supply[k] ?? 0) - (baseRes.supply[k] ?? 0);
        if (Math.abs(d) > 1e-4) rawDelta[k] = d;
      }
      const sug: Suggestion = {
        recipe: r,
        item: r.out[0][0],
        metric: res.metric,
        gain: g,
        gainPct: pct(g),
        rawDelta,
        buildingsDelta: computeMetric({ objective: 'buildings', extractPower: base.extractPower }, res) - baseBuildings,
        powerDelta: computeMetric({ objective: 'power', extractPower: base.extractPower }, res) - basePower,
        locked,
      };
      (locked ? state.advisor : state.suggestions).push(sug);
    };

    try {
      if (unlockedCands.length) {
        const allowed = new Set([...base.allowed, ...allUnlockedSet(plan, settings)]);
        const res = await adviceLane.solve({ ...base, allowed, timeLimit });
        state.done++;
        if (gen.current !== my) return;
        if (res.status === 'ok') {
          const g = better(res.metric);
          const recipes = Object.keys(res.x)
            .map((k) => RECIPES[k.split('#')[0]])
            .filter((r) => r && !base.allowed.has(r.id));
          if (g >= minGain && recipes.length) state.all = { metric: res.metric, gainPct: pct(g), recipes: [...new Set(recipes)] };
        }
        setAdvice({ ...state });
      }
      for (const r of unlockedCands) {
        await evaluate(r, false);
        state.done++;
        if (gen.current !== my) return;
        state.suggestions.sort((a, b) => b.gain - a.gain);
        setAdvice({ ...state, suggestions: [...state.suggestions] });
      }
      for (const r of lockedCands) {
        await evaluate(r, true);
        state.done++;
        if (gen.current !== my) return;
        state.advisor.sort((a, b) => b.gain - a.gain);
        setAdvice({ ...state, advisor: [...state.advisor] });
      }
      state.running = false;
      setAdvice({ ...state });
    } catch {
      /* cancelled */
    }
  }

  const analysis = useMemo(
    () => (result && result.status === 'ok' ? analyze(result, settings.clockDecimals, req.extractPower) : null),
    [result, settings.clockDecimals, req.extractPower],
  );
  if (analysis) for (const b of analysis.byproducts) b.allowed = !!plan.reuse[b.item];

  const value: Ctx = { plan, settings, req, result, analysis, maxResult, loading, advice };
  return <SolutionContext.Provider value={value}>{children}</SolutionContext.Provider>;
}
