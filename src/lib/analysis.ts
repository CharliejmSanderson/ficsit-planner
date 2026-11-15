/** Turns a solver result into everything the views show: build steps, flows, tree, graph, byproducts. */
import {
  BUILDINGS,
  ITEMS,
  POWER,
  POWER_EXPONENT,
  RECIPES,
  RECIPES_BY_INGREDIENT,
  RESOURCE_WEIGHT,
  WATER,
  isRaw,
  recipePower,
  type Recipe,
} from './gamedata';
import { vrecipeFromKey, type SolveResult } from './solverTypes';

export interface Step {
  key: string;
  recipe: Recipe;
  sloop: boolean;
  /** machines needed at 100% clock */
  machines: number;
  /** machines to build */
  count: number;
  /** clock for every machine, rounded UP to the game's precision */
  clock: number;
  /** alternative: (count-1) at 100% and one at partialClock */
  partialClock: number;
  /** MW for count machines at clock */
  power: number;
  /** MW produced (generators) */
  generated: number;
  inputs: [string, number][];
  outputs: [string, number][];
}

export interface ItemFlow {
  item: string;
  produced: number;
  byproduct: number;
  consumed: number;
  supplied: number;
  reused: number;
  output: number;
  surplus: number;
  waste: number;
  shortfall: number;
  missing: number;
}

export interface ByproductInfo {
  item: string;
  produced: number;
  reused: number;
  waste: number;
  allowed: boolean;
  forced: boolean;
  /** this factory also uses the item (consumption, output or raw supply that reuse could replace) */
  usableHere: boolean;
  demandHere: number;
  sources: string[];
}

export interface Analysis {
  ok: boolean;
  steps: Step[];
  stepByKey: Record<string, Step>;
  flows: Record<string, ItemFlow>;
  raw: [string, number][];
  provided: [string, number][];
  productionPower: number;
  extractionPower: number;
  generatedPower: number;
  buildings: Record<string, number>;
  byproducts: ByproductInfo[];
  embodied: Record<string, Record<string, number>>;
}

export const roundUpTo = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.ceil(v * f - 1e-6) / f;
};

export function analyze(res: SolveResult, decimals: number, extractPower: Record<string, number>): Analysis {
  const flows: Record<string, ItemFlow> = {};
  const flow = (item: string) =>
    (flows[item] ??= { item, produced: 0, byproduct: 0, consumed: 0, supplied: 0, reused: 0, output: 0, surplus: 0, waste: 0, shortfall: 0, missing: 0 });

  const steps: Step[] = [];
  for (const [key, machines] of Object.entries(res.x)) {
    const vr = vrecipeFromKey(key);
    if (!vr || machines < 1e-6) continue;
    const count = Math.max(1, Math.ceil(machines - 1e-6));
    const clock = Math.min(250, roundUpTo((machines / count) * 100, decimals));
    const partial = roundUpTo((machines - (count - 1)) * 100, decimals);
    const baseP = recipePower(vr.recipe) * vr.powerMult;
    const power = count * baseP * Math.pow(clock / 100, POWER_EXPONENT);
    const genMW = BUILDINGS[vr.recipe.building]?.produces ?? 0;
    const step: Step = {
      key,
      recipe: vr.recipe,
      sloop: vr.outMult > 1,
      machines,
      count,
      clock,
      partialClock: partial,
      power,
      generated: vr.recipe.kind === 'power' ? genMW * machines : 0,
      inputs: vr.recipe.in.map(([it, r]) => [it, r * machines]),
      outputs: vr.recipe.out.filter(([it]) => it !== POWER).map(([it, r]) => [it, r * vr.outMult * machines]),
    };
    steps.push(step);
    step.inputs.forEach(([it, r]) => (flow(it).consumed += r));
    step.outputs.forEach(([it, r], idx) => {
      if (idx === 0 && vr.recipe.out[0][0] === it) flow(it).produced += r;
      else flow(it).byproduct += r;
    });
  }
  steps.sort((a, b) => a.recipe.tier - b.recipe.tier || a.recipe.name.localeCompare(b.recipe.name));
  for (const [it, v] of Object.entries(res.supply)) flow(it).supplied += v;
  for (const [it, v] of Object.entries(res.reused)) flow(it).reused += v;
  for (const [it, v] of Object.entries(res.outputs)) if (it !== POWER) flow(it).output += v;
  for (const [it, v] of Object.entries(res.shortfall)) flow(it).shortfall += v;
  for (const [it, v] of Object.entries(res.missing)) flow(it).missing += v;
  for (const f of Object.values(flows)) {
    f.waste = Math.max(0, f.byproduct - f.reused);
    f.surplus = Math.max(0, f.produced + f.reused + f.supplied + f.missing - f.consumed - f.output);
    if (f.surplus < 1e-6) f.surplus = 0;
    if (f.waste < 1e-6) f.waste = 0;
  }

  const raw = Object.entries(res.supply)
    .filter(([it, v]) => isRaw(it) && v > 1e-6)
    .sort((a, b) => b[1] - a[1]);
  const provided = Object.entries(res.supply)
    .filter(([it, v]) => !isRaw(it) && v > 1e-6)
    .sort((a, b) => b[1] - a[1]);

  const productionPower = steps.reduce((a, s) => a + s.power, 0);
  const generatedPower = steps.reduce((a, s) => a + s.generated, 0);
  let extractionPower = 0;
  for (const [it, v] of raw) extractionPower += (extractPower[it] ?? 0) * v;

  const buildings: Record<string, number> = {};
  for (const s of steps) buildings[s.recipe.building] = (buildings[s.recipe.building] ?? 0) + s.count;

  // Byproducts
  const byproducts: ByproductInfo[] = [];
  for (const f of Object.values(flows)) {
    if (f.byproduct < 1e-6) continue;
    const otherDemand = f.consumed + f.output - f.reused;
    const sources = steps.filter((s) => s.outputs.slice(1).some(([it]) => it === f.item) || (s.outputs[0]?.[0] === f.item && s.recipe.out[0][0] !== f.item)).map((s) => s.key);
    byproducts.push({
      item: f.item,
      produced: f.byproduct,
      reused: f.reused,
      waste: f.waste,
      allowed: false,
      forced: res.forcedReuse.includes(f.item),
      usableHere: otherDemand > 1e-6 && f.waste > 1e-6,
      demandHere: Math.max(0, otherDemand),
      sources,
    });
  }

  const stepByKey: Record<string, Step> = {};
  for (const s of steps) stepByKey[s.key] = s;

  const a: Analysis = {
    ok: res.status === 'ok',
    steps,
    stepByKey,
    flows,
    raw,
    provided,
    productionPower,
    extractionPower,
    generatedPower,
    buildings,
    byproducts,
    embodied: {},
  };
  a.embodied = computeEmbodied(a);
  return a;
}

