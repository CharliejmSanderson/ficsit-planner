import { useEffect, useRef, useState } from 'react';
import { useStore, useActivePlan, type ViewTab, type SideTab } from './lib/store';
import { SolutionProvider, useSolution } from './lib/engine';
import { OBJECTIVES, type Objective } from './lib/types';
import { itemName, unitOf } from './lib/gamedata';
import { num, pct } from './lib/format';
import { GraphView } from './components/views/GraphView';
import { TreeView } from './components/views/TreeView';
import { ItemsView } from './components/views/ItemsView';
import { BuildingsView } from './components/views/BuildingsView';
import { OutputsPanel } from './components/side/OutputsPanel';
import { InputsPanel } from './components/side/InputsPanel';
import { RecipesPanel } from './components/side/RecipesPanel';
import { ByproductsPanel } from './components/side/ByproductsPanel';
import { SettingsModal } from './components/SettingsModal';
import { useCloud, saveNow, type CloudState } from './lib/cloud';
import { NotesPage } from './components/NotesPage';
import { useUpdateAvailable, BUILD_TIME } from './lib/version';

const VIEW_TABS: { id: ViewTab; label: string; short: string; icon: string }[] = [
  { id: 'graph', label: 'Network graph', short: 'Graph', icon: '⛓' },
  { id: 'tree', label: 'Tree list', short: 'Tree', icon: '☰' },
  { id: 'items', label: 'Items', short: 'Items', icon: '▦' },
  { id: 'buildings', label: 'Buildings & power', short: 'Buildings', icon: '🏭' },
];

export default function App() {
  const plan = useActivePlan();
  const settings = useStore((s) => s.settings);
  const settingsOpen = useStore((s) => s.ui.settingsOpen);
  const page = useStore((s) => s.ui.page) ?? 'planner';
  return (
    <SolutionProvider plan={plan} settings={settings}>
      <div className="app">
        <Header />
        {page === 'notes' ? <NotesPage /> : <Main />}
      </div>
      {settingsOpen && <SettingsModal />}
    </SolutionProvider>
  );
}

