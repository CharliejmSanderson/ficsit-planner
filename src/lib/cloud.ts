/**
 * Auto-save to GitHub, shared between everyone who uses the planner.
 *
 * Factories, unlocked recipes and notes live in save.json on the `saves` branch of the repo. Any browser
 * can read it (the repo is public). A browser connected with a GitHub access key also writes each change
 * back a few seconds after it's made.
 *
 * Several people can edit at once: every open planner checks GitHub for changes every 15 seconds (and
 * when you come back to the tab) and combines them with its own (see merge.ts), so you see each other's
 * edits without reloading and nobody's work is overwritten. The `saves` branch is separate from `main`,
 * so saving never redeploys the site.
 */
import { create } from 'zustand';
import { useStore, type SaveData } from './store';
import { mergeSaves, same, describeChanges, type Shared } from './merge';
import { getName } from './identity';

export const REPO = { owner: 'CharliejmSanderson', name: 'ficsit-planner', branch: 'saves', path: 'save.json' };
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${REPO.path}`;
const RAW = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${REPO.path}`;
const TOKEN_KEY = 'ficsit-planner-github-key';
const BACKUP_KEY = 'ficsit-planner-before-sync';
const BASE_KEY = 'ficsit-planner-sync-base';
/** wait this long after the last change before saving */
const SAVE_DELAY = 3000;
/** at least this long between saves (each save is a commit; GitHub limits how fast those can be made) */
const MIN_GAP = 8000;
/** how often an open planner checks GitHub for other people's changes */
export const POLL_CONNECTED = 15000;
/** without a key GitHub allows 60 requests an hour, so check less often */
export const POLL_READONLY = 120000;

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
  /** last time GitHub was checked for other people's changes */
  lastChecked: number | null;
  message: string | null;
  hasBackup: boolean;
  /** the latest change that came in from someone else, shown briefly */
  incoming: { text: string; at: number } | null;
}

