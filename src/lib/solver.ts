/**
 * Linear-programming production solver (HiGHS compiled to WebAssembly).
 *
 * Variables
 *   x_r   machines running recipe r at 100% clock (r may be a "#sloop" variant: fully amplified machines)
 *   s_i   supply of item i (raw resources, or items you said you already have)
 *   u_i   byproduct i fed back into this factory's own machines
 *   sh_i  shortfall: how far a raw input goes over the limit you set (target mode only, penalised)
 *   m_i   "missing" supply for items that cannot be made with your unlocked recipes (heavily penalised)
 *   L     output scale (max-output mode)
 *
 * Item balance:  main production + u + s + m - consumption  >=  target
 * Byproduct cap: u <= byproduct production
 */
import highsLoader from 'highs';
import { ITEMS, RECIPES, RECIPES_BY_MAIN, BUILDINGS, POWER, RESOURCES, RESOURCE_WEIGHT, isRaw, recipePower } from './gamedata';
import type { Objective } from './types';

import { SLOOP_SUFFIX, computeMetric, splitTargets, type SolveRequest, type SolveResult, type VRecipe } from './solverTypes';
export * from './solverTypes';

// ------------------------------------------------------------------------------------------
// HiGHS loading

type Highs = { solve(problem: string, options?: Record<string, unknown>): any };
let highsPromise: Promise<Highs> | null = null;
let wasmBytes: Uint8Array | null = null;

/** Provide the HiGHS WebAssembly bytes (embedded in the app as base64). */
export function initSolver(bytes: Uint8Array) {
  wasmBytes = bytes;
}


function loadHighs(): Promise<Highs> {
  if (!wasmBytes) throw new Error('Solver not initialised');
  const bin = wasmBytes;
  return (highsLoader as any)({
    // Instantiate from the embedded bytes so no separate .wasm file has to be fetched.
    instantiateWasm(imports: WebAssembly.Imports, done: (inst: WebAssembly.Instance) => void) {
      WebAssembly.instantiate(bin, imports).then((res) => done(res.instance));
      return {};
    },
  });
}

async function runLP(lp: string, options: Record<string, unknown>): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!highsPromise) highsPromise = loadHighs();
    const highs = await highsPromise;
    try {
      return highs.solve(lp, options);
    } catch (e) {
      // The wasm build can get into a bad state after an abort; reload once and retry.
      highsPromise = null;
      if (attempt === 1) throw e;
    }
  }
}

// ------------------------------------------------------------------------------------------
// Model

const W_TIE = 1e-3;
const PEN_SHORT = 1e3;
const PEN_REUSE = 1e4;
const PEN_MISSING = 1e5;
const EPS = 1e-7;

interface Built {
  lp: string;
  cols: { name: string; type: string; key: string }[];
  vrecipes: VRecipe[];
  rowItems: string[];
  supplyItems: string[];
  limitedRaw: boolean;
}

interface BuildOpts {
  objective: Objective | 'maxL' | 'resourcesAfterMax';
  /** max mode: fix reuse-off byproducts to 0 */
  hardReuse?: boolean;
  bigM?: number;
  minL?: number;
  worldLimits?: boolean;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number(n.toPrecision(12)).toString();
}