function Header() {
  const { plans, activeId, setActive, addPlan, removePlan, duplicatePlan, updatePlan, setUI, settings } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const unlocked = Object.values(settings.unlockedAlts).filter(Boolean).length;
  const page = useStore((s) => s.ui.page) ?? 'planner';
  const noteCount = useStore((s) => s.notes.length);
  const update = useUpdateAvailable();
  return (
    <header className="header">
      <div className="brand" title={`Version ${new Date(BUILD_TIME).toLocaleString()}`}>
        <span className="brand-mark">F</span>
        <span>FICSIT Planner</span>
      </div>
      <nav className="plan-tabs">
        {plans.map((p) => (
          <div
            key={p.id}
            className={'plan-tab' + (p.id === activeId && page === 'planner' ? ' active' : '')}
            onClick={() => {
              setActive(p.id);
              setUI({ page: 'planner' });
            }}
          >
            {editing === p.id ? (
              <input
                autoFocus
                defaultValue={p.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) updatePlan((pl) => void (pl.name = v));
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                }}
              />
            ) : (
              <span onDoubleClick={() => p.id === activeId && setEditing(p.id)} title="Double-click to rename">
                {p.name}
              </span>
            )}
            {p.id === activeId && plans.length > 1 && (
              <button
                className="tab-x"
                title="Delete this factory"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${p.name}"?`)) removePlan(p.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="plan-add" onClick={addPlan} title="New factory">
          +
        </button>
        <button className="plan-add" onClick={duplicatePlan} title="Duplicate this factory">
          ⧉
        </button>
      </nav>
      <div className="header-right">
        {update && (
          <button
            className="chip update"
            title="A newer version of the planner has been published"
            onClick={async () => {
              await saveNow();
              location.reload();
            }}
          >
            ↻ New version: reload
          </button>
        )}
        <button
          className={'chip notes-btn' + (page === 'notes' ? ' on' : '')}
          onClick={() => setUI({ page: page === 'notes' ? 'planner' : 'notes' })}
          title="Your notes"
        >
          📝 Notes{noteCount ? ` (${noteCount})` : ''}
        </button>
        <CloudChip />
        <button className="chip" onClick={() => setUI({ settingsOpen: true, settingsTab: 'alts' })} title="Tier, unlocked alternates, MAM research, clock precision">
          Tier {settings.tier} · {unlocked} alternate{unlocked === 1 ? '' : 's'} · ⚙ Unlocks & settings
        </button>
      </div>
    </header>
  );
}

function CloudChip() {
  const cloud = useCloud();
  const setUI = useStore((s) => s.setUI);
  const time = cloud.lastSaved ? new Date(cloud.lastSaved).toLocaleString() : null;
  const view: Record<CloudState, [string, string, string]> = {
    loading: ['☁ Loading save…', '', 'Loading your save from GitHub'],
    saving: ['☁ Saving…', '', 'Saving to GitHub'],
    unsaved: ['☁ Saving soon…', '', 'Your change will save to GitHub in a few seconds'],
    saved: ['☁ Saved', 'good', time ? `Saved to GitHub ${time}` : 'Saved to GitHub'],
    readonly: ['☁ Auto-save off', 'warn', 'Changes are only kept in this browser. Click to turn on auto-save to GitHub.'],
    offline: ['☁ Offline', 'warn', 'Can’t reach GitHub. Changes are kept in this browser and will save when you’re back online.'],
    error: ['⚠ Save failed', 'bad', cloud.message ?? 'Saving to GitHub failed'],
  };
  const [label, cls, title] = view[cloud.state];
  return (
    <button className={'chip cloud ' + cls} title={title} onClick={() => setUI({ settingsOpen: true, settingsTab: 'sync' })}>
      {label}
    </button>
  );
}

function Main() {
  const ui = useStore((s) => s.ui);
  const setUI = useStore((s) => s.setUI);
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(Math.max(window.innerWidth - e.clientX, 340), Math.max(360, window.innerWidth * 0.6));
      setUI({ sideWidth: w });
    };
    const up = () => {
      dragging.current = false;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [setUI]);
  return (
    <main className="layout" style={{ gridTemplateColumns: `1fr 6px ${ui.sideWidth}px` }}>
      <section className={'views' + (ui.split ? ' split' : '')}>
        <ViewPane index={0} />
        {ui.split && <ViewPane index={1} />}
      </section>
      <div
        className="resizer"
        onMouseDown={() => {
          dragging.current = true;
          document.body.classList.add('resizing');
        }}
      />
      <SidePanel />
    </main>
  );
}

function ViewPane({ index }: { index: 0 | 1 }) {
  const ui = useStore((s) => s.ui);
  const setUI = useStore((s) => s.setUI);
  const tab = ui.views[index];
  const setTab = (t: ViewTab) => {
    const v: [ViewTab, ViewTab] = [...ui.views];
    v[index] = t;
    setUI({ views: v });
  };
  return (
    <div className="pane">
      <div className="tabbar">
        {VIEW_TABS.map((t) => (
          <button key={t.id} className={'tab' + (t.id === tab ? ' active' : '')} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span> {ui.split ? t.short : t.label}
          </button>
        ))}
        <div className="spacer" />
        {index === (ui.split ? 1 : 0) && (
          <button
            className={'tab split-btn' + (ui.split ? ' active' : '')}
            title={ui.split ? 'Close the second view' : 'Show two views side by side'}
            onClick={() => setUI({ split: !ui.split })}
          >
            {ui.split ? '◧ Single' : '◫ Split view'}
          </button>
        )}
      </div>
      <div className="pane-body">
        <StatusOverlay />
        {tab === 'graph' && <GraphView />}
        {tab === 'tree' && <TreeView />}
        {tab === 'items' && <ItemsView />}
        {tab === 'buildings' && <BuildingsView />}
      </div>
    </div>
  );
}

function StatusOverlay() {
  const { plan, result, loading } = useSolution();
  if (!plan.targets.some((t) => t.item && (t.rate > 0 || t.max))) {
    return (
      <div className="empty-state">
        <h2>What do you want to make?</h2>
        <p>Add an output on the right (for example Heavy Modular Frame, 5 /min) and the full production chain appears here.</p>
      </div>
    );
  }
  if (result?.status === 'error') {
    return <div className="banner bad">Couldn’t solve this plan: {result.message}</div>;
  }
  return loading && !result ? <div className="banner">Calculating…</div> : null;
}

const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: 'outputs', label: 'Outputs' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'byproducts', label: 'Byproducts' },
];

