import { describe, it, expect } from 'vitest';
import { solve, initSolver, decodeB64, type SolveRequest } from '../src/lib/solver';
import wasmB64 from 'virtual:highs-wasm';
initSolver(decodeB64(wasmB64));
import { allowedRecipeSet, allUnlockedSet } from '../src/lib/recipes';
import { newPlan, DEFAULT_SETTINGS } from '../src/lib/types';

const plan = newPlan();
const settings = { ...DEFAULT_SETTINGS, tier: 9 };
const base = (over: Partial<SolveRequest>): SolveRequest => ({
  targets: [],
  limits: {},
  allowed: allowedRecipeSet(plan, settings),
  objective: 'resources',
  reuse: {},
  sloops: {},
  selfPower: false,
  extractPower: {},
  mode: 'target',
  ...over,
});

describe('solver', () => {
  it('reinforced iron plates, standard recipes', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }] }));
    if (r.status !== 'ok') console.log('ERR', r.message);
    expect(r.status).toBe('ok');
    expect(r.x['Recipe_IronPlateReinforced_C']).toBeCloseTo(1, 6);
    expect(r.x['Recipe_IronPlate_C']).toBeCloseTo(1.5, 6);
    expect(r.x['Recipe_Screw_C']).toBeCloseTo(1.5, 6);
    expect(r.x['Recipe_IronRod_C']).toBeCloseTo(1, 6);
    expect(r.x['Recipe_IngotIron_C']).toBeCloseTo(2, 6);
    expect(r.supply['Desc_OreIron_C']).toBeCloseTo(60, 6);
  });

  it('max output from 120 iron ore', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }], limits: { Desc_OreIron_C: 120 }, mode: 'max', objective: 'output' }));
    expect(r.status).toBe('ok');
    expect(r.scale).toBeCloseTo(2, 5);
  });

  it('shortfall reported in target mode', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }], limits: { Desc_OreIron_C: 45 } }));
    expect(r.shortfall['Desc_OreIron_C']).toBeCloseTo(15, 5);
  });

  it('plastic leaves heavy oil residue as waste unless reuse', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_Plastic_C', rate: 20 }] }));
    expect(r.x['Recipe_Plastic_C']).toBeCloseTo(1, 6);
    expect(r.reused['Desc_HeavyOilResidue_C'] ?? 0).toBe(0);
  });

  it('simple and buildings objectives run', async () => {
    const all = allUnlockedSet(plan, { ...settings, unlockedAlts: Object.fromEntries(Object.keys((await import('../src/lib/gamedata')).RECIPES).map((k) => [k, true])) });
    for (const objective of ['simple', 'buildings', 'power'] as const) {
      const r = await solve(base({ targets: [{ item: 'Desc_ModularFrameHeavy_C', rate: 2 }], allowed: all, objective }));
      if (r.status !== 'ok') console.log('ERR', objective, r.message);
      expect(r.status).toBe('ok');
      console.log(objective, r.metric, Object.keys(r.x).length);
    }
  });

  it('missing recipes flagged', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_Computer_C', rate: 1 }], allowed: allowedRecipeSet(plan, { ...settings, tier: 4 }) }));
    expect(Object.keys(r.missing).length).toBeGreaterThan(0);
  });

  it('self power with coal', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_IronPlate_C', rate: 20 }], selfPower: true }));
    expect(r.status).toBe('ok');
    console.log(r.x);
  });

  it('as much as possible: uranium fuel rods from 600 uranium', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_NuclearFuelRod_C', rate: 1, max: true }], limits: { Desc_OreUranium_C: 600 }, mode: 'max' }));
    expect(r.status).toBe('ok');
    expect(r.outputs['Desc_NuclearFuelRod_C']).toBeCloseTo(6, 4);
  });

  it('fixed outputs come first, the rest goes to the max output', async () => {
    const r = await solve(
      base({
        targets: [
          { item: 'Desc_IronPlateReinforced_C', rate: 5 },
          { item: 'Desc_IronPlate_C', rate: 1, max: true },
        ],
        limits: { Desc_OreIron_C: 120 },
        mode: 'max',
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.outputs['Desc_IronPlateReinforced_C']).toBeCloseTo(5, 4);
    expect(r.outputs['Desc_IronPlate_C']).toBeCloseTo(40, 4);
  });

  it('max output with the simplest-build objective', async () => {
    const r = await solve(base({ targets: [{ item: 'Desc_Computer_C', rate: 1, max: true }], limits: { Desc_OreCopper_C: 300 }, mode: 'max', objective: 'simple' }));
    expect(r.status).toBe('ok');
    expect(r.outputs['Desc_Computer_C']).toBeGreaterThan(0);
  });

  it('explains when fixed outputs are too big for the inputs', async () => {
    const r = await solve(
      base({
        targets: [
          { item: 'Desc_IronPlateReinforced_C', rate: 50 },
          { item: 'Desc_IronPlate_C', rate: 1, max: true },
        ],
        limits: { Desc_OreIron_C: 120 },
        mode: 'max',
      }),
    );
    expect(r.status).toBe('error');
    expect(r.message).toContain('fixed-rate');
  });
});