export function buildModel(req: SolveRequest, opts: BuildOpts): Built {
  const { fixed, scaled } = splitTargets(req);
  const targetItems = [...new Set([...Object.keys(fixed), ...Object.keys(scaled)])];

  // --- Find every recipe that could be part of the chain -------------------------------
  const included = new Set<string>();
  const seen = new Set<string>();
  const queue = [...targetItems];
  if (req.selfPower) queue.push(POWER);
  while (queue.length) {
    const item = queue.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    for (const r of RECIPES_BY_MAIN[item] ?? []) {
      if (!req.allowed.has(r.id) || included.has(r.id)) continue;
      included.add(r.id);
      for (const [ing] of r.in) queue.push(ing);
      if (req.selfPower && recipePower(r) > 0) queue.push(POWER);
    }
  }

  const vrecipes: VRecipe[] = [];
  for (const id of included) {
    const recipe = RECIPES[id];
    vrecipes.push({ key: id, recipe, outMult: 1, powerMult: 1 });
    const slots = BUILDINGS[recipe.building]?.slots ?? 0;
    const sl = req.sloops[id] ?? 0;
    if (slots > 0 && sl >= slots && recipe.kind !== 'power') {
      vrecipes.push({ key: id + SLOOP_SUFFIX, recipe, outMult: 2, powerMult: 4, maxMachines: Math.floor(sl / slots) });
    }
  }

  // --- Items --------------------------------------------------------------------------
  const rowSet = new Set<string>(targetItems);
  for (const v of vrecipes) {
    for (const [it] of v.recipe.in) rowSet.add(it);
    for (const [it] of v.recipe.out) rowSet.add(it);
  }
  if (req.selfPower) rowSet.add(POWER);
  const rowItems = [...rowSet];

  const producers = new Set<string>();
  const byproductItems = new Set<string>();
  for (const v of vrecipes) {
    v.recipe.out.forEach(([it], idx) => {
      producers.add(it);
      if (idx > 0) byproductItems.add(it);
    });
  }

  // --- Columns -------------------------------------------------------------------------
  const cols: Built['cols'] = [];
  const colOf: Record<string, string> = {};
  const addCol = (type: string, key: string) => {
    const name = 'c' + cols.length;
    cols.push({ name, type, key });
    colOf[type + ':' + key] = name;
    return name;
  };
  for (const v of vrecipes) addCol('x', v.key);
  const supplyItems: string[] = [];
  for (const it of rowItems) {
    if (it === POWER) continue;
    if (isRaw(it) || req.limits[it] !== undefined) {
      supplyItems.push(it);
      addCol('s', it);
    }
  }
  for (const it of byproductItems) addCol('u', it);
  const isMax = req.mode === 'max';
  for (const it of supplyItems) {
    if (!isMax && isRaw(it) && req.limits[it] !== undefined) addCol('sh', it);
  }
  for (const it of rowItems) {
    if (it === POWER && !fixed[POWER] && !scaled[POWER] && !req.selfPower) continue;
    if (!producers.has(it) && !supplyItems.includes(it)) addCol('m', it);
  }
  if (isMax) addCol('L', 'L');

  const countObjective = opts.objective === 'buildings' || opts.objective === 'simple';
  if (opts.objective === 'buildings') for (const v of vrecipes) addCol('n', v.key);
  if (opts.objective === 'simple') for (const v of vrecipes) addCol('y', v.key);

  // --- Objective -----------------------------------------------------------------------
  const obj: Record<string, number> = {};
  const add = (col: string | undefined, c: number) => {
    if (!col || c === 0) return;
    obj[col] = (obj[col] ?? 0) + c;
  };
  const resWeight = (it: string) => (isRaw(it) ? RESOURCE_WEIGHT[it] ?? 0 : 0);

  const primary = opts.objective;
  const tie = countObjective ? 1e-5 : W_TIE;
  if (primary === 'maxL') {
    add(colOf['L:L'], -1);
    // small tie-break so the max solution doesn't waste
    for (const it of supplyItems) add(colOf['s:' + it], 1e-6 * resWeight(it));
  } else {
    for (const it of supplyItems) {
      const w = resWeight(it);
      if (primary === 'resources' || primary === 'resourcesAfterMax' || primary === 'output') add(colOf['s:' + it], w);
      else if (primary === 'power') {
        add(colOf['s:' + it], (req.extractPower[it] ?? 0) + W_TIE * w);
      } else add(colOf['s:' + it], tie * w);
    }
    for (const v of vrecipes) {
      const x = colOf['x:' + v.key];
      if (primary === 'power') add(x, recipePower(v.recipe) * v.powerMult);
      else if (primary === 'buildings') add(x, 1e-4);
      else if (primary === 'simple') add(x, 1e-4);
      else add(x, W_TIE);
      if (primary === 'buildings') add(colOf['n:' + v.key], 1);
      if (primary === 'simple') add(colOf['y:' + v.key], 1);
    }
  }
  for (const it of byproductItems) {
    if (!req.reuse[it]) add(colOf['u:' + it], primary === 'maxL' ? 1e-3 : PEN_REUSE);
  }
  for (const it of supplyItems) add(colOf['sh:' + it], PEN_SHORT);
  for (const c of cols) if (c.type === 'm') add(c.name, PEN_MISSING);

  // --- Constraints ---------------------------------------------------------------------
  const rows: string[] = [];
  let rowN = 0;
  const writeRow = (terms: Record<string, number>, sense: string, rhs: number) => {
    const parts: string[] = [];
    for (const [c, v] of Object.entries(terms)) {
      if (Math.abs(v) < 1e-12) continue;
      parts.push((v >= 0 ? '+ ' : '- ') + fmt(Math.abs(v)) + ' ' + c);
    }
    if (!parts.length) {
      if ((sense === '>=' && rhs > 0) || (sense === '<=' && rhs < 0)) parts.push('0 ' + cols[0]?.name);
      else return;
    }
    const lines: string[] = [];
    for (let i = 0; i < parts.length; i += 8) lines.push(' ' + parts.slice(i, i + 8).join(' '));
    rows.push(` r${rowN++}:` + lines.join('\n') + ` ${sense} ${fmt(rhs)}`);
  };

  for (const it of rowItems) {
    const terms: Record<string, number> = {};
    const t = (c: string | undefined, v: number) => {
      if (!c) return;
      terms[c] = (terms[c] ?? 0) + v;
    };
    for (const v of vrecipes) {
      const x = colOf['x:' + v.key];
      const [mainIt, mainRate] = v.recipe.out[0];
      if (mainIt === it) t(x, mainRate * v.outMult);
      for (const [ing, rate] of v.recipe.in) if (ing === it) t(x, -rate);
      if (it === POWER && req.selfPower) {
        const p = recipePower(v.recipe) * v.powerMult;
        if (p > 0) t(x, -p);
      }
    }
    if (it === POWER && req.selfPower) {
      for (const s of supplyItems) {
        const ep = req.extractPower[s] ?? 0;
        if (ep > 0) t(colOf['s:' + s], -ep);
      }
    }
    t(colOf['u:' + it], 1);
    t(colOf['s:' + it], 1);
    t(colOf['m:' + it], 1);
    if (isMax && scaled[it]) t(colOf['L:L'], -scaled[it]);
    writeRow(terms, '>=', fixed[it] ?? 0);
  }
  // byproduct caps
  for (const it of byproductItems) {
    const terms: Record<string, number> = { [colOf['u:' + it]]: 1 };
    for (const v of vrecipes) {
      v.recipe.out.forEach(([o, rate], idx) => {
        if (idx > 0 && o === it) terms[colOf['x:' + v.key]] = (terms[colOf['x:' + v.key]] ?? 0) - rate * v.outMult;
      });
    }
    writeRow(terms, '<=', 0);
  }
  // shortfall rows (target mode): s - sh <= limit
  for (const it of supplyItems) {
    const sh = colOf['sh:' + it];
    if (sh) writeRow({ [colOf['s:' + it]]: 1, [sh]: -1 }, '<=', req.limits[it]);
  }
  // integer machine counts / step indicators
  if (opts.objective === 'buildings') {
    for (const v of vrecipes) writeRow({ [colOf['n:' + v.key]]: 1, [colOf['x:' + v.key]]: -1 }, '>=', 0);
  }
  if (opts.objective === 'simple') {
    const M = opts.bigM ?? 1e4;
    for (const v of vrecipes) writeRow({ [colOf['x:' + v.key]]: 1, [colOf['y:' + v.key]]: -M }, '<=', 0);
  }

  // --- Bounds --------------------------------------------------------------------------
  const bounds: string[] = [];
  let limitedRaw = false;
  for (const it of supplyItems) {
    const c = colOf['s:' + it];
    const lim = req.limits[it];
    if (!isRaw(it)) {
      bounds.push(` 0 <= ${c} <= ${fmt(lim)}`);
    } else if (isMax && lim !== undefined) {
      limitedRaw = true;
      bounds.push(` 0 <= ${c} <= ${fmt(lim)}`);
    } else if (isMax && opts.worldLimits && RESOURCES[it]?.max) {
      bounds.push(` 0 <= ${c} <= ${fmt(RESOURCES[it].max!)}`);
    }
  }
  for (const v of vrecipes) {
    if (v.maxMachines !== undefined) bounds.push(` 0 <= ${colOf['x:' + v.key]} <= ${fmt(v.maxMachines)}`);
  }
  if (opts.hardReuse) {
    for (const it of byproductItems) if (!req.reuse[it]) bounds.push(` 0 <= ${colOf['u:' + it]} <= 0`);
  }
  if (isMax) {
    for (const c of cols) if (c.type === 'm') bounds.push(` 0 <= ${c.name} <= 0`);
    if (opts.minL !== undefined) bounds.push(` ${colOf['L:L']} >= ${fmt(opts.minL)}`);
  }

  const objTerms = Object.entries(obj)
    .filter(([, v]) => Math.abs(v) > 1e-15)
    .map(([c, v]) => (v >= 0 ? '+ ' : '- ') + fmt(Math.abs(v)) + ' ' + c);
  if (!objTerms.length && cols.length) objTerms.push('0 ' + cols[0].name);
  const objLines: string[] = [];
  for (let i = 0; i < objTerms.length; i += 8) objLines.push(' ' + objTerms.slice(i, i + 8).join(' '));

  let lp = 'Minimize\n obj:' + objLines.join('\n') + '\nSubject To\n' + rows.join('\n') + '\n';
  if (bounds.length) lp += 'Bounds\n' + bounds.join('\n') + '\n';
  const gens = cols.filter((c) => c.type === 'n').map((c) => c.name);
  const bins = cols.filter((c) => c.type === 'y').map((c) => c.name);
  if (gens.length) lp += 'General\n ' + gens.join(' ') + '\n';
  if (bins.length) lp += 'Binary\n ' + bins.join(' ') + '\n';
  lp += 'End\n';
  return { lp, cols, vrecipes, rowItems, supplyItems, limitedRaw };
}

