import { useMemo } from 'react';
import { useSolution, extractionPlan } from '../../lib/engine';
import { useStore } from '../../lib/store';
import { BUILDINGS, EXTRACTORS, RESOURCES, itemName, unitOf } from '../../lib/gamedata';
import { sloopTips } from '../../lib/analysis';
import { num, pct, mw, signed } from '../../lib/format';
import { ItemIcon, BuildingIcon } from '../ItemIcon';
import { RecipeLine } from '../side/RecipesPanel';

export function BuildingsView() {
  const { analysis, settings, plan } = useSolution();
  const updatePlan = useStore((s) => s.updatePlan);
  const setUI = useStore((s) => s.setUI);

  const materials = useMemo(() => {
    if (!analysis) return [];
    const m: Record<string, number> = {};
    for (const [b, count] of Object.entries(analysis.buildings)) {
      for (const [it, amt] of BUILDINGS[b]?.cost ?? []) m[it] = (m[it] ?? 0) + amt * count;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [analysis]);

  const tips = useMemo(() => (analysis ? sloopTips(analysis).slice(0, 8) : []), [analysis]);

  if (!analysis) return null;
  const totalBuildings = Object.values(analysis.buildings).reduce((a, b) => a + b, 0);
  const extraction = analysis.raw.map(([it, r]) => ({ it, r, plan: plan.nodes.some((n) => n.resource === it) ? null : extractionPlan(it, r, settings) }));
  const extractionPower = extraction.reduce((a, e) => a + (e.plan?.power ?? 0), 0);

  return (
    <div className="scroll-view buildings-view">
      <div className="stat-row">
        <div className="stat">
          <div className="stat-v">{totalBuildings}</div>
          <div className="stat-l">production buildings</div>
        </div>
        <div className="stat">
          <div className="stat-v">{mw(analysis.productionPower)}</div>
          <div className="stat-l">machines’ power (exact clocks)</div>
        </div>
        <div className="stat">
          <div className="stat-v">{mw(extractionPower)}</div>
          <div className="stat-l">extraction (estimate)</div>
        </div>
        {analysis.generatedPower > 0 && (
          <div className="stat">
            <div className="stat-v good-text">{mw(analysis.generatedPower)}</div>
            <div className="stat-l">generated</div>
          </div>
        )}
      </div>

      <h3>Build list</h3>
      <table className="table wide">
        <thead>
          <tr>
            <th>Building</th>
            <th>Recipe</th>
            <th>Build</th>
            <th>Or</th>
            <th className="r">Power</th>
          </tr>
        </thead>
        <tbody>
          {analysis.steps.map((s) => (
            <tr key={s.key}>
              <td>
                <span className="item-cell">
                  <BuildingIcon building={s.recipe.building} size={22} /> {BUILDINGS[s.recipe.building]?.name}
                </span>
              </td>
              <td>
                <span className="link-like" onClick={() => setUI({ sideTab: 'recipes', focusItem: s.recipe.kind === 'power' ? 'Power' : s.recipe.out[0][0] })}>
                  {s.recipe.name}
                </span>
                {s.recipe.alt && <span className="tag alt">alt</span>}
                {s.sloop && <span className="tag sloop">✦ fully slooped</span>}
                <div>
                  <RecipeLine r={s.recipe} mult={s.machines * (s.sloop ? 1 : 1)} />
                </div>
              </td>
              <td className="nowrap">
                <b>
                  {s.count} @ {pct(s.clock, settings.clockDecimals)}
                </b>
              </td>
              <td className="nowrap small muted">
                {s.count > 1 && Math.abs(s.partialClock - 100) > 1e-6 ? `${s.count - 1} @ 100% + 1 @ ${pct(s.partialClock, settings.clockDecimals)}` : ''}
              </td>
              <td className="r nowrap">{s.recipe.kind === 'power' ? <span className="good-text">+{mw(s.generated)}</span> : mw(s.power)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Clock speeds are rounded up to {settings.clockDecimals} decimals ({settings.clockDecimals === 2 ? 'what a PS5 controller can set' : 'PC precision'}), so you
        never fall short. Fully slooped steps use the recipe line above at double output.
      </p>

      <h3>Extraction</h3>
      <table className="table wide">
        <thead>
          <tr>
            <th>Resource</th>
            <th className="r">Needed</th>
            <th>Suggested</th>
            <th className="r">Power</th>
          </tr>
        </thead>
        <tbody>
          {extraction.map(({ it, r, plan: p }) => (
            <tr key={it}>
              <td>
                <span className="item-cell">
                  <ItemIcon item={it} size={20} /> {itemName(it)}
                </span>
              </td>
              <td className="r">
                {num(r)} {unitOf(it)}
              </td>
              <td className="small">
                {p ? (
                  <>
                    {p.n} × {p.ex.name} on {RESOURCES[it]?.solid ? p.purity : ''} node{p.n > 1 ? 's' : ''} @ {pct(p.clock, settings.clockDecimals)}
                    {p.shards ? ` (${p.shards} power shard${p.shards > 1 ? 's' : ''} each)` : ''}
                  </>
                ) : (
                  <span className="muted">from your nodes (Inputs tab)</span>
                )}
              </td>
              <td className="r">{p ? mw(p.power) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Uses your default miner setup ({EXTRACTORS.find((e) => e.id === settings.minerId)?.name}, {settings.purity} nodes, up to {settings.minerClock}%), change it in
        Unlocks & settings. For exact numbers, add your real nodes on the Inputs tab.
      </p>

      <h3>Buildings</h3>
      <div className="chips">
        {Object.entries(analysis.buildings).map(([b, n]) => (
          <span key={b} className="chip static">
            <BuildingIcon building={b} size={20} /> {n} × {BUILDINGS[b]?.name}
          </span>
        ))}
      </div>

      <h3>Materials to build them</h3>
      <div className="chips">
        {materials.map(([it, n]) => (
          <span key={it} className="chip static">
            <ItemIcon item={it} size={20} /> {num(n)} {itemName(it)}
          </span>
        ))}
      </div>
      <p className="muted small">Machines only; belts, pipes, foundations, power poles and miners aren’t included.</p>

      <h3>Somersloop recommendations</h3>
      {tips.length === 0 ? (
        <p className="muted small">No steps here can take Somersloops.</p>
      ) : (
        <>
          <p className="muted small">
            A fully slooped machine doubles its output from the same inputs, at 4× power. Ranked by raw resources saved per Somersloop.
          </p>
          <div className="list">
            {tips.map((t, i) => {
              const applied = (plan.sloops[t.recipe.id] ?? 0) > 0;
              return (
                <div key={t.stepKey} className={'row-card' + (i === 0 ? ' best' : '')}>
                  <div className="row">
                    <BuildingIcon building={t.recipe.building} size={24} />
                    <div className="grow">
                      <div>
                        <b>{t.recipe.name}</b> <span className="muted small">in {BUILDINGS[t.recipe.building]?.name}s</span>
                        {i === 0 && <span className="tag good">best use</span>}
                      </div>
                      <div className="small">
                        {t.sloops} Somersloops ({t.slots} per machine) → saves <b>{num(t.savedTotal)}</b> raw/min, {signed(t.extraPower, mw)}
                      </div>
                    </div>
                    {applied ? (
                      <button className="btn small" onClick={() => updatePlan((p) => void delete p.sloops[t.recipe.id])}>
                        Remove
                      </button>
                    ) : (
                      <button className="btn small" onClick={() => updatePlan((p) => void (p.sloops[t.recipe.id] = t.sloops))}>
                        Use {t.sloops}
                      </button>
                    )}
                  </div>
                  <div className="chips small">
                    {Object.entries(t.saved)
                      .filter(([, v]) => v > 1e-3)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([it, v]) => (
                        <span key={it} className="delta good">
                          <ItemIcon item={it} size={14} />−{num(v)}
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