function SidePanel() {
  const { plan, result, maxResult, loading, analysis, advice } = useSolution();
  const updatePlan = useStore((s) => s.updatePlan);
  const sideTab = useStore((s) => s.ui.sideTab);
  const setUI = useStore((s) => s.setUI);
  const obj = OBJECTIVES.find((o) => o.id === plan.objective)!;
  const byCount = analysis?.byproducts.filter((b) => b.waste > 1e-6).length ?? 0;
  const sugCount = advice.suggestions.length;
  const missing = result ? Object.keys(result.missing) : [];
  const shortfall = result ? Object.keys(result.shortfall) : [];
  return (
    <aside className="side">
      <div className="side-head">
        <label className="field">
          <span>Optimise for</span>
          <select value={plan.objective} onChange={(e) => updatePlan((p) => void (p.objective = e.target.value as Objective))}>
            {OBJECTIVES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="hint">{obj.hint}</div>
        <div className="status-line">
          {loading && <span className="spinner" />}
          {result?.status === 'ok' && result.mode === 'max' && plan.objective === 'output' && !plan.targets.some((t) => t.max) && (
            <span className="pill good">Max: {pct(result.scale * 100, 1)} of your target rates</span>
          )}
          {result?.status === 'ok' &&
            result.mode === 'max' &&
            plan.targets
              .filter((t) => t.max && t.item)
              .map((t) => (
                <span key={t.id} className="pill good">
                  Max {itemName(t.item)}: {num((t.rate > 0 ? t.rate : 1) * result.scale)} {unitOf(t.item)}
                </span>
              ))}
          {result?.status === 'ok' && result.usedWorldLimits && <span className="pill warn">Using the whole map’s resources (no inputs set)</span>}
          {maxResult?.status === 'ok' && (
            <span className={'pill ' + (maxResult.scale >= 1 - 1e-6 ? 'good' : 'warn')} title="With only the inputs you set on the Inputs tab">
              Your inputs can make {pct(maxResult.scale * 100, 1)} of this
            </span>
          )}
          {missing.length > 0 && <span className="pill bad">Can’t make: {missing.map(itemName).join(', ')}</span>}
          {shortfall.length > 0 && <span className="pill warn">Short on {shortfall.map(itemName).join(', ')}</span>}
        </div>
      </div>
      <div className="tabbar side-tabs">
        {SIDE_TABS.map((t) => (
          <button key={t.id} className={'tab' + (t.id === sideTab ? ' active' : '')} onClick={() => setUI({ sideTab: t.id })}>
            {t.label}
            {t.id === 'byproducts' && byCount > 0 && <span className="badge warn">{byCount}</span>}
            {t.id === 'recipes' && sugCount > 0 && <span className="badge">{sugCount}</span>}
          </button>
        ))}
      </div>
      <div className="side-body">
        {sideTab === 'outputs' && <OutputsPanel />}
        {sideTab === 'inputs' && <InputsPanel />}
        {sideTab === 'recipes' && <RecipesPanel />}
        {sideTab === 'byproducts' && <ByproductsPanel />}
      </div>
    </aside>
  );
}