export const useCloud = create<CloudStatus>(() => ({
  state: 'loading',
  connected: false,
  lastSaved: null,
  lastChecked: null,
  message: null,
  hasBackup: false,
  incoming: null,
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
  /** GitHub says nothing changed since the last check */
  unchanged?: boolean;
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

let etag: string | null = null;

/** Read save.json. With `ifChanged`, GitHub answers "unchanged" cheaply when nothing's new. */
export async function readRemote(key: string | null, ifChanged = false): Promise<Remote> {
  let res: Response;
  const h = headers(key);
  if (ifChanged && etag) h['If-None-Match'] = etag;
  try {
    res = await http(`${API}?ref=${REPO.branch}`, { headers: h, cache: 'no-store' });
  } catch {
    throw new CloudError('Can’t reach GitHub (offline?)');
  }
  if (res.status === 304) return { file: null, sha: remoteSha, unchanged: true };
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
  etag = res.headers?.get?.('ETag') ?? null;
  const body = await res.json();
  return { file: JSON.parse(fromB64(body.content)) as SaveFile, sha: body.sha };
}

export async function writeRemote(key: string, file: SaveFile, sha: string | null, keepalive = false): Promise<string> {
  const who = getName();
  const body = JSON.stringify({
    message: `Auto-save${who ? ` by ${who}` : ''}: ${file.data?.plans.length ?? 0} factories, ${Object.keys(file.data?.settings.unlockedAlts ?? {}).length} alternates, ${file.data?.notes?.length ?? 0} notes`,
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

// --- sync state -------------------------------------------------------------------------------
let remoteSha: string | null = null;
/** the last version seen on GitHub: what this browser's own changes are measured against */
let base: Shared | null | undefined; // undefined = not loaded from storage yet
let timer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;
let pulling: Promise<void> | null = null;
/** bumped by every save, so a check that started before a save can't undo it */
let generation = 0;
let lastWrite = 0;
let lastPull = 0;
let applying = false;
let started = false;

function getBase(): Shared | null {
  if (base === undefined) {
    try {
      base = JSON.parse(ls.get(BASE_KEY) ?? 'null') as Shared | null;
    } catch {
      base = null;
    }
  }
  return base;
}
function setBase(b: Shared | null) {
  base = b;
  ls.set(BASE_KEY, b ? JSON.stringify(b) : null);
}

const toShared = (d: SaveData | null | undefined): Shared | null => (d ? { settings: d.settings, plans: d.plans, notes: d.notes ?? [] } : null);

function local(): Shared {
  const st = useStore.getState();
  return { settings: st.settings, plans: st.plans, notes: st.notes };
}

function currentSave(): SaveFile {
  const st = useStore.getState();
  return { app: 'ficsit-planner', version: 1, updatedAt: st.savedAt, data: { ...local(), activeId: st.activeId } };
}

const hasContent = (d: Shared) =>
  d.plans.some((p) => p.targets.length || p.inputs.length || p.nodes.length) || Object.keys(d.settings.unlockedAlts).length > 0 || d.notes.length > 0;

/** does this browser have changes GitHub doesn't? */
const hasLocalChanges = () => {
  const b = getBase();
  return !b || !remoteSha || !same(local(), b);
};

function apply(data: Shared, savedAt: number) {
  applying = true;
  try {
    useStore.getState().applyRemote(data, savedAt);
  } finally {
    applying = false;
  }
}

/** Combine a GitHub save with this browser's data. */
function integrate(remote: Remote, firstLoad: boolean) {
  remoteSha = remote.sha;
  const theirs = toShared(remote.file?.data);
  if (!theirs) {
    setBase(null);
    return;
  }
  const mine = local();
  const b = getBase();
  let merged: Shared;
  if (!b && (!hasContent(mine) || useStore.getState().savedAt <= remote.file!.updatedAt)) {
    // first time this browser syncs and it has nothing newer: take GitHub's save, keeping this browser's old data aside
    if (hasContent(mine) && !same(mine, theirs)) {
      ls.set(BACKUP_KEY, JSON.stringify({ at: Date.now(), data: { ...mine, activeId: useStore.getState().activeId } }));
      status({ hasBackup: true });
    }
    merged = theirs;
  } else {
    merged = mergeSaves(b, mine, theirs);
  }
  if (!same(merged, mine)) {
    if (!firstLoad) {
      const text = describeChanges(mine, merged, getName());
      if (text) status({ incoming: { text, at: Date.now() } });
    }
    apply(merged, remote.file!.updatedAt);
  }
  setBase(theirs);
}

function idleState(): CloudState {
  if (!getKey()) return 'readonly';
  return hasLocalChanges() ? 'unsaved' : 'saved';
}

/** Check GitHub for other people's changes and combine them with this browser's. */
export async function pull(firstLoad = false): Promise<void> {
  if (pulling) return pulling;
  if (saving && !firstLoad) return;
  const key = getKey();
  const gen = generation;
  pulling = (async () => {
    try {
      const remote = await readRemote(key, !firstLoad);
      lastPull = Date.now();
      status({ lastChecked: lastPull });
      // a save finished while we were reading: what we read is already out of date
      if (gen !== generation) return;
      if (!remote.unchanged && (firstLoad || remote.sha !== remoteSha || !remote.sha)) integrate(remote, firstLoad);
      if (useCloud.getState().state !== 'saving') status({ state: idleState(), message: null });
      if (!useCloud.getState().lastSaved && remote.file?.updatedAt) status({ lastSaved: remote.file.updatedAt });
      if (key && hasLocalChanges()) {
        if (firstLoad) await saveNowInner();
        else schedule();
      }
    } catch (e) {
      const msg = e instanceof CloudError ? e.message : String(e);
      status({ state: msg.includes('offline') ? 'offline' : 'error', message: msg });
    }
  })();
  try {
    await pulling;
  } finally {
    pulling = null;
  }
}

/** Save now (if this browser is connected). If someone else saved in between, their changes are combined first. */
export async function saveNow(keepalive = false, force = false): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (!getKey()) return;
  while (pulling) await pulling;
  await saveNowInner(keepalive, force);
}

async function saveNowInner(keepalive = false, force = false): Promise<void> {
  const key = getKey();
  if (!key) return;
  while (saving) await saving.catch(() => undefined);
  if (!force && !hasLocalChanges()) {
    status({ state: 'saved' });
    return;
  }
  status({ state: 'saving', message: null });
  saving = (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        const file = currentSave();
        try {
          remoteSha = await writeRemote(key, file, remoteSha, keepalive);
        } catch (e) {
          if (!(e instanceof CloudError) || (e.status !== 409 && e.status !== 422) || attempt >= 3) throw e;
          // someone else saved since we last looked: fetch it, combine it with ours, and try again
          integrate(await readRemote(key), false);
          continue;
        }
        generation++;
        lastWrite = Date.now();
        setBase(toShared(file.data));
        const more = hasLocalChanges();
        status({ state: more ? 'unsaved' : 'saved', lastSaved: Date.now(), message: null });
        if (more) schedule();
        return;
      }
    } catch (e) {
      const msg = e instanceof CloudError ? e.message : String(e);
      status({ state: msg.includes('offline') ? 'offline' : 'error', message: msg });
      // try again later
      clearTimeout(timer);
      timer = setTimeout(() => void saveNow(), 30000);
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
}

function schedule() {
  clearTimeout(timer);
  const wait = Math.max(SAVE_DELAY, lastWrite + MIN_GAP - Date.now());
  timer = setTimeout(() => void saveNow(), wait);
}

function startPolling() {
  const tick = () => {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(
      async () => {
        // skip while a save is about to happen: it picks up other people's changes itself
        if (document.visibilityState === 'visible' && !timer) await pull();
        tick();
      },
      getKey() ? POLL_CONNECTED : POLL_READONLY,
    );
  };
  const onReturn = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastPull > (getKey() ? 5000 : 60000)) void pull();
  };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
  tick();
}

/** Load the save from GitHub, then keep it in sync. Call once at startup. */
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
  startPolling();
}

/** Load the latest save from GitHub and combine it with this browser's (uploading anything new). */
export async function sync(): Promise<void> {
  status({ state: 'loading', message: null, connected: !!getKey() });
  await pull(true);
}

/** Connect this browser with a GitHub access key: checks it, combines saves, and saves once to prove the key can write. */
export async function connect(key: string): Promise<void> {
  key = key.trim();
  if (!key) throw new CloudError('Paste the key first.');
  const remote = await readRemote(key); // throws with a clear message if the key is wrong
  ls.set(TOKEN_KEY, key);
  status({ connected: true });
  integrate(remote, true);
  if (useStore.getState().savedAt === 0) useStore.setState({ savedAt: Date.now() });
  await saveNowInner(false, true);
  const s = useCloud.getState();
  if (s.state === 'error') {
    ls.set(TOKEN_KEY, null);
    clearTimeout(timer);
    status({ connected: false, state: 'readonly' });
    throw new CloudError(s.message ?? 'Saving failed.');
  }
}

export function disconnect() {
  ls.set(TOKEN_KEY, null);
  clearTimeout(timer);
  timer = undefined;
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

export function dismissIncoming() {
  status({ incoming: null });
}

/** for tests */
export function _resetCloud() {
  remoteSha = null;
  base = undefined;
  etag = null;
  clearTimeout(timer);
  clearTimeout(pollTimer);
  timer = undefined;
  saving = null;
  pulling = null;
  generation = 0;
  lastWrite = 0;
  lastPull = 0;
  applying = false;
  useCloud.setState({ state: 'loading', connected: false, lastSaved: null, lastChecked: null, message: null, hasBackup: false, incoming: null });
}
