/** Solver request/result types and helpers that don't need the WebAssembly solver itself. */
import { RECIPES, RESOURCE_WEIGHT, isRaw, recipePower, type Recipe } from './gamedata';
import type { Objective } from './types';

export interface SolveRequest {
  /** max: make as much as possible (rate is then the ratio between several max outputs) */
  targets: { item: string; rate: number; max?: boolean }[];
  /** item -> max per minute available (raw or already-made items) */
  limits: Record<string, number>;
  allowed: Set<string>;
  objective: Objective;
  reuse: Record<string, boolean>;
  /** recipe id -> somersloops available for that step */
  sloops: Record<string, number>;
  selfPower: boolean;
  /** raw item -> MW per unit/min to extract it (estimate) */
  extractPower: Record<string, number>;
  mode: 'target' | 'max';
  timeLimit?: number;
}

export interface SolveResult {
  status: 'ok' | 'empty' | 'error';
  message?: string;
  mode: 'target' | 'max';
  scale: number;
  /** recipe key (id or id#sloop) -> machines at 100% */
  x: Record<string, number>;
  supply: Record<string, number>;
  reused: Record<string, number>;
  shortfall: Record<string, number>;
  missing: Record<string, number>;
  outputs: Record<string, number>;
  /** byproducts that had to be reused even though you didn't allow it (no other source) */
  forcedReuse: string[];
  usedWorldLimits: boolean;
  /** the objective's own measure, used to compare plans */
  metric: number;
}

export interface VRecipe {
  key: string;
  recipe: Recipe;
  outMult: number;
  powerMult: number;
  maxMachines?: number;
}

export const SLOOP_SUFFIX = '#sloop';

export function vrecipeFromKey(key: string): VRecipe | null {
  const sloop = key.endsWith(SLOOP_SUFFIX);
  const id = sloop ? key.slice(0, -SLOOP_SUFFIX.length) : key;
  const recipe = RECIPES[id];
  if (!recipe) return null;
  return sloop ? { key, recipe, outMult: 2, powerMult: 4 } : { key, recipe, outMult: 1, powerMult: 1 };
}


export function computeMetric(req: Pick<SolveRequest, 'objective' | 'extractPower'>, r: SolveResult): number {
  switch (req.objective) {
    case 'output':
      return r.scale;
    case 'resources': {
      let m = 0;
      for (const [it, v] of Object.entries(r.supply)) if (isRaw(it)) m += (RESOURCE_WEIGHT[it] ?? 0) * v;
      return m;
    }
    case 'power': {
      let m = 0;
      for (const [k, v] of Object.entries(r.x)) {
        const vr = vrecipeFromKey(k);
        if (vr) m += recipePower(vr.recipe) * vr.powerMult * v;
      }
      for (const [it, v] of Object.entries(r.supply)) m += (req.extractPower[it] ?? 0) * v;
      return m;
    }
    case 'buildings': {
      let m = 0;
      for (const v of Object.values(r.x)) m += Math.ceil(v - 1e-6);
      return m;
    }
    case 'simple':
      return Object.values(r.x).filter((v) => v > 1e-6).length;
  }
}


/**
 * Splits outputs into fixed rates and "as much as possible" weights.
 * In max mode an output is scaled when it is marked max, or when optimising for max output overall.
 */
export function splitTargets(req: Pick<SolveRequest, 'targets' | 'mode' | 'objective'>) {
  const fixed: Record<string, number> = {};
  const scaled: Record<string, number> = {};
  for (const t of req.targets) {
    if (!t.item) continue;
    const isScaled = req.mode === 'max' && (t.max || req.objective === 'output');
    if (isScaled) {
      const w = t.max ? (t.rate > 0 ? t.rate : 1) : t.rate;
      if (w > 0) scaled[t.item] = (scaled[t.item] ?? 0) + w;
    } else if (t.rate > 0) {
      fixed[t.item] = (fixed[t.item] ?? 0) + t.rate;
    }
  }
  return { fixed, scaled };
}

export function decodeB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
