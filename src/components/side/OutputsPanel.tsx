import { useState } from 'react';
import { useStore } from '../../lib/store';
import { useSolution, extractionPlan } from '../../lib/engine';
import { PRODUCIBLE_ITEMS, POWER, ITEMS, unitOf, itemName } from '../../lib/gamedata';
import { uid, type Target } from '../../lib/types';
import { num, mw } from '../../lib/format';
import { ItemPicker } from '../ItemPicker';
import { ItemIcon } from '../ItemIcon';

const SPACE_PARTS = Object.keys(ITEMS).filter((i) => i.startsWith('Desc_SpaceElevatorPart_'));

export function OutputsPanel() {
  const { plan, result, analysis, settings, req, loading } = useSolution();
  const extraction = analysis ? analysis.raw.reduce((a, [it, r]) => a + (extractionPlan(it, r, settings)?.power ?? 0), 0) : 0;
  const updatePlan = useStore((s) => s.updatePlan);
  const [timer, setTimer] = useState<string | null>(null);

  const add = (item: string) =>
    updatePlan((p) => {
      const ex = p.targets.find((t) => t.item === item);
      if (ex) return;
      p.targets.push({ id: uid(), item, rate: item === POWER ? 1000 : 10 });
    });

  const maxRows = plan.targets.filter((t) => t.max).length;
  const noLimits = Object.keys(req.limits).length === 0;
  const achievedOf = (t: Target) => {
    if (result?.status !== 'ok' || result.mode !== 'max') return null;
    if (t.max) return (t.rate > 0 ? t.rate : 1) * result.scale;
    if (plan.objective === 'output') return t.rate * result.scale;
    return null;
  };
  const setTarget = (id: string, fn: (t: Target) => void) => updatePlan((p) => fn(p.targets.find((x) => x.id === id)!));

  return (
    <div className="panel">
      <p className="muted small">
        Pick what this factory should make and how much per minute (fluids in m³/min, power in MW). Press <b>Max</b> on an output to make as much as
        your inputs allow.
      </p>
      <div className="list">
        {plan.targets.map((t) => {
          const achieved = achievedOf(t);
          return (
            <div key={t.id} className={'row-card' + (t.max ? ' max-row' : '')}>
              <div className="row">
                <ItemPicker items={PRODUCIBLE_ITEMS} value={t.item} onChange={(id) => setTarget(t.id, (x) => void (x.item = id))} />
                {t.max ? (
                  <span className="max-value" title="As much as your inputs allow">
                    {achieved !== null ? num(achieved) : loading ? '…' : '—'}
                  </span>
                ) : (
                  <input
                    className="num"
                    type="number"
                    min={0}
                    step="any"
                    value={t.rate}
                    onChange={(e) => setTarget(t.id, (x) => void (x.rate = Math.max(0, Number(e.target.value) || 0)))}
                  />
                )}
                <span className="unit">{unitOf(t.item)}</span>
                <button
                  className={'btn small max-toggle' + (t.max ? ' on' : '')}
                  title={t.max ? 'Switch back to a fixed rate' : 'Make as much as possible from your inputs'}
                  onClick={() =>
                    setTarget(t.id, (x) => {
                      if (x.max) {
                        x.max = false;
                        x.rate = achieved !== null && achieved > 0 ? Number(achieved.toFixed(2)) : 10;
                      } else {
                        x.max = true;
                        x.rate = 1;
                      }
                    })
                  }
                >
                  Max
                </button>
                {!t.max && (
                  <button className="icon-btn" title="Set by amount over time" onClick={() => setTimer(timer === t.id ? null : t.id)}>
                    ⏱
                  </button>
                )}
                <button className="icon-btn" title="Remove" onClick={() => updatePlan((p) => void (p.targets = p.targets.filter((x) => x.id !== t.id)))}>
                  ×
                </button>
              </div>
              {t.max && (
                <div className="small">
                  <span className="good-text">As much as possible from your inputs.</span>
                  {maxRows > 1 && (
                    <label className="inline ratio">
                      Ratio
                      <input
                        className="num tiny"
                        type="number"
                        min={0.01}
                        step="any"
                        value={t.rate}
                        onChange={(e) => setTarget(t.id, (x) => void (x.rate = Math.max(0.01, Number(e.target.value) || 1)))}
                      />
                    </label>
                  )}
                </div>
              )}
              {t.max && noLimits && (
                <div className="small warn-text">No inputs set yet, so this uses every resource node on the map. Add what you have on the Inputs tab.</div>
              )}
              {!t.max && achieved !== null && (
                <div className="small good-text">
                  Max with your inputs: {num(achieved)} {unitOf(t.item)}
                </div>
              )}
              {timer === t.id && !t.max && <AmountOverTime onSet={(r) => setTarget(t.id, (x) => void (x.rate = r))} />}
            </div>
          );
        })}
      </div>
      {maxRows > 1 && <p className="muted small">Max outputs are made in the ratio you set. Fixed-rate outputs are made first.</p>}
      <div className="add-row">
        <ItemPicker items={PRODUCIBLE_ITEMS} onChange={add} placeholder="+ Add an output…" />
      </div>
      <details className="sub">
        <summary>Quick add: Space Elevator parts</summary>
        <div className="chips">
          {SPACE_PARTS.map((i) => (
            <button key={i} className="chip" onClick={() => add(i)}>
              <ItemIcon item={i} size={18} /> {itemName(i)}
            </button>
          ))}
        </div>
      </details>

      <h3>Power</h3>
      <label className="check">
        <input type="checkbox" checked={plan.selfPower} onChange={(e) => updatePlan((p) => void (p.selfPower = e.target.checked))} />
        <span>Add generators to power this factory itself</span>
      </label>
      <p className="muted small">
        Pick the generator and fuel under Recipes → Power. You can also add <b>Power</b> as an output to plan a power plant on its own.
      </p>
      {analysis && (
        <div className="kv">
          <span>Machines use</span>
          <b>{mw(analysis.productionPower)}</b>
          <span>Extraction (estimate)</span>
          <b>{mw(extraction)}</b>
          {analysis.generatedPower > 0 && (
            <>
              <span>Generators make</span>
              <b className="good-text">{mw(analysis.generatedPower)}</b>
            </>
          )}
        </div>
      )}

      <h3>Recipe options</h3>
      <label className="check">
        <input type="checkbox" checked={plan.allowConverter} onChange={(e) => updatePlan((p) => void (p.allowConverter = e.target.checked))} />
        <span>Allow Converter ore recipes (turn one ore into another with SAM)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={plan.allowUnpackage} onChange={(e) => updatePlan((p) => void (p.allowUnpackage = e.target.checked))} />
        <span>Allow unpackaging recipes</span>
      </label>
    </div>
  );
}

function AmountOverTime({ onSet }: { onSet: (rate: number) => void }) {
  const [amount, setAmount] = useState(1000);
  const [minutes, setMinutes] = useState(60);
  return (
    <div className="row small timer-row">
      <input className="num" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
      <span>items in</span>
      <input className="num" type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} />
      <span>minutes</span>
      <button className="btn small" onClick={() => onSet(amount / Math.max(minutes, 0.01))}>
        = {num(amount / Math.max(minutes, 0.01))}/min
      </button>
    </div>
  );
}
