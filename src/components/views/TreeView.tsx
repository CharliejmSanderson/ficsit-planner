import { useMemo, useState } from 'react';
import { useSolution } from '../../lib/engine';
import { useStore } from '../../lib/store';
import { BUILDINGS, POWER, itemName, unitOf } from '../../lib/gamedata';
import { buildTree, roundUpTo, type TreeItem, type TreeSource } from '../../lib/analysis';
import { num, pct } from '../../lib/format';
import { ItemIcon, BuildingIcon } from '../ItemIcon';

export function TreeView() {
  const { analysis, result, plan, settings } = useSolution();
  const setUI = useStore((s) => s.setUI);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [depthLimit, setDepthLimit] = useState<number | null>(null);

  const tree = useMemo(() => {
    if (!analysis || !result) return [];
    const targets: [string, number][] = Object.entries(result.outputs).filter(([it, v]) => v > 1e-9 && it !== POWER);
    // Generators (power output and/or powering this factory) get their own root
    if (analysis.generatedPower > 0) targets.push([POWER, analysis.generatedPower]);
    return buildTree(analysis, targets);
  }, [analysis, result]);

  if (!analysis) return null;

  const isCollapsed = (id: string, depth: number) => (id in collapsed ? collapsed[id] : depthLimit !== null && depth >= depthLimit);
  const toggle = (id: string, depth: number) => setCollapsed((c) => ({ ...c, [id]: !isCollapsed(id, depth) }));

  const renderItem = (n: TreeItem, depth: number): JSX.Element => {
    const kids = n.sources.flatMap((s) => s.children);
    const hasKids = kids.length > 0;
    const coll = isCollapsed(n.id, depth);
    const single = n.sources.length === 1 ? n.sources[0] : null;
    return (
      <li key={n.id} className="tree-li">
        <div className={'tree-row depth-' + Math.min(depth, 6)}>
          <span className={'caret' + (hasKids ? '' : ' none')} onClick={() => hasKids && toggle(n.id, depth)}>
            {hasKids ? (coll ? '▸' : '▾') : '•'}
          </span>
          <ItemIcon item={n.item} size={24} />
          <span className="tree-name" onClick={() => setUI({ sideTab: 'recipes', focusItem: n.item })} title="Show recipe options">
            {itemName(n.item)}
          </span>
          <span className="tree-rate">
            {num(n.rate)} <span className="unit">{unitOf(n.item)}</span>
          </span>
          {single ? <SourceInfo s={single} decimals={settings.clockDecimals} /> : <span className="muted small">from {n.sources.length} sources</span>}
        </div>
        {!single &&
          !coll &&
          n.sources.map((s, i) => (
            <div key={i} className="tree-row sub-source">
              <span className="caret none" />
              <span className="muted small">{num(s.rate)} from</span>
              <SourceInfo s={s} decimals={settings.clockDecimals} />
            </div>
          ))}
        {hasKids && !coll && <ul className="tree-ul">{kids.map((k) => renderItem(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="tree-view">
      <div className="toolbar">
        <button className="btn small" onClick={() => (setCollapsed({}), setDepthLimit(null))}>
          Expand all
        </button>
        <button className="btn small" onClick={() => (setCollapsed({}), setDepthLimit(1))}>
          Collapse all
        </button>
        <button className="btn small" onClick={() => (setCollapsed({}), setDepthLimit(3))}>
          3 levels
        </button>
        <span className="muted small">Click an item name to change its recipe. Shared parts show up in every branch that uses them; the Items tab has the totals.</span>
      </div>
      <ul className="tree-ul root">{tree.map((t) => renderItem(t, 0))}</ul>
    </div>
  );
}

function SourceInfo({ s, decimals }: { s: TreeSource; decimals: number }) {
  const { analysis } = useSolution();
  if (s.kind === 'supply') return <span className="src raw">raw input / supplied</span>;
  if (s.kind === 'reuse') return <span className="src reuse">↺ reused byproduct</span>;
  if (s.kind === 'missing') return <span className="src bad">✖ can’t be made with your unlocked recipes</span>;
  if (s.kind === 'loop') return <span className="src muted">↻ loops back (made further up)</span>;
  const st = analysis!.stepByKey[s.stepKey!];
  const m = s.machines ?? 0;
  const n = Math.max(1, Math.ceil(m - 1e-6));
  const clock = roundUpTo((m / n) * 100, decimals);
  return (
    <span className="src">
      <BuildingIcon building={st.recipe.building} size={18} />
      <span className="machines">
        {num(m)} × {BUILDINGS[st.recipe.building]?.name}
        {st.sloop ? ' ✦' : ''}
      </span>
      <span className="clock" title="Machines to build at this exact clock speed">
        → {n} @ {pct(clock, decimals)}
      </span>
      <span className="muted small recipe-name">{st.recipe.name}</span>
      {s.byproducts.length > 0 && (
        <span className="byp-chip" title="Byproducts">
          +{' '}
          {s.byproducts.map(([it, v]) => (
            <span key={it}>
              {num(v)} <ItemIcon item={it} size={14} />
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
