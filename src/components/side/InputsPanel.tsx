import { useMemo } from 'react';
import { useStore } from '../../lib/store';
import { useSolution, nodeRate, limitsOf, maxBelt } from '../../lib/engine';
import { ITEMS, RESOURCES, EXTRACTORS, extractorsFor, isRaw, itemName, unitOf, POWER, type Purity } from '../../lib/gamedata';
import { uid } from '../../lib/types';
import { num, pct } from '../../lib/format';
import { ItemPicker } from '../ItemPicker';
import { ItemIcon } from '../ItemIcon';

const RAW_ITEMS = Object.keys(RESOURCES).sort((a, b) => itemName(a).localeCompare(itemName(b)));
const ALL_ITEMS = [
  ...RAW_ITEMS,
  ...Object.keys(ITEMS)
    .filter((i) => !isRaw(i) && i !== POWER)
    .sort((a, b) => itemName(a).localeCompare(itemName(b))),
];

export function InputsPanel() {
  const { plan, result, maxResult, settings } = useSolution();
  const updatePlan = useStore((s) => s.updatePlan);
  const limits = useMemo(() => limitsOf(plan), [plan]);
  const belt = maxBelt(settings.tier);

  // Need vs have
  const rows = useMemo(() => {
    if (!result || result.status !== 'ok') return [];
    const items = new Set<string>([...Object.keys(result.supply), ...Object.keys(limits)]);
    return [...items]
      .map((it) => {
        // supply already includes any amount over your limit (the shortfall)
        const need = result.supply[it] ?? 0;
        const have = limits[it];
        return { it, need, have };
      })
      .filter((r) => r.need > 1e-6 || r.have !== undefined)
      .sort((a, b) => (isRaw(b.it) ? 1 : 0) - (isRaw(a.it) ? 1 : 0) || b.need - a.need);
  }, [result, limits]);

  const bottlenecks = useMemo(() => {
    const r = result?.mode === 'max' ? result : maxResult;
    if (!r || r.status !== 'ok') return [];
    return Object.entries(limits)
      .filter(([it, lim]) => lim > 0 && (r.supply[it] ?? 0) >= lim * (1 - 1e-4))
      .map(([it]) => it);
  }, [result, maxResult, limits]);

  return (
    <div className="panel">
      <p className="muted small">
        Set what you have available. The table shows what the plan needs against what you have. To see how much you can make from these, press{' '}
        <b>Max</b> on an output in the Outputs tab.
      </p>

      <h3>Available inputs</h3>
      <div className="list">
        {plan.inputs.map((l) => (
          <div key={l.id} className="row">
            <ItemPicker items={ALL_ITEMS} value={l.item} onChange={(id) => updatePlan((p) => void (p.inputs.find((x) => x.id === l.id)!.item = id))} />
            <input
              className="num"
              type="number"
              min={0}
              step="any"
              value={l.rate}
              onChange={(e) => updatePlan((p) => void (p.inputs.find((x) => x.id === l.id)!.rate = Math.max(0, Number(e.target.value) || 0)))}
            />
            <span className="unit">{unitOf(l.item)}</span>
            <button className="icon-btn" onClick={() => updatePlan((p) => void (p.inputs = p.inputs.filter((x) => x.id !== l.id)))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="add-row">
        <ItemPicker
          items={ALL_ITEMS}
          onChange={(id) => updatePlan((p) => void p.inputs.push({ id: uid(), item: id, rate: isRaw(id) ? 480 : 60 }))}
          placeholder="+ Add an input (ore, or parts you already make)…"
        />
      </div>

      <h3>Resource nodes</h3>
      <p className="muted small">Enter the nodes you’ll mine for this factory. Their output is added to the available inputs.</p>
      <div className="list">
        {plan.nodes.map((n) => {
          const exs = extractorsFor(n.resource);
          const r = nodeRate(n);
          const perNode = r / Math.max(1, n.count);
          const shards = Math.max(0, Math.ceil((n.clock - 100 - 1e-9) / 50));
          return (
            <div key={n.id} className="row-card">
              <div className="row wrap">
                <select
                  value={n.resource}
                  onChange={(e) =>
                    updatePlan((p) => {
                      const x = p.nodes.find((y) => y.id === n.id)!;
                      x.resource = e.target.value;
                      const ok = extractorsFor(x.resource);
                      if (!ok.some((o) => o.id === x.extractor)) x.extractor = ok[ok.length - 1]?.id ?? x.extractor;
                    })
                  }
                >
                  {RAW_ITEMS.map((i) => (
                    <option key={i} value={i}>
                      {itemName(i)}
                    </option>
                  ))}
                </select>
                <select value={n.purity} onChange={(e) => updatePlan((p) => void (p.nodes.find((y) => y.id === n.id)!.purity = e.target.value as Purity))}>
                  <option value="impure">Impure</option>
                  <option value="normal">Normal</option>
                  <option value="pure">Pure</option>
                </select>
                <select value={n.extractor} onChange={(e) => updatePlan((p) => void (p.nodes.find((y) => y.id === n.id)!.extractor = e.target.value))}>
                  {exs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row wrap">
                <label className="inline">
                  ×
                  <input
                    className="num tiny"
                    type="number"
                    min={1}
                    value={n.count}
                    onChange={(e) => updatePlan((p) => void (p.nodes.find((y) => y.id === n.id)!.count = Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  />
                </label>
                <label className="inline">
                  @
                  <input
                    className="num tiny"
                    type="number"
                    min={1}
                    max={250}
                    step="any"
                    value={n.clock}
                    onChange={(e) => updatePlan((p) => void (p.nodes.find((y) => y.id === n.id)!.clock = Math.min(250, Math.max(1, Number(e.target.value) || 100))))}
                  />
                  %
                </label>
                <span className="muted small">{shards ? `${shards} shard${shards > 1 ? 's' : ''} each` : ''}</span>
                <span className="spacer" />
                <b>
                  {num(r)} {unitOf(n.resource)}
                </b>
                <button className="icon-btn" onClick={() => updatePlan((p) => void (p.nodes = p.nodes.filter((x) => x.id !== n.id)))}>
                  ×
                </button>
              </div>
              {RESOURCES[n.resource]?.solid && perNode > belt.rate && (
                <div className="small warn-text">
                  One node makes {num(perNode)}/min, more than a {belt.name} belt carries ({belt.rate}/min).
                </div>
              )}
              {EXTRACTORS.find((x) => x.id === n.extractor)?.note && <div className="small muted">{EXTRACTORS.find((x) => x.id === n.extractor)!.note}</div>}
            </div>
          );
        })}
      </div>
      <button
        className="btn"
        onClick={() =>
          updatePlan((p) =>
            void p.nodes.push({ id: uid(), resource: 'Desc_OreIron_C', purity: 'normal', extractor: settings.minerId, clock: settings.minerClock, count: 1 }),
          )
        }
      >
        + Add nodes
      </button>

      <h3>Need vs. have</h3>
      {rows.length === 0 ? (
        <p className="muted small">Add an output to see what it needs.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Input</th>
              <th className="r">Need</th>
              <th className="r">Have</th>
              <th className="r">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ it, need, have }) => {
              const diff = have === undefined ? null : have - need;
              return (
                <tr key={it} className={bottlenecks.includes(it) ? 'bottleneck' : ''}>
                  <td>
                    <span className="item-cell">
                      <ItemIcon item={it} size={18} /> {itemName(it)}
                    </span>
                  </td>
                  <td className="r">{num(need)}</td>
                  <td className="r">{have === undefined ? <span className="muted">no limit</span> : num(have)}</td>
                  <td className={'r ' + (diff === null ? '' : diff < -1e-3 ? 'bad-text' : 'good-text')}>
                    {diff === null ? '' : diff < -1e-3 ? `short ${num(-diff)}` : diff < 1e-3 ? 'exactly enough' : `+${num(diff)} spare`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {bottlenecks.length > 0 && (
        <p className="small">
          <b>Limiting input{bottlenecks.length > 1 ? 's' : ''}:</b> {bottlenecks.map(itemName).join(', ')}. Get more of {bottlenecks.length > 1 ? 'these' : 'this'} to
          make more.
        </p>
      )}
      {maxResult?.status === 'ok' && (
        <div className="callout">
          With only these inputs you can make <b>{pct(maxResult.scale * 100, 1)}</b> of your target:
          <ul>
            {plan.targets
              .filter((t) => t.item && t.rate > 0)
              .map((t) => (
                <li key={t.id}>
                  <ItemIcon item={t.item} size={16} /> {itemName(t.item)}: {num(t.rate * maxResult.scale)} {unitOf(t.item)}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