// ------------------------------------------------------------------------------------------
// Sources of an item (used by tree, graph and embodied-resource calculations)

export interface Source {
  kind: 'step' | 'reuse' | 'supply' | 'missing';
  key: string;
  amount: number;
}

export function sourcesOf(a: Analysis, item: string): Source[] {
  const out: Source[] = [];
  const f = a.flows[item];
  if (!f) return out;
  for (const s of a.steps) {
    if (s.recipe.out[0][0] === item && s.outputs[0]) out.push({ kind: 'step', key: s.key, amount: s.outputs[0][1] });
  }
  if (f.reused > 1e-9) out.push({ kind: 'reuse', key: item, amount: f.reused });
  if (f.supplied > 1e-9) out.push({ kind: 'supply', key: item, amount: f.supplied });
  if (f.missing > 1e-9) out.push({ kind: 'missing', key: item, amount: f.missing });
  return out;
}

/** Raw resources embodied in one unit of each item (proportional to how this plan sources it). */
function computeEmbodied(a: Analysis): Record<string, Record<string, number>> {
  const memo: Record<string, Record<string, number>> = {};
  const visiting = new Set<string>();
  const calc = (item: string): Record<string, number> => {
    if (memo[item]) return memo[item];
    if (visiting.has(item)) return {};
    visiting.add(item);
    const result: Record<string, number> = {};
    const srcs = sourcesOf(a, item);
    const total = srcs.reduce((x, s) => x + s.amount, 0);
    if (total > 0) {
      for (const s of srcs) {
        const share = s.amount / total;
        if (s.kind === 'supply' && isRaw(item)) result[item] = (result[item] ?? 0) + share;
        if (s.kind === 'step') {
          const st = a.stepByKey[s.key];
          const mainOut = st.outputs[0][1];
          for (const [ing, r] of st.inputs) {
            const e = calc(ing);
            for (const [raw, v] of Object.entries(e)) result[raw] = (result[raw] ?? 0) + (share * v * r) / mainOut;
          }
        }
      }
    }
    visiting.delete(item);
    memo[item] = result;
    return result;
  };
  for (const it of Object.keys(a.flows)) calc(it);
  return memo;
}

export const weightedRaw = (v: Record<string, number>) =>
  Object.entries(v).reduce((acc, [it, x]) => acc + (it === WATER ? 0 : (RESOURCE_WEIGHT[it] ?? 0) * x), 0);
export const totalRaw = (v: Record<string, number>) =>
  Object.entries(v).reduce((acc, [it, x]) => acc + (it === WATER ? 0 : x), 0);

