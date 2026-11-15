import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { useSolution, type Suggestion } from '../../lib/engine';
import { BUILDINGS, POWER, RECIPES, itemName, type Recipe } from '../../lib/gamedata';
import { allowedRecipesFor, defaultRecipesFor, isAvailable, lockReason, recipesForItem } from '../../lib/recipes';
import { SLOOP_SUFFIX } from '../../lib/solverTypes';
import type { Objective, Plan } from '../../lib/types';
import { num, pct, mw, signed } from '../../lib/format';
import { ItemIcon, BuildingIcon } from '../ItemIcon';

export function gainText(obj: Objective, s: { gain: number; gainPct: number }) {
  switch (obj) {
    case 'resources':
      return `saves ${pct(s.gainPct, 1)} raw resources`;
    case 'buildings':
      return `${Math.round(s.gain)} fewer buildings`;
    case 'simple':
      return `${Math.round(s.gain)} fewer step${Math.round(s.gain) === 1 ? '' : 's'}`;
    case 'power':
      return `saves ${mw(s.gain)}`;
    case 'output':
      return `+${pct(s.gainPct, 1)} output`;
  }
}

export function RecipeLine({ r, mult = 1 }: { r: Recipe; mult?: number }) {
  return (
    <span className="recipe-line">
      {r.in.map(([it, v]) => (
        <span key={it} className="qty" title={itemName(it)}>
          {num(v * mult)}
          <ItemIcon item={it} size={16} />
        </span>
      ))}
      <span className="arrow">→</span>
      {r.out.map(([it, v], i) => (
        <span key={it} className={'qty' + (i > 0 ? ' byp' : '')} title={itemName(it) + (i > 0 ? ' (byproduct)' : '')}>
          {num(v * mult)}
          <ItemIcon item={it} size={16} />
        </span>
      ))}
    </span>
  );
}

function setChoice(plan: Plan, item: string, ids: string[], defaults: string[]) {
  const same = ids.length === defaults.length && ids.every((i) => defaults.includes(i));
  if (same) delete plan.recipeChoice[item];
  else plan.recipeChoice[item] = ids;
}

function DeltaChips({ s }: { s: Suggestion }) {
  const entries = Object.entries(s.rawDelta).sort((a, b) => a[1] - b[1]);
  return (
    <div className="chips small">
      {entries.slice(0, 6).map(([it, d]) => (
        <span key={it} className={'delta ' + (d < 0 ? 'good' : 'bad')} title={itemName(it)}>
          <ItemIcon item={it} size={14} />
          {signed(d)}
        </span>
      ))}
      {s.buildingsDelta !== 0 && <span className={'delta ' + (s.buildingsDelta < 0 ? 'good' : 'bad')}>{signed(s.buildingsDelta)} bldg</span>}
      {Math.abs(s.powerDelta) > 0.5 && <span className={'delta ' + (s.powerDelta < 0 ? 'good' : 'bad')}>{signed(s.powerDelta, mw)}</span>}
    </div>
  );
}

