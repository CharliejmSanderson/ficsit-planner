/**
 * Auto-save to GitHub.
 *
 * Your factories and unlocked recipes are stored in save.json on the `saves` branch of the repo.
 * Any browser can read it (the repo is public), so the planner always opens with your latest save.
 * A browser you've connected with a GitHub access key also writes every change back, a few seconds
 * after you make it. The `saves` branch is separate from `main`, so saving never redeploys the site.
 */
import { create } from 'zustand';
import { useStore, type SaveData } from './store';

export const REPO = { owner: 'CharliejmSanderson', name: 'ficsit-planner', branch: 'saves', path: 'save.json' };
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${REPO.path}`;
const RAW = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${REPO.path}`;
const TOKEN_KEY = 'ficsit-planner-github-key';
const BACKUP_KEY = 'ficsit-planner-before-sync';
const SAVE_DELAY = 2500;

export interface SaveFile {
  app: 'ficsit-planner';
  version: 1;
  updatedAt: number;
  data: SaveData | null;
}

export type CloudState = 'loading' | 'saving' | 'saved' | 'unsaved' | 'readonly' | 'offline' | 'error';

interface CloudStatus {
  state: CloudState;
  connected: boolean;
  lastSaved: number | null;
  message: string | null;
  hasBackup: boolean;
}

export const useCloud = create<CloudStatus>(() => ({
  state: 'loading',
  connected: false,
  lastSaved: null,
  message: null,
  hasBackup: false,
}));
const status = (patch: Partial<CloudStatus>) => useCloud.setState(patch);

// --- storage helpers (never throw: storage can be blocked) -------------------------------
const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};
export const getKey = () => ls.get(TOKEN_KEY);

// --- encoding ------------------------------------------------------------------------------
function toB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- GitHub API ------------------------------------------------------------------------------
export interface Remote {
  file: SaveFile | null;
  sha: string | null;
}

type Fetch = typeof fetch;
let http: Fetch = (...a) => fetch(...a);
/** for tests */
export function setFetch(f: Fetch) {
  http = f;
}

function headers(key: string | null): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export class CloudError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

function explain(status: number, action: 'read' | 'save'): string {
  if (status === 401) return 'GitHub didn’t accept the key. It may have expired or been deleted: make a new one.';
  if (status === 403 || status === 404)
    return action === 'save'
      ? 'The key can’t save to the repo. Check it has access to ficsit-planner with Contents set to “Read and write”.'
      : 'Couldn’t read the save file from GitHub.';
  if (status === 429) return 'GitHub is rate-limiting requests. It will retry shortly.';
  return `GitHub error ${status}.`;
}

export async function readRemote(key: string | null): Promise<Remote> {
  let res: Response;
  try {
    res = await http(`${API}?ref=${REPO.branch}`, { headers: headers(key), cache: 'no-store' });
  } catch {
    throw new CloudError('Can’t reach GitHub (offline?)');
  }
  if (res.status === 404 && !key) return { file: null, sha: null };
  if ((res.status === 403 || res.status === 429) && !key) {
    // unauthenticated rate limit: fall back to the raw file (may be a few minutes old)
    try {
      const raw = await http(RAW, { cache: 'no-store' });
      if (raw.ok) return { file: JSON.parse(await raw.text()) as SaveFile, sha: null };
    } catch {
      /* fall through */
    }
  }
  if (res.status === 404) return { file: null, sha: null };
  if (!res.ok) throw new CloudError(explain(res.status, 'read'), res.status);
  const body = await res.json();
  return { file: JSON.parse(fromB64(body.content)) as SaveFile, sha: body.sha };
}

export async function writeRemote(key: string, file: SaveFile, sha: string | null, keepalive = false): Promise<string> {
  const body = JSON.stringify({
    message: `Auto-save: ${file.data?.plans.length ?? 0} factories, ${Object.keys(file.data?.settings.unlockedAlts ?? {}).length} alternates`,
    content: toB64(JSON.stringify(file, null, 1)),
    branch: REPO.branch,
    ...(sha ? { sha } : {}),
  });
  let res: Response;
  try {
    // keepalive (used when the page closes) only allows small bodies
    const ka = keepalive && body.length < 60000;
    res = await http(API, { method: 'PUT', headers: { ...headers(key), 'Content-Type': 'application/json' }, body, keepalive: ka });
  } catch {
    throw new CloudError('Can’t reach GitHub (offline?)');
  }
  if (!res.ok) throw new CloudError(explain(res.status, 'save'), res.status);
  const out = await res.json();
  return out.content.sha as string;
}

// --- sync -----------------------------------------------------------------------------------
let remoteSha: string | null = null;
let remoteUpdatedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;
let applying = false;
let started = false;

function currentSave(): SaveFile {
  const st = useStore.getState();
  return { app: 'ficsit-planner', version: 1, updatedAt: st.savedAt, data: { settings: st.settings, plans: st.plans, activeId: st.activeId } };
}

const hasContent = (d: SaveData) =>
  d.plans.some((p) => p.targets.length || p.inputs.length || p.nodes.length) || Object.keys(d.settings.unlockedAlts).length > 0;