function emptyResult(req: SolveRequest, status: SolveResult['status'], message?: string): SolveResult {
  return {
    status,
    message,
    mode: req.mode,
    scale: 0,
    x: {},
    supply: {},
    reused: {},
    shortfall: {},
    missing: {},
    outputs: {},
    forcedReuse: [],
    usedWorldLimits: false,
    metric: 0,
  };
}

function parse(req: SolveRequest, built: Built, res: any, usedWorldLimits: boolean): SolveResult {
  const out = emptyResult(req, 'ok');
  out.usedWorldLimits = usedWorldLimits;
  const val = (name: string) => {
    const v = res.Columns?.[name]?.Primal ?? 0;
    return Math.abs(v) < EPS ? 0 : v;
  };
  out.scale = req.mode === 'max' ? val(built.cols.find((c) => c.type === 'L')!.name) : 1;
  for (const c of built.cols) {
    const v = val(c.name);
    if (v <= 0) continue;
    switch (c.type) {
      case 'x':
        out.x[c.key] = v;
        break;
      case 's':
        out.supply[c.key] = v;
        break;
      case 'u':
        out.reused[c.key] = v;
        if (!req.reuse[c.key]) out.forcedReuse.push(c.key);
        break;
      case 'sh':
        out.shortfall[c.key] = v;
        break;
      case 'm':
        out.missing[c.key] = v;
        break;
    }
  }
  const { fixed, scaled } = splitTargets(req);
  for (const [it, v] of Object.entries(fixed)) out.outputs[it] = (out.outputs[it] ?? 0) + v;
  for (const [it, w] of Object.entries(scaled)) out.outputs[it] = (out.outputs[it] ?? 0) + w * out.scale;
  out.metric = computeMetric(req, out);
  return out;
}

