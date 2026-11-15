import type { Purity } from './gamedata';

export type Objective = 'resources' | 'simple' | 'buildings' | 'power' | 'output';

export const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
  { id: 'resources', label: 'Fewest raw resources', hint: 'Uses the least ore, oil, etc. Scarce resources (uranium, sulfur…) count for more.' },
  { id: 'simple', label: 'Simplest build', hint: 'Fewest different production steps. Easier to build and belt.' },
  { id: 'buildings', label: 'Fewest buildings', hint: 'Smallest total number of machines.' },
  { id: 'power', label: 'Least power', hint: 'Lowest total MW, including an estimate for miners and extractors.' },
  { id: 'output', label: 'Max output from inputs', hint: 'Treats every output as “as much as possible”, keeping the ratio between your rates. To max just one output, use its Max button.' },
];

export interface Target {
  id: string;
  item: string;
  /** items/min, or the ratio between outputs when several are set to max */
  rate: number;
  /** make as much as possible from your inputs */
  max?: boolean;
}

export interface InputLimit {
  id: string;
  item: string;
  rate: number;
}

export interface NodeEntry {
  id: string;
  resource: string;
  purity: Purity;
  extractor: string;
  clock: number;
  count: number;
}

export interface Plan {
  id: string;
  name: string;
  targets: Target[];
  inputs: InputLimit[];
  nodes: NodeEntry[];
  objective: Objective;
  /** item -> recipe ids allowed for that item. Missing = default (standard recipes). */
  recipeChoice: Record<string, string[]>;
  /** item -> true when byproduct may feed this factory's own machines */
  reuse: Record<string, boolean>;
  /** recipe id -> somersloops you are willing to put into that step */
  sloops: Record<string, number>;
  /** include this factory's own power use as a demand on generators */
  selfPower: boolean;
  allowConverter: boolean;
  allowUnpackage: boolean;
}

export interface Settings {
  /** Highest milestone tier you have fully unlocked */
  tier: number;
  unlockedAlts: Record<string, boolean>;
  /** MAM recipes you have NOT researched yet */
  mamOff: Record<string, boolean>;
  /** Clock speed decimals (PS5 controller = 2) */
  clockDecimals: number;
  /** Default extraction assumptions used for estimates */
  minerId: string;
  purity: Purity;
  minerClock: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tier: 8,
  unlockedAlts: {},
  mamOff: {},
  clockDecimals: 2,
  minerId: 'Desc_MinerMk3_C',
  purity: 'normal',
  minerClock: 250,
};

let counter = 0;
export const uid = () => Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

export function newPlan(name = 'New factory'): Plan {
  return {
    id: uid(),
    name,
    targets: [],
    inputs: [],
    nodes: [],
    objective: 'resources',
    recipeChoice: {},
    reuse: {},
    sloops: {},
    selfPower: false,
    allowConverter: false,
    allowUnpackage: false,
  };
}