function applyRemote(file: SaveFile) {
  const st = useStore.getState();
  const local = currentSave().data!;
  // keep what this browser had, in case it mattered
  if (hasContent(local) && JSON.stringify(local) !== JSON.stringify(file.data)) {
    ls.set(BACKUP_KEY, JSON.stringify({ at: Date.now(), data: local }));
    status({ hasBackup: true });
  }
  applying = true;
  try {
    st.applySave(file.data!, file.updatedAt);
  } finally {
    applying = false;
  }
}

/** Save now (if this browser is connected). Retries once on a conflict. */
export async function saveNow(keepalive = false): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const key = getKey();
  if (!key) return;
  if (saving) await saving.catch(() => undefined);
  const file = currentSave();
  if (file.updatedAt <= remoteUpdatedAt && remoteSha) {
    status({ state: 'saved' });
    return;
  }
  status({ state: 'saving', message: null });
  saving = (async () => {
    try {
      try {
        remoteSha = await writeRemote(key, file, remoteSha, keepalive);
      } catch (e) {
        if (!(e instanceof CloudError) || (e.status !== 409 && e.status !== 422)) throw e;
        // the file changed since we last saw it (e.g. saved from another browser): last save wins
        remoteSha = (await readRemote(key)).sha;
        remoteSha = await writeRemote(key, file, remoteSha, keepalive);
      }
      remoteUpdatedAt = file.updatedAt;
      status({ state: currentSave().updatedAt > remoteUpdatedAt ? 'unsaved' : 'saved', lastSaved: Date.now(), message: null });
      if (currentSave().updatedAt > remoteUpdatedAt) schedule();
    } catch (e) {
      const msg = e instanceof CloudError ? e.message : String(e);
      status({ state: msg.includes('offline') ? 'offline' : 'error', message: msg });
      // try again later
      clearTimeout(timer);
      timer = setTimeout(() => void saveNow(), 30000);
    }
  })();
  await saving;
  saving = null;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), SAVE_DELAY);
}

/** Load the save from GitHub, then keep it updated. Call once at startup. */
export async function startCloudSync(): Promise<void> {
  if (started) return;
  started = true;
  status({ connected: !!getKey(), hasBackup: !!ls.get(BACKUP_KEY) });

  useStore.subscribe((st, prev) => {
    if (applying || st.savedAt === prev.savedAt) return;
    if (getKey()) {
      status({ state: 'unsaved' });
      schedule();
    } else {
      status({ state: 'readonly' });
    }
  });
  const flush = () => {
    if (timer && getKey()) void saveNow(true);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

  await sync();
}

/** Compare this browser with GitHub: load the newer save, or upload ours. */
export async function sync(): Promise<void> {
  const key = getKey();
  status({ state: 'loading', message: null, connected: !!key });
  try {
    const remote = await readRemote(key);
    remoteSha = remote.sha;
    remoteUpdatedAt = remote.file?.data ? remote.file.updatedAt : 0;
    const local = useStore.getState().savedAt;
    if (remote.file?.data && remote.file.updatedAt > local) {
      applyRemote(remote.file);
      status({ state: key ? 'saved' : 'readonly', lastSaved: remote.file.updatedAt });
    } else if (key && (!remote.file?.data || local > remote.file.updatedAt)) {
      await saveNow();
    } else {
      status({ state: key ? 'saved' : 'readonly', lastSaved: remote.file?.updatedAt || null });
    }
  } catch (e) {
    const msg = e instanceof CloudError ? e.message : String(e);
    status({ state: msg.includes('offline') ? 'offline' : 'error', message: msg });
  }
}

/** Connect this browser with a GitHub access key: checks it, then saves or loads. */
export async function connect(key: string): Promise<void> {
  key = key.trim();
  if (!key) throw new CloudError('Paste the key first.');
  const remote = await readRemote(key); // throws with a clear message if the key is wrong
  ls.set(TOKEN_KEY, key);
  remoteSha = remote.sha;
  remoteUpdatedAt = remote.file?.data ? remote.file.updatedAt : 0;
  status({ connected: true });
  const local = useStore.getState().savedAt;
  if (remote.file?.data && remote.file.updatedAt > local) {
    applyRemote(remote.file);
    status({ state: 'saved', lastSaved: remote.file.updatedAt });
  } else {
    // make sure the key can write, and upload what this browser has
    if (useStore.getState().savedAt === 0) useStore.setState({ savedAt: Date.now() });
    await saveNow();
    const s = useCloud.getState();
    if (s.state === 'error') {
      ls.set(TOKEN_KEY, null);
      status({ connected: false });
      throw new CloudError(s.message ?? 'Saving failed.');
    }
  }
}

export function disconnect() {
  ls.set(TOKEN_KEY, null);
  clearTimeout(timer);
  status({ connected: false, state: 'readonly', message: null });
}

export function restoreBackup(): boolean {
  const raw = ls.get(BACKUP_KEY);
  if (!raw) return false;
  try {
    const { data } = JSON.parse(raw) as { data: SaveData };
    useStore.getState().importAll(data);
    ls.set(BACKUP_KEY, null);
    status({ hasBackup: false });
    return true;
  } catch {
    return false;
  }
}

export function dismissBackup() {
  ls.set(BACKUP_KEY, null);
  status({ hasBackup: false });
}

/** for tests */
export function _resetCloud() {
  remoteSha = null;
  remoteUpdatedAt = 0;
  clearTimeout(timer);
  timer = undefined;
  saving = null;
  applying = false;
}