function okStatus(res: any) {
  const s: string = res?.Status ?? '';
  return s === 'Optimal' || ((s.includes('limit') || s.includes('Limit')) && res.Columns && Number.isFinite(res.ObjectiveValue));
}

export async function solve(req: SolveRequest): Promise<SolveResult> {
  if (!req.targets.some((t) => t.item && (t.rate > 0 || t.max))) return emptyResult(req, 'empty');
  const timeLimit = req.timeLimit ?? 8;
  try {
    if (req.mode === 'max') return await solveMax(req, timeLimit);

    let bigM: number | undefined;
    if (req.objective === 'simple' || req.objective === 'buildings') {
      // Relaxed pre-solve to size the big-M for step indicators
      const pre = buildModel(req, { objective: 'resources' });
      const r0 = await runLP(pre.lp, {});
      if (okStatus(r0)) {
        const p = parse(req, pre, r0, false);
        const total = Object.values(p.x).reduce((a, b) => a + b, 0);
        bigM = Math.max(100, total * 20);
      }
    }
    const built = buildModel(req, { objective: req.objective, bigM });
    const res = await runLP(built.lp, { time_limit: timeLimit, mip_rel_gap: 1e-4 });
    if (!okStatus(res)) return emptyResult(req, 'error', `Solver: ${res?.Status ?? 'no result'}`);
    return parse(req, built, res, false);
  } catch (e: any) {
    return emptyResult(req, 'error', String(e?.message ?? e));
  }
}

