import raw from '../data/gamedata.json';

export interface Item {
  id: string;
  name: string;
  liquid: boolean;
  sink: number;
  energy: number;
  icon: string;
  unit?: string;
}

export type RecipeKind = 'normal' | 'package' | 'unpackage' | 'convert' | 'power';
export type UnlockSource = 'start' | 'milestone' | 'mam' | 'alt' | 'other';

export interface Recipe {
  id: string;
  name: string;
  alt: boolean;
  building: string;
  time: number;
  /** [itemId, per minute at 100%] */
  in: [string, number][];
  /** [itemId, per minute at 100%]; the first entry is the main product, the rest are byproducts */
  out: [string, number][];
  varPower: [number, number] | null;
  kind: RecipeKind;
  source: UnlockSource;
  tier: number;
  unlockLabel: string;
}

export interface Building {
  id: string;
  name: string;
  power: number;
  slots: number;
  tier: number;
  cost: [string, number][];
  icon: string;
  produces?: number;
}

export interface Resource {
  id: string;
  max: number | null;
  solid: boolean;
}

interface GameData {
  version: string;
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  buildings: Record<string, Building>;
  resources: Record<string, Resource>;
}

export const GD = raw as unknown as GameData;
export const ITEMS = GD.items;
export const RECIPES = GD.recipes;
export const BUILDINGS = GD.buildings;
export const RESOURCES = GD.resources;
export const POWER = 'Power';
export const WATER = 'Desc_Water_C';
export const POWER_EXPONENT = 1.321929;

export const isRaw = (item: string) => item in RESOURCES;
export const itemName = (id: string) => ITEMS[id]?.name ?? id;
export const isLiquid = (id: string) => !!ITEMS[id]?.liquid;
export const unitOf = (id: string) => (id === POWER ? 'MW' : isLiquid(id) ? 'm³/min' : '/min');

export const mainProduct = (r: Recipe) => r.out[0][0];

/** Recipes grouped by main product */
export const RECIPES_BY_MAIN: Record<string, Recipe[]> = {};
/** Recipes that produce the item at all (main or byproduct) */
export const RECIPES_BY_PRODUCT: Record<string, Recipe[]> = {};
/** Recipes that consume the item */
export const RECIPES_BY_INGREDIENT: Record<string, Recipe[]> = {};
for (const r of Object.values(RECIPES)) {
  (RECIPES_BY_MAIN[mainProduct(r)] ??= []).push(r);
  for (const [it] of r.out) (RECIPES_BY_PRODUCT[it] ??= []).push(r);
  for (const [it] of r.in) (RECIPES_BY_INGREDIENT[it] ??= []).push(r);
}

/** Average power draw of a recipe at 100% clock (MW). Variable-power recipes use the average. */
export function recipePower(r: Recipe): number {
  if (r.kind === 'power') return 0;
  if (r.varPower) return (r.varPower[0] + r.varPower[1]) / 2;
  return BUILDINGS[r.building]?.power ?? 0;
}

/** Items that can be chosen as outputs: anything a production recipe or generator makes */
export const PRODUCIBLE_ITEMS: string[] = Object.keys(ITEMS)
  .filter((id) => RECIPES_BY_MAIN[id]?.length || id === POWER)
  .sort((a, b) => itemName(a).localeCompare(itemName(b)));

/** Raw resource weights: scarcer resources cost more. Based on the map's maximum extraction rate. */
export const RESOURCE_WEIGHT: Record<string, number> = {};
for (const r of Object.values(RESOURCES)) {
  RESOURCE_WEIGHT[r.id] = r.max ? 10000 / r.max : 0.0005;
}

// --- Belts, pipes, extractors -----------------------------------------------------------
export const BELTS = [
  { name: 'Mk.1', rate: 60, tier: 0 },
  { name: 'Mk.2', rate: 120, tier: 2 },
  { name: 'Mk.3', rate: 270, tier: 4 },
  { name: 'Mk.4', rate: 480, tier: 5 },
  { name: 'Mk.5', rate: 780, tier: 7 },
  { name: 'Mk.6', rate: 1200, tier: 9 },
];
export const PIPES = [
  { name: 'Mk.1', rate: 300, tier: 3 },
  { name: 'Mk.2', rate: 600, tier: 6 },
];

export type Purity = 'impure' | 'normal' | 'pure';
export const PURITY_MULT: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };

export interface Extractor {
  id: string;
  name: string;
  /** rate at normal purity, 100% clock */
  base: number;
  power: number;
  tier: number;
  resources: 'solid' | string[];
  note?: string;
}
export const EXTRACTORS: Extractor[] = [
  { id: 'Desc_MinerMk1_C', name: 'Miner Mk.1', base: 60, power: 5, tier: 0, resources: 'solid' },
  { id: 'Desc_MinerMk2_C', name: 'Miner Mk.2', base: 120, power: 15, tier: 4, resources: 'solid' },
  { id: 'Desc_MinerMk3_C', name: 'Miner Mk.3', base: 240, power: 45, tier: 8, resources: 'solid' },
  { id: 'Desc_WaterPump_C', name: 'Water Extractor', base: 120, power: 20, tier: 3, resources: ['Desc_Water_C'] },
  { id: 'Desc_OilPump_C', name: 'Oil Extractor', base: 120, power: 40, tier: 5, resources: ['Desc_LiquidOil_C'] },
  {
    id: 'Desc_FrackingExtractor_C',
    name: 'Resource Well Extractor',
    base: 60,
    power: 0,
    tier: 8,
    resources: ['Desc_LiquidOil_C', 'Desc_NitrogenGas_C', 'Desc_Water_C'],
    note: 'Needs a Resource Well Pressurizer (150 MW) per well',
  },
];
export const extractorsFor = (resource: string) =>
  EXTRACTORS.filter((e) => (e.resources === 'solid' ? RESOURCES[resource]?.solid : e.resources.includes(resource)));

export const SLOOP_POWER = (boost: number) => (1 + boost) ** 2;
