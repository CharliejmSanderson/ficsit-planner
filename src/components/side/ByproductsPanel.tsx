import { useState } from 'react';
import { useStore } from '../../lib/store';
import { useSolution } from '../../lib/engine';
import { BUILDINGS, POWER, itemName, unitOf, RECIPES } from '../../lib/gamedata';
import { allowedRecipesFor, defaultRecipesFor, isAvailable } from '../../lib/recipes';
import { byproductAdvice, type ByproductInfo } from '../../lib/analysis';
import { uid } from '../../lib/types';
import { num, mw } from '../../lib/format';
import { ItemIcon, BuildingIcon } from '../ItemIcon';

export function ByproductsPanel() {
  const { analysis } = useSolution();
  if (!analysis) return <div className="panel muted small">Add an output first.</div>;
  const list = analysis.byproducts;
  const surplus = Object.values(analysis.flows).filter((f) => f.surplus > 1e-3 && f.produced > 0);
  return (
    <div className="panel">
      <p className="muted small">
        Byproducts are the extra things a recipe makes, like water from aluminium scrap or heavy oil residue from plastic. A machine stops if its byproduct
        has nowhere to go, so each one needs a plan.
      </p>
      {!list.length && <p className="good-text">This factory makes no byproducts.</p>}
      <div className="list">
        {list.map((b) => (
          <ByproductCard key={b.item} b={b} />
        ))}
      </div>
      {surplus.length > 0 && (
        <>
          <h3>Extra output</h3>
          <div className="list">
            {surplus.map((f) => (
              <div key={f.item} className="row">
                <ItemIcon item={f.item} size={20} /> {itemName(f.item)}
                <span className="spacer" />
                {num(f.surplus)} {unitOf(f.item)} more than needed
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ByproductCard({ b }: { b: ByproductInfo }) {
  const { plan, settings, analysis } = useSolution();
  const updatePlan = useStore((s) => s.updatePlan);
  const [showAdvice, setShowAdvice] = useState(false);
  const sources = b.sources.map((k) => analysis!.stepByKey[k]?.recipe.name).filter(Boolean);

  const setReuse = (v: boolean) =>
    updatePlan((p) => {
      if (v) p.reuse[b.item] = true;
      else delete p.reuse[b.item];
    });

  return (
    <div className={'row-card byp ' + (b.waste > 1e-6 ? (b.usableHere ? 'can' : 'warn') : 'ok')}>
      <div className="row">
        <ItemIcon item={b.item} size={26} />
        <div className="grow">
          <div>
            <b>{itemName(b.item)}</b>{' '}
            <span className="muted">
              {num(b.produced)} {unitOf(b.item)}
            </span>
          </div>
          <div className="small muted">from {sources.join(', ')}</div>
        </div>
      </div>
      {b.reused > 1e-6 && (
        <div className="small good-text">
          ↺ {num(b.reused)} {unitOf(b.item)} reused in this factory{b.forced && !b.allowed ? ' (nothing else here makes it, so it has to be)' : ''}.
        </div>
      )}
      {b.waste > 1e-6 && b.usableHere && !b.allowed && (
        <div className="ask">
          <div className="small">
            This factory also needs <b>{num(b.demandHere)}</b> {unitOf(b.item)} of {itemName(b.item)}. Use the byproduct for that instead?
          </div>
          <button className="btn primary small" onClick={() => setReuse(true)}>
            Yes, reuse it
          </button>
        </div>
      )}
      {b.allowed && (
        <label className="check small">
          <input type="checkbox" checked onChange={() => setReuse(false)} /> Reuse allowed
        </label>
      )}
      {b.waste > 1e-6 && (
        <div className="row small">
          <span className="warn-text">
            {num(b.waste)} {unitOf(b.item)} left over{b.usableHere && !b.allowed ? '' : ' with no use in this factory'}
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => setShowAdvice(!showAdvice)}>
            {showAdvice ? 'Hide' : 'What should I do with it?'}
          </button>
        </div>
      )}
      {showAdvice && <Advice item={b.item} rate={b.waste} />}
    </div>
  );

  function Advice({ item, rate }: { item: string; rate: number }) {
    const adv = byproductAdvice(item, rate, (r) => isAvailable(r, settings));
    const makeHere = (recipeId: string, product: string, productRate: number) =>
      updatePlan((p) => {
        p.reuse[item] = true;
        const cur = allowedRecipesFor(product, p, settings);
        if (!cur.includes(recipeId)) {
          const next = [...cur, recipeId];
          const def = defaultRecipesFor(product, p, settings);
          if (!(next.length === def.length && next.every((x) => def.includes(x)))) p.recipeChoice[product] = next;
        }
        const ex = p.targets.find((t) => t.item === product);
        if (ex) ex.rate += productRate;
        else p.targets.push({ id: uid(), item: product, rate: Number(productRate.toFixed(4)) });
      });
    return (
      <div className="advice">
        {adv.warning && <div className="small warn-text">⚠ {adv.warning}</div>}
        {adv.cannotSink && <div className="small">{adv.cannotSink}</div>}
        {adv.sink && (
          <div className="advice-opt">
            <b>Sink it</b>
            <div className="small">
              {adv.sink.via ? `Package it into ${itemName(adv.sink.via)} first, then ` : ''}send it to the AWESOME Sink for about{' '}
              <b>{num(adv.sink.points, 0)}</b> points/min.
            </div>
          </div>
        )}
        {adv.burn.length > 0 && (
          <div className="advice-opt">
            <b>Burn it for power</b>
            {adv.burn.map((u) => (
              <div key={u.recipe.id} className="row small">
                <BuildingIcon building={u.recipe.building} size={18} />
                {num(u.count)} × {BUILDINGS[u.recipe.building]?.name} → <b>{mw(u.mw)}</b>
                <span className="spacer" />
                <button className="btn small" onClick={() => makeHere(u.recipe.id, POWER, u.mw)}>
                  Add to plan
                </button>
              </div>
            ))}
          </div>
        )}
        {adv.uses.length > 0 && (
          <div className="advice-opt">
            <b>Turn it into something</b>
            <div className="small muted">Using all {num(rate)} {unitOf(item)}:</div>
            {adv.uses.slice(0, 8).map((u) => (
              <div key={u.recipe.id} className="use-row small">
                <div className="row">
                  <ItemIcon item={u.product} size={18} />
                  <span>
                    <b>{num(u.productRate)}</b> {unitOf(u.product)} {itemName(u.product)}
                  </span>
                  <span className="muted">via {u.recipe.name}</span>
                  <span className="spacer" />
                  <button className="btn small" onClick={() => makeHere(u.recipe.id, u.product, u.productRate)} title="Adds this as an extra output and reuses the byproduct">
                    Make it here
                  </button>
                </div>
                {u.otherInputs.length > 0 && (
                  <div className="muted">
                    also needs {u.otherInputs.map(([i, v]) => `${num(v)} ${itemName(i)}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!adv.sink && !adv.uses.length && !adv.burn.length && (
          <div className="small">Nothing you’ve unlocked uses this. Store it for now, or check the Hard drive advisor for recipes that do.</div>
        )}
        <div className="advice-opt">
          <b>Send it elsewhere</b>
          <div className="small muted">Belt or pipe it to another factory that needs it, or into storage as a buffer.</div>
        </div>
      </div>
    );
  }
}

