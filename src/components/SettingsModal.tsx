import { useMemo, useRef, useState } from 'react';
import { useStore, type SettingsTab } from '../lib/store';
import { useCloud, connect, disconnect, saveNow, sync, restoreBackup, dismissBackup, REPO } from '../lib/cloud';
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
  const { settings, setSettings, setUI, plans, notes, importAll } = useStore();
  const initialTab = useStore((s) => s.ui.settingsTab) ?? 'alts';
  const [tab, setTab] = useState<SettingsTab>(initialTab);
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
    const blob = new Blob([JSON.stringify({ app: 'ficsit-planner', version: 1, settings, plans, notes }, null, 2)], { type: 'application/json' });
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
          <button className={'tab' + (tab === 'sync' ? ' active' : '')} onClick={() => setTab('sync')}>
            Save & sync
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
          {tab === 'sync' && (
            <div className="form">
              <SyncPanel />
              <h3>Backup file</h3>
              <p className="small muted">Download a copy of your factories and unlocks, or load one back in.</p>
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

function SyncPanel() {
  const cloud = useCloud();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const when = cloud.lastSaved ? new Date(cloud.lastSaved).toLocaleString() : null;
  const repoUrl = `https://github.com/${REPO.owner}/${REPO.name}/blob/${REPO.branch}/${REPO.path}`;

  const tone = cloud.state === 'error' ? 'bad' : cloud.connected && cloud.state !== 'offline' ? 'good' : 'warn';
  let headline: string;
  if (cloud.state === 'loading') headline = 'Loading your save from GitHub…';
  else if (cloud.state === 'error') headline = cloud.message ?? 'Something went wrong talking to GitHub.';
  else if (cloud.state === 'offline') headline = 'Can’t reach GitHub right now. Your changes are kept in this browser and will save when you’re back online.';
  else if (cloud.connected) headline = `Auto-save is on. Every change saves to GitHub a few seconds after you make it.${when ? ` Last saved ${when}.` : ''}`;
  else headline = 'This browser loads your saved factories from GitHub, but changes made here aren’t saved there yet.';

  return (
    <>
      <div className={'sync-status ' + tone}>
        <span>{tone === 'good' ? '☁' : tone === 'bad' ? '⚠' : '☁'}</span>
        <span className="small">{headline}</span>
      </div>

      {cloud.hasBackup && (
        <div className="callout">
          <div className="small">
            When this browser loaded your GitHub save, it had different factories of its own. They’re kept here in case you want them back.
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn small"
              onClick={() => {
                if (confirm('Replace your factories and unlocks with what this browser had before? That will also become your saved version.')) restoreBackup();
              }}
            >
              Restore this browser’s old factories
            </button>
            <button className="btn small" onClick={dismissBackup}>
              Discard them
            </button>
          </div>
        </div>
      )}

      {cloud.connected ? (
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={async () => (setBusy(true), await saveNow(), setBusy(false))}>
            Save now
          </button>
          <button className="btn" disabled={busy} onClick={async () => (setBusy(true), await sync(), setBusy(false))}>
            Reload from GitHub
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Stop saving from this browser? Your save on GitHub stays as it is.')) disconnect();
            }}
          >
            Disconnect this browser
          </button>
        </div>
      ) : (
        <>
          <h3>Turn on auto-save (one-time setup)</h3>
          <ol className="steps small">
            <li>
              Open{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                GitHub → new fine-grained token
              </a>{' '}
              (you may need to sign in).
            </li>
            <li>
              <b>Token name:</b> <code>FICSIT Planner</code>. <b>Expiration:</b> the longest it offers. You’ll make a new one when it runs out.
            </li>
            <li>
              <b>Repository access:</b> “Only select repositories” → <code>{REPO.name}</code>.
            </li>
            <li>
              <b>Permissions:</b> add <b>Contents</b> and set it to <b>Read and write</b>. Leave everything else alone.
            </li>
            <li>Click <b>Generate token</b>, copy it, and paste it below.</li>
          </ol>
          <div className="row">
            <input
              className="key-input"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={busy || !key.trim()}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await connect(key);
                  setKey('');
                } catch (e) {
                  setErr((e as Error).message);
                }
                setBusy(false);
              }}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {err && <div className="small bad-text">{err}</div>}
          <p className="small muted">
            The key is kept only in this browser and can only change files in the {REPO.name} repo. If this browser already has factories and GitHub has none,
            they’re uploaded; if GitHub has a newer save, it’s loaded.
          </p>
        </>
      )}
      <p className="small muted">
        Your save is a file in your repo:{' '}
        <a href={repoUrl} target="_blank" rel="noreferrer">
          {REPO.branch}/{REPO.path}
        </a>
        . The repo is public, so anyone with the link could see your factory plans (nothing else is in it).
      </p>
    </>
  );
}