// ------------------------------------------------------------------------------------------
// Tree

export interface TreeItem {
  id: string;
  item: string;
  rate: number;
  sources: TreeSource[];
}
export interface TreeSource {
  kind: 'step' | 'reuse' | 'supply' | 'missing' | 'loop';
  rate: number;
  stepKey?: string;
  machines?: number;
  children: TreeItem[];
  byproducts: [string, number][];
}

export function buildTree(a: Analysis, targets: [string, number][]): TreeItem[] {
  let nodes = 0;
  const MAX_NODES = 4000;
  const expand = (item: string, rate: number, path: string[], id: string): TreeItem => {
    nodes++;
    const node: TreeItem = { id, item, rate, sources: [] };
    if (path.includes(item)) {
      node.sources.push({ kind: 'loop', rate, children: [], byproducts: [] });
      return node;
    }
    const srcs: Source[] =
      item === POWER
        ? a.steps.filter((s) => s.generated > 0).map((s) => ({ kind: 'step' as const, key: s.key, amount: s.generated }))
        : sourcesOf(a, item);
    const total = srcs.reduce((x, s) => x + s.amount, 0);
    if (total <= 0) return node;
    srcs.forEach((s, si) => {
      const r = (rate * s.amount) / total;
      if (r < 1e-9) return;
      if (s.kind !== 'step') {
        node.sources.push({ kind: s.kind, rate: r, children: [], byproducts: [] });
        return;
      }
      const st = a.stepByKey[s.key];
      const frac = r / (item === POWER ? st.generated : st.outputs[0][1]);
      const src: TreeSource = {
        kind: 'step',
        rate: r,
        stepKey: s.key,
        machines: st.machines * frac,
        children: [],
        byproducts: st.outputs.slice(1).map(([it, v]) => [it, v * frac]),
      };
      if (nodes < MAX_NODES) {
        st.inputs.forEach(([ing, v], ii) => {
          src.children.push(expand(ing, v * frac, [...path, item], `${id}/${si}.${ii}`));
        });
      }
      node.sources.push(src);
    });
    return node;
  };
  return targets.map(([it, r], i) => expand(it, r, [], 't' + i));
}

// ------------------------------------------------------------------------------------------
// Graph flows

export interface GraphNode {
  id: string;
  kind: 'step' | 'raw' | 'provided' | 'output' | 'waste' | 'missing';
  item?: string;
  stepKey?: string;
  amount?: number;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  item: string;
  amount: number;
}

export function buildGraph(a: Analysis): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };
  const edgeMap = new Map<string, GraphEdge>();
  const addEdge = (from: string, to: string, item: string, amount: number) => {
    if (amount < 1e-6) return;
    const id = `${from}->${to}:${item}`;
    const e = edgeMap.get(id);
    if (e) e.amount += amount;
    else edgeMap.set(id, { id, from, to, item, amount });
  };

  for (const s of a.steps) addNode({ id: 's:' + s.key, kind: 'step', stepKey: s.key });

  for (const f of Object.values(a.flows)) {
    const item = f.item;
    // sources
    const srcs: { node: string; amount: number }[] = [];
    for (const s of a.steps) {
      if (s.recipe.out[0][0] === item && s.outputs[0]) srcs.push({ node: 's:' + s.key, amount: s.outputs[0][1] });
    }
    const byProducers = a.steps
      .map((s) => ({ s, amt: s.outputs.slice(1).filter(([it]) => it === item).reduce((x, [, v]) => x + v, 0) }))
      .filter((x) => x.amt > 1e-9);
    const reuseShare = f.byproduct > 0 ? f.reused / f.byproduct : 0;
    for (const { s, amt } of byProducers) srcs.push({ node: 's:' + s.key, amount: amt * reuseShare });
    if (f.supplied > 1e-9) {
      const id = (isRaw(item) ? 'raw:' : 'prov:') + item;
      addNode({ id, kind: isRaw(item) ? 'raw' : 'provided', item, amount: f.supplied });
      srcs.push({ node: id, amount: f.supplied });
    }
    if (f.missing > 1e-9) {
      addNode({ id: 'miss:' + item, kind: 'missing', item, amount: f.missing });
      srcs.push({ node: 'miss:' + item, amount: f.missing });
    }
    const total = srcs.reduce((x, s) => x + s.amount, 0);
    // sinks
    const sinks: { node: string; amount: number }[] = [];
    for (const s of a.steps) {
      const amt = s.inputs.filter(([it]) => it === item).reduce((x, [, v]) => x + v, 0);
      if (amt > 1e-9) sinks.push({ node: 's:' + s.key, amount: amt });
    }
    if (f.output > 1e-9) {
      addNode({ id: 'out:' + item, kind: 'output', item, amount: f.output });
      sinks.push({ node: 'out:' + item, amount: f.output });
    }
    if (f.surplus > 1e-6) {
      addNode({ id: 'waste:' + item, kind: 'waste', item, amount: f.surplus + f.waste });
      sinks.push({ node: 'waste:' + item, amount: f.surplus });
    }
    if (total > 1e-9) {
      for (const sk of sinks) for (const sr of srcs) addEdge(sr.node, sk.node, item, (sr.amount * sk.amount) / total);
    }
    // unreused byproduct goes straight to a surplus node
    if (f.waste > 1e-6) {
      addNode({ id: 'waste:' + item, kind: 'waste', item, amount: f.surplus + f.waste });
      for (const { s, amt } of byProducers) addEdge('s:' + s.key, 'waste:' + item, item, amt * (1 - reuseShare));
    }
  }
  return { nodes, edges: [...edgeMap.values()] };
}

