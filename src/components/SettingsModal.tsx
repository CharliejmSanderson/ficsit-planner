import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { RECIPES, BUILDINGS, EXTRACTORS, itemName, type Purity } from '../lib/gamedata';
import { ItemIcon, BuildingIcon } from './ItemIcon';
import { RecipeLine } from './side/RecipesPanel';

const ALTS = Object.values(RECIPES)
  .filter((r) => r.alt)
  .sort((a, b) => itemName(a.out[0][0]).localeCompare(itemName(b.out[0][0])) || a.name.localeCompare(b.name));
const MAM = Object.values(RECIPES)
  .filter((r) => r.source === 'mam' && !r.alt)
  .sort((a, b) => a.unlockLabel.localeCompare(b.unlockLabel) || a.name.localeCompare(b.name));

export function SettingsModal() {
  const { settings, setSettings, setUI, plans, importAll } = useStore();
  const [tab, setTab] = useState<'alts' | 'mam' | 'general' | 'backup'>('alts');
  const [q, setQ] = useState('');
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => setUI({ settingsOpen: false });

  const alts = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ALTS.filter(
      (r) =>
        (!s || r.name.toLowerCase().includes(s) || itemName(r.out[0][0]).toLowerCase().includes(s) || r.in.some(([i]) => itemName(i).toLowerCase().includes(s))) &&
        (!onlyUnlocked || settings.unlockedAlts[r.id]),
    );
  }, [q, onlyUnlocked, settings.unlockedAlts]);
  const unlockedCount = ALTS.filter((r) => settings.unlockedAlts[r.id]).length;

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ app: 'ficsit-planner', version: 1, settings, plans }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ficsit-planner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Unlocks & settings</h2>
          <button className="icon-btn" onClick={close}>
            ×
          </button>
        </div>
        <div className="tabbar">
          <button className={'tab' + (tab === 'alts' ? ' active' : '')} onClick={() => setTab('alts')}>
            Alternate recipes ({unlockedCount}/{ALTS.length})
          </button>
          <button className={'tab' + (tab === 'general' ? ' active' : '')} onClick={() => setTab('general')}>
            Tier & game
          </button>
          <button className={'tab' + (tab === 'mam' ? ' active' : '')} onClick={() => setTab('mam')}>
            MAM research
          </button>
          <button className={'tab' + (tab === 'backup' ? ' active' : '')} onClick={() => setTab('backup')}>
            Backup
          </button>
        </div>
        <div className="modal-body">
          {tab === 'alts' && (
            <>
              <div className="row">
                <input className="search" placeholder="Search by recipe, product or ingredient…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <label className="check small">
                  <input type="checkbox" checked={onlyUnlocked} onChange={(e) => setOnlyUnlocked(e.target.checked)} /> Unlocked only
                </label>
              </div>
              <p className="muted small">Tick the alternates you’ve unlocked from hard drives. Plans use standard recipes and suggest these when they help.</p>
              <div className="alt-grid">
                {alts.map((r) => {
                  const on = !!settings.unlockedAlts[r.id];
                  return (
                    <label key={r.id} className={'alt-card' + (on ? ' on' : '')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setSettings((s) => {
                            if (e.target.checked) s.unlockedAlts[r.id] = true;
                            else delete s.unlockedAlts[r.id];
                          })
                        }
                      />
                      <ItemIcon item={r.out[0][0]} size={28} />
                      <div className="grow">
                        <div>
                          <b>{r.name}</b>
                          {r.tier > settings.tier && <span className="tag">tier {r.tier}</span>}
                        </div>
                        <div className="recipe-meta">
                          <BuildingIcon building={r.building} size={16} />
                          <RecipeLine r={r} />
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {tab === 'general' && (
            <div className="form">
              <label className="field">
                <span>Highest tier you’ve completed</span>
                <select value={settings.tier} onChange={(e) => setSettings((s) => void (s.tier = Number(e.target.value)))}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                    <option key={t} value={t}>
                      Tier {t}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">Recipes and buildings from higher tiers are hidden. Your belt and pipe limits follow this too.</p>
              <label className="field">
                <span>Clock speed precision</span>
                <select value={settings.clockDecimals} onChange={(e) => setSettings((s) => void (s.clockDecimals = Number(e.target.value)))}>
                  <option value={2}>2 decimals (PS5 / Xbox controller)</option>
                  <option value={4}>4 decimals (PC keyboard)</option>
                </select>
              </label>
              <h3>Default extraction (for estimates)</h3>
              <label className="field">
                <span>Miner</span>
                <select value={settings.minerId} onChange={(e) => setSettings((s) => void (s.minerId = e.target.value))}>
                  {EXTRACTORS.filter((e) => e.resources === 'solid').map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Typical node purity</span>
                <select value={settings.purity} onChange={(e) => setSettings((s) => void (s.purity = e.target.value as Purity))}>
                  <option value="impure">Impure</option>
                  <option value="normal">Normal</option>
                  <option value="pure">Pure</option>
                </select>
              </label>
              <label className="field">
                <span>Max miner clock (power shards)</span>
                <select value={settings.minerClock} onChange={(e) => setSettings((s) => void (s.minerClock = Number(e.target.value)))}>
                  <option value={100}>100% (no shards)</option>
                  <option value={150}>150% (1 shard)</option>
                  <option value={200}>200% (2 shards)</option>
                  <option value={250}>250% (3 shards)</option>
                </select>
              </label>
            </div>
          )}
          {tab === 'mam' && (
            <>
              <p className="muted small">MAM recipes are treated as researched. Untick any you haven’t researched yet.</p>
              <div className="alt-grid">
                {MAM.map((r) => {
                  const on = !settings.mamOff[r.id];
                  return (
                    <label key={r.id} className={'alt-card' + (on ? ' on' : '')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setSettings((s) => {
                            if (e.target.checked) delete s.mamOff[r.id];
                            else s.mamOff[r.id] = true;
                          })
                        }
                      />
                      <ItemIcon item={r.out[0][0]} size={26} />
                      <div className="grow">
                        <div>
                          <b>{r.name}</b> <span className="muted small">· {r.unlockLabel}</span>
                        </div>
                        <div className="recipe-meta">
                          <BuildingIcon building={r.building} size={16} />
                          <span className="small muted">{BUILDINGS[r.building]?.name}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {tab === 'backup' && (
            <div className="form">
              <p className="small">
                Your factories and unlocks are saved in this browser automatically. Export a backup file to keep them safe or move them to another computer.
              </p>
              <div className="row">
                <button className="btn primary" onClick={exportData}>
                  Export backup
                </button>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  Import backup…
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const data = JSON.parse(await f.text());
                      if (!data.plans || !data.settings) throw new Error('Not a planner backup');
                      if (confirm('Replace your current factories and unlocks with this backup?')) importAll(data);
                    } catch (err) {
                      alert('Could not read that file: ' + (err as Error).message);
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
