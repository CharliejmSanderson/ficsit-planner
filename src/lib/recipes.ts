import { RECIPES, RECIPES_BY_MAIN, BUILDINGS, mainProduct, type Recipe } from './gamedata';
import type { Plan, Settings } from './types';

/** Is the recipe usable in your game right now (tier, MAM, hard drive)? */
export function isAvailable(r: Recipe, s: Settings): boolean {
  if (r.tier > s.tier) return false;
  if ((BUILDINGS[r.building]?.tier ?? 0) > s.tier) return false;
  if (r.alt) return !!s.unlockedAlts[r.id];
  if (r.source === 'mam' && s.mamOff[r.id]) return false;
  return true;
}

/** Why a recipe is not available, for tooltips */
export function lockReason(r: Recipe, s: Settings): string | null {
  const bt = BUILDINGS[r.building]?.tier ?? 0;
  if (r.tier > s.tier || bt > s.tier) return `Needs tier ${Math.max(r.tier, bt)}`;
  if (r.alt && !s.unlockedAlts[r.id]) return 'Alternate not unlocked (hard drive)';
  if (r.source === 'mam' && s.mamOff[r.id]) return `MAM research: ${r.unlockLabel}`;
  return null;
}

function kindAllowedByDefault(r: Recipe, plan: Plan): boolean {
  switch (r.kind) {
    case 'normal':
    case 'package':
    case 'power':
      return true;
    case 'unpackage':
      return plan.allowUnpackage;
    case 'convert':
      return plan.allowConverter;
  }
}

/** Standard (non-alternate) recipes that the planner uses for an item unless you change it */
export function defaultRecipesFor(item: string, plan: Plan, s: Settings): string[] {
  return (RECIPES_BY_MAIN[item] ?? [])
    .filter((r) => !r.alt && kindAllowedByDefault(r, plan) && isAvailable(r, s))
    .map((r) => r.id);
}

/** Recipes the planner may use for an item in this plan */
export function allowedRecipesFor(item: string, plan: Plan, s: Settings): string[] {
  const choice = plan.recipeChoice[item];
  if (choice) return choice.filter((id) => RECIPES[id] && isAvailable(RECIPES[id], s));
  return defaultRecipesFor(item, plan, s);
}

export function allowedRecipeSet(plan: Plan, s: Settings): Set<string> {
  const out = new Set<string>();
  for (const item of Object.keys(RECIPES_BY_MAIN)) {
    for (const id of allowedRecipesFor(item, plan, s)) out.add(id);
  }
  return out;
}

/** Every available recipe (standard + unlocked alternates), respecting converter/unpackage switches */
export function allUnlockedSet(plan: Plan, s: Settings): Set<string> {
  const out = new Set<string>();
  for (const r of Object.values(RECIPES)) {
    if (!isAvailable(r, s)) continue;
    if (!r.alt && !kindAllowedByDefault(r, plan)) continue;
    out.add(r.id);
  }
  return out;
}

export const recipesForItem = (item: string) => RECIPES_BY_MAIN[item] ?? [];
export { mainProduct };