// ------------------------------------------------------------------------------------------
// Somersloop recommendations

export interface SloopTip {
  stepKey: string;
  recipe: Recipe;
  slots: number;
  /** somersloops to fully amplify the step (half as many machines, each fully slooped) */
  sloops: number;
  saved: Record<string, number>;
  savedTotal: number;
  score: number;
  extraPower: number;
}

export function sloopTips(a: Analysis): SloopTip[] {
  const tips: SloopTip[] = [];
  for (const s of a.steps) {
    if (s.sloop || s.recipe.kind === 'power') continue;
    const slots = BUILDINGS[s.recipe.building]?.slots ?? 0;
    if (!slots) continue;
    const saved: Record<string, number> = {};
    for (const [ing, r] of s.inputs) {
      const e = a.embodied[ing] ?? {};
      for (const [raw, v] of Object.entries(e)) saved[raw] = (saved[raw] ?? 0) + 0.5 * r * v;
    }
    const machinesAfter = Math.ceil(s.machines / 2 - 1e-6);
    const sloops = Math.max(1, machinesAfter) * slots;
    const w = weightedRaw(saved);
    tips.push({
      stepKey: s.key,
      recipe: s.recipe,
      slots,
      sloops,
      saved,
      savedTotal: totalRaw(saved),
      score: w / sloops,
      extraPower: recipePower(s.recipe) * s.machines,
    });
  }
  return tips.filter((t) => t.savedTotal > 1e-6).sort((x, y) => y.score - x.score);
}

// ------------------------------------------------------------------------------------------
// Byproduct recommendations

export interface ByproductAdvice {
  sink?: { points: number; via?: string };
  cannotSink?: string;
  uses: { recipe: Recipe; product: string; productRate: number; otherInputs: [string, number][] }[];
  burn: { recipe: Recipe; mw: number; count: number }[];
  warning?: string;
}

export function byproductAdvice(item: string, rate: number, available: (r: Recipe) => boolean): ByproductAdvice {
  const it = ITEMS[item];
  const adv: ByproductAdvice = { uses: [], burn: [] };
  if (it && !it.liquid && it.sink > 0) adv.sink = { points: it.sink * rate };
  if (it?.liquid) {
    const pack = Object.values(RECIPES).find((r) => r.kind === 'package' && r.in.some(([i]) => i === item));
    if (pack) {
      const packed = pack.out[0][0];
      const perFluid = pack.out[0][1] / (pack.in.find(([i]) => i === item)![1] || 1);
      const pts = (ITEMS[packed]?.sink ?? 0) * rate * perFluid;
      if (pts > 0) adv.sink = { points: pts, via: packed };
    }
    adv.warning =
      'Fluids can’t go in the AWESOME Sink directly, and a full byproduct pipe stops the machine. Reuse it, package it, or send it to another factory.';
  }
  if (item === 'Desc_NuclearWaste_C' || item === 'Desc_PlutoniumWaste_C') {
    adv.cannotSink = 'Nuclear waste can’t be sunk. Store it, or reprocess it with one of the recipes below.';
  }
  for (const r of RECIPES_BY_INGREDIENT[item] ?? []) {
    if (!available(r)) continue;
    const need = r.in.find(([i]) => i === item)![1];
    const machines = rate / need;
    if (r.kind === 'power') {
      const mw = (BUILDINGS[r.building]?.produces ?? 0) * machines;
      adv.burn.push({ recipe: r, mw, count: machines });
      continue;
    }
    if (r.kind === 'unpackage') continue;
    adv.uses.push({
      recipe: r,
      product: r.out[0][0],
      productRate: r.out[0][1] * machines,
      otherInputs: r.in.filter(([i]) => i !== item).map(([i, v]) => [i, v * machines]),
    });
  }
  adv.uses.sort((x, y) => x.otherInputs.length - y.otherInputs.length);
  return adv;
}