async function solveMax(req: SolveRequest, timeLimit: number): Promise<SolveResult> {
  const hasLimits = Object.keys(req.limits).length > 0;
  let world = !hasLimits;
  for (let pass = 0; pass < 2; pass++) {
    // Stage 1: biggest scale, without reusing byproducts you haven't allowed
    let b1 = buildModel(req, { objective: 'maxL', hardReuse: true, worldLimits: world });
    let r1 = await runLP(b1.lp, { time_limit: timeLimit });
    let status: string = r1?.Status ?? '';
    if (status.toLowerCase().includes('unbounded') && !world) {
      world = true;
      continue;
    }
    let L = okStatus(r1) ? r1.Columns[b1.cols.find((c) => c.type === 'L')!.name].Primal : 0;
    if (!(L > EPS)) {
      // Try again allowing forced byproduct reuse
      b1 = buildModel(req, { objective: 'maxL', worldLimits: world });
      r1 = await runLP(b1.lp, { time_limit: timeLimit });
      status = r1?.Status ?? '';
      if (status.toLowerCase().includes('unbounded') && !world) {
        world = true;
        continue;
      }
      L = okStatus(r1) ? r1.Columns[b1.cols.find((c) => c.type === 'L')!.name].Primal : 0;
    }
    if (!(L > EPS)) return await explainNoOutput(req, world, timeLimit);
    // Stage 2: same output, then your objective (fewest resources, steps, buildings or power)
    const minL = L * (1 - 1e-7);
    let objective: BuildOpts['objective'] = req.objective === 'output' || req.objective === 'resources' ? 'resourcesAfterMax' : req.objective;
    let bigM: number | undefined;
    if (objective === 'simple' || objective === 'buildings') {
      const p1 = parse(req, b1, r1, world);
      bigM = Math.max(100, Object.values(p1.x).reduce((a, b) => a + b, 0) * 20);
    }
    const b2 = buildModel(req, { objective, worldLimits: world, minL, bigM });
    const r2 = await runLP(b2.lp, { time_limit: timeLimit, mip_rel_gap: 1e-4 });
    if (!okStatus(r2)) return parse(req, b1, r1, world);
    const out = parse(req, b2, r2, world);
    out.metric = out.scale;
    return out;
  }
  return emptyResult(req, 'error', 'Could not find a maximum.');
}

/** Max mode found nothing: say why (missing recipes, fixed outputs too big, or a zero limit). */
async function explainNoOutput(req: SolveRequest, world: boolean, timeLimit: number): Promise<SolveResult> {
  const asTarget: SolveRequest = {
    ...req,
    mode: 'target',
    objective: req.objective === 'output' ? 'resources' : req.objective,
    targets: req.targets.map((t) => ({ item: t.item, rate: t.max ? (t.rate > 0 ? t.rate : 1) : t.rate })),
  };
  let message = 'Nothing can be made from these inputs. Check that every raw resource the chain needs has a limit above zero.';
  try {
    const built = buildModel(asTarget, { objective: 'resources' });
    const r = await runLP(built.lp, { time_limit: timeLimit });
    if (okStatus(r)) {
      const p = parse(asTarget, built, r, false);
      const missing = Object.keys(p.missing);
      if (missing.length) message = `Can't make ${missing.map((m) => ITEMS[m]?.name ?? m).join(', ')} with your unlocked recipes and tier.`;
      else if (req.targets.some((t) => !t.max && t.rate > 0) && req.objective !== 'output')
        message = 'Your inputs aren’t enough for the fixed-rate outputs on their own. Lower those rates or add more inputs.';
    }
  } catch {
    /* keep the generic message */
  }
  const out = emptyResult(req, 'error', message);
  out.usedWorldLimits = world;
  return out;
}
