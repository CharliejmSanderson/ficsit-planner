import { useMemo } from 'react';
import { useSolution } from '../../lib/engine';
import { useStore } from '../../lib/store';
import { isRaw, itemName, unitOf, RECIPES_BY_MAIN } from '../../lib/gamedata';
import { num } from '../../lib/format';
import { ItemIcon } from '../ItemIcon';

export function ItemsView() {
  const { analysis } = useSolution();
  const setUI = useStore((s) => s.setUI);
  const rows = useMemo(() => {
    if (!analysis) return [];
    const tierOf = (it: string) => (isRaw(it) ? -1 : Math.min(...(RECIPES_BY_MAIN[it] ?? []).map((r) => r.tier), 99));
    return Object.values(analysis.flows).sort((a, b) => tierOf(a.item) - tierOf(b.item) || itemName(a.item).localeCompare(itemName(b.item)));
  }, [analysis]);
  if (!analysis) return null;
  return (
    <div className="scroll-view">
      <table className="table wide">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r" title="From raw nodes or inputs you supplied">Supplied</th>
            <th className="r">Made</th>
            <th className="r">Byproduct</th>
            <th className="r">Used</th>
            <th className="r">Output</th>
            <th className="r" title="Not used: byproduct leftovers and rounding">Left over</th>
            <th>Made by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const makers = analysis.steps.filter((s) => s.recipe.out[0][0] === f.item);
            return (
              <tr key={f.item} className={f.missing > 0 ? 'missing' : ''}>
                <td>
                  <span className="item-cell link-like" onClick={() => setUI({ sideTab: isRaw(f.item) ? 'inputs' : 'recipes', focusItem: f.item })}>
                    <ItemIcon item={f.item} size={20} /> {itemName(f.item)}
                    <span className="unit">{unitOf(f.item)}</span>
                  </span>
                </td>
                <td className="r">{f.supplied ? num(f.supplied) : ''}</td>
                <td className="r">{f.produced ? num(f.produced) : ''}</td>
                <td className="r">{f.byproduct ? num(f.byproduct) : ''}</td>
                <td className="r">{f.consumed ? num(f.consumed) : ''}</td>
                <td className="r out">{f.output ? num(f.output) : ''}</td>
                <td className={'r ' + (f.waste + f.surplus > 1e-3 ? 'warn-text' : '')}>{f.waste + f.surplus > 1e-3 ? num(f.waste + f.surplus) : ''}</td>
                <td className="small">
                  {f.missing > 0 ? (
                    <span className="bad-text">no unlocked recipe</span>
                  ) : isRaw(f.item) && !makers.length ? (
                    <span className="muted">mined / extracted</span>
                  ) : (
                    makers.map((s) => `${s.recipe.name} (${num(s.machines)})`).join(', ')
                  )}
                  {f.reused > 0 && <span className="good-text"> ↺ {num(f.reused)} reused</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