export function RecipesPanel() {
  const { plan, settings, analysis, result, advice, req } = useSolution();
  const goal: Objective = req.mode === 'max' ? 'output' : plan.objective;
  const updatePlan = useStore((s) => s.updatePlan);
  const setSettings = useStore((s) => s.setSettings);
  const focusItem = useStore((s) => s.ui.focusItem);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusItem) {
      setOpen((o) => ({ ...o, [focusItem]: true }));
      setTimeout(() => refs.current[focusItem]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, [focusItem]);

  const items = useMemo(() => {
    if (!analysis) return [];
    const set = new Map<string, number>();
    for (const s of analysis.steps) {
      const it = s.recipe.out[0][0];
      set.set(it, Math.min(set.get(it) ?? 99, s.recipe.tier));
    }
    // items the plan wants but couldn't make
    if (result) for (const it of Object.keys(result.missing)) set.set(it, -1);
    return [...set.entries()].sort((a, b) => a[1] - b[1] || itemName(a[0]).localeCompare(itemName(b[0]))).map(([it]) => it);
  }, [analysis, result]);

  const applySuggestion = (r: Recipe) =>
    updatePlan((p) => {
      const item = r.out[0][0];
      const cur = allowedRecipesFor(item, p, settings);
      setChoice(p, item, [...new Set([...cur, r.id])], defaultRecipesFor(item, p, settings));
    });

  const applyAll = (recipes: Recipe[]) =>
    updatePlan((p) => {
      for (const r of recipes) {
        const item = r.out[0][0];
        const cur = allowedRecipesFor(item, p, settings);
        setChoice(p, item, [...new Set([...cur, r.id])], defaultRecipesFor(item, p, settings));
      }
    });

  const machinesOf = (id: string) => (result?.x[id] ?? 0) + (result?.x[id + SLOOP_SUFFIX] ?? 0);

  return (
    <div className="panel">
      {advice.running && (
        <div className="progress" title="Testing other recipes against this plan">
          <div style={{ width: `${(100 * advice.done) / Math.max(1, advice.total)}%` }} />
          <span>Checking alternates… {advice.done}/{advice.total}</span>
        </div>
      )}
      {advice.all && (
        <div className="callout good">
          <div className="row">
            <div>
              Using all your unlocked alternates: <b>{gainText(goal, { gain: 0, gainPct: advice.all.gainPct })}</b>
              <div className="small muted">{advice.all.recipes.map((r) => r.name).join(', ')}</div>
            </div>
            <span className="spacer" />
            <button className="btn primary" onClick={() => applyAll(advice.all!.recipes)}>
              Apply all
            </button>
          </div>
        </div>
      )}
      {advice.suggestions.length > 0 && (
        <>
          <h3>Suggested from your unlocked recipes</h3>
          <div className="list">
            {advice.suggestions.map((s) => (
              <div key={s.recipe.id} className="row-card suggestion">
                <div className="row">
                  <ItemIcon item={s.item} size={22} />
                  <div className="grow">
                    <div>
                      <b>{s.recipe.name}</b> <span className="muted">for {itemName(s.item)}</span>
                    </div>
                    <div className="small good-text">{gainText(goal, s)}</div>
                  </div>
                  <button className="btn" onClick={() => applySuggestion(s.recipe)}>
                    Use it
                  </button>
                </div>
                <DeltaChips s={s} />
              </div>
            ))}
          </div>
        </>
      )}
      {advice.advisor.length > 0 && (
        <details className="sub" open>
          <summary>
            Hard drive advisor <span className="muted small">— alternates you haven’t unlocked that would help this factory</span>
          </summary>
          <div className="list">
            {advice.advisor.map((s) => (
              <div key={s.recipe.id} className="row-card locked-card">
                <div className="row">
                  <span className="lock">🔒</span>
                  <div className="grow">
                    <div>
                      <b>{s.recipe.name}</b> <span className="muted">for {itemName(s.item)}</span>
                    </div>
                    <div className="small">{gainText(goal, s)}</div>
                  </div>
                  <button className="btn small" title="Mark as unlocked in your game" onClick={() => setSettings((st) => void (st.unlockedAlts[s.recipe.id] = true))}>
                    I have it
                  </button>
                </div>
                <DeltaChips s={s} />
              </div>
            ))}
          </div>
        </details>
      )}
      {!advice.running && !advice.suggestions.length && !advice.all && analysis && analysis.steps.length > 0 && (
        <p className="muted small">No better option found among your unlocked recipes for this objective.</p>
      )}

      <h3>Recipes in this factory</h3>
      <p className="muted small">Tick the recipes the planner may use for each item. If several are ticked, it picks the best mix for your objective.</p>
      <div className="list">
        {items.map((item) => {
          const all = recipesForItem(item)
            .filter((r) => (r.kind !== 'unpackage' || plan.allowUnpackage) && (r.kind !== 'convert' || plan.allowConverter))
            .sort((a, b) => Number(a.alt) - Number(b.alt) || Number(!isAvailable(a, settings)) - Number(!isAvailable(b, settings)));
          const allowed = allowedRecipesFor(item, plan, settings);
          const defaults = defaultRecipesFor(item, plan, settings);
          const custom = !!plan.recipeChoice[item];
          const used = all.filter((r) => machinesOf(r.id) > 1e-6);
          const isOpen = open[item] || focusItem === item;
          const flow = analysis?.flows[item];
          const made = flow ? flow.produced : 0;
          return (
            <div key={item} className={'item-block' + (focusItem === item ? ' focused' : '')} ref={(el) => (refs.current[item] = el)}>
              <div className="item-head" onClick={() => setOpen((o) => ({ ...o, [item]: !isOpen }))}>
                <span className="caret">{isOpen ? '▾' : '▸'}</span>
                <ItemIcon item={item} size={22} />
                <div className="grow">
                  <div>
                    {itemName(item)} {custom && <span className="tag">custom</span>}
                  </div>
                  <div className="small muted">{used.length ? used.map((r) => r.name).join(' + ') : result?.missing[item] ? 'no unlocked recipe' : ''}</div>
                </div>
                <span className="small">{item === POWER ? mw(analysis?.generatedPower ?? 0) : num(made)}</span>
              </div>
              {isOpen && (
                <div className="item-body">
                  {all.map((r) => {
                    const avail = isAvailable(r, settings);
                    const reason = lockReason(r, settings);
                    const on = allowed.includes(r.id);
                    const m = machinesOf(r.id);
                    const slots = BUILDINGS[r.building]?.slots ?? 0;
                    return (
                      <div key={r.id} className={'recipe-opt' + (avail ? '' : ' locked') + (m > 1e-6 ? ' inuse' : '')}>
                        <label className="check">
                          <input
                            type="checkbox"
                            disabled={!avail}
                            checked={on && avail}
                            onChange={(e) =>
                              updatePlan((p) => {
                                const cur = allowedRecipesFor(item, p, settings);
                                const next = e.target.checked ? [...new Set([...cur, r.id])] : cur.filter((x) => x !== r.id);
                                setChoice(p, item, next, defaults);
                              })
                            }
                          />
                          <span>
                            <b>{r.name}</b> {r.alt && <span className="tag alt">alt</span>}
                          </span>
                        </label>
                        <div className="recipe-meta">
                          <BuildingIcon building={r.building} size={18} />
                          <span className="small muted">{BUILDINGS[r.building]?.name}</span>
                          <RecipeLine r={r} />
                        </div>
                        {m > 1e-6 && <div className="small good-text">In use: {num(m)} machines</div>}
                        {m > 1e-6 && slots > 0 && r.kind !== 'power' && (
                          <label className="inline small">
                            Somersloops for this step:
                            <input
                              className="num tiny"
                              type="number"
                              min={0}
                              step={slots}
                              value={plan.sloops[r.id] ?? 0}
                              onChange={(e) =>
                                updatePlan((p) => {
                                  const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                  if (v) p.sloops[r.id] = v;
                                  else delete p.sloops[r.id];
                                })
                              }
                            />
                            <span className="muted">({slots} per machine)</span>
                          </label>
                        )}
                        {!avail && (
                          <div className="small muted">
                            🔒 {reason}
                            {r.alt && r.tier <= settings.tier && (
                              <button className="link" onClick={() => setSettings((st) => void (st.unlockedAlts[r.id] = true))}>
                                I’ve unlocked it
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {custom && (
                    <button className="link" onClick={() => updatePlan((p) => void delete p.recipeChoice[item])}>
                      Reset to standard recipe
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

