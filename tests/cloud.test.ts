import { describe, it, expect, beforeEach } from 'vitest';

// minimal localStorage for node
const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => void (mem[k] = String(v)),
  removeItem: (k: string) => void delete mem[k],
};

const { useStore } = await import('../src/lib/store');
const cloud = await import('../src/lib/cloud');
const { newPlan, DEFAULT_SETTINGS } = await import('../src/lib/types');

/** In-memory stand-in for the GitHub contents API */
function fakeGitHub(opts: { validKey?: string; canWrite?: boolean } = {}) {
  const gh = {
    content: null as string | null,
    sha: null as string | null,
    n: 0,
    puts: 0,
    rateLimited: false,
    validKey: opts.validKey ?? 'good',
    canWrite: opts.canWrite ?? true,
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const key = auth?.replace('Bearer ', '');
    if (u.startsWith('https://raw.githubusercontent.com/')) {
      return gh.content ? new Response(Buffer.from(gh.content, 'base64').toString('utf8'), { status: 200 }) : new Response('', { status: 404 });
    }
    if (key && key !== gh.validKey) return json(401, { message: 'Bad credentials' });
    if (!init?.method || init.method === 'GET') {
      if (!key && gh.rateLimited) return json(403, { message: 'rate limit' });
      if (!gh.content) return json(404, { message: 'Not Found' });
      return json(200, { content: gh.content, sha: gh.sha });
    }
    if (init.method === 'PUT') {
      if (!gh.canWrite) return json(403, { message: 'Resource not accessible by personal access token' });
      const body = JSON.parse(String(init.body));
      if (gh.sha && body.sha !== gh.sha) return json(409, { message: 'does not match' });
      if (body.branch !== 'saves') return json(422, { message: 'wrong branch' });
      gh.content = body.content;
      gh.sha = 'sha' + ++gh.n;
      gh.puts++;
      return json(200, { content: { sha: gh.sha } });
    }
    return json(405, {});
  };
  cloud.setFetch(fetchImpl as typeof fetch);
  const file = () => (gh.content ? JSON.parse(Buffer.from(gh.content, 'base64').toString('utf8')) : null);
  const seed = (f: unknown) => {
    gh.content = Buffer.from(JSON.stringify(f)).toString('base64');
    gh.sha = 'seed' + ++gh.n;
  };
  return { gh, file, seed };
}

function resetBrowser() {
  for (const k of Object.keys(mem)) delete mem[k];
  cloud._resetCloud();
  const p = newPlan('Factory 1');
  useStore.setState({ settings: { ...DEFAULT_SETTINGS }, plans: [p], activeId: p.id, savedAt: 0 });
}

describe('GitHub auto-save', () => {
  beforeEach(resetBrowser);

  it('connecting uploads this browser’s factories when GitHub has none', async () => {
    const { file, seed } = fakeGitHub();
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 0, data: null });
    useStore.getState().updatePlan((p) => p.targets.push({ id: 't', item: 'Desc_Computer_C', rate: 5 }));
    useStore.getState().setSettings((s) => void (s.unlockedAlts['Recipe_Alternate_Screw_C'] = true));
    await cloud.connect('good');
    expect(cloud.getKey()).toBe('good');
    const f = file();
    expect(f.data.plans[0].targets[0].item).toBe('Desc_Computer_C');
    expect(f.data.settings.unlockedAlts['Recipe_Alternate_Screw_C']).toBe(true);
    expect(f.updatedAt).toBe(useStore.getState().savedAt);
    expect(cloud.useCloud.getState().state).toBe('saved');
  });

  it('a fresh browser loads the save from GitHub without a key', async () => {
    const { seed } = fakeGitHub();
    const plan = { ...newPlan('Uranium'), targets: [{ id: 't', item: 'Desc_NuclearFuelRod_C', rate: 1, max: true }] };
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 1000, data: { settings: { ...DEFAULT_SETTINGS, tier: 9 }, plans: [plan], activeId: plan.id } });
    await cloud.sync();
    const st = useStore.getState();
    expect(st.plans[0].name).toBe('Uranium');
    expect(st.settings.tier).toBe(9);
    expect(st.savedAt).toBe(1000);
    expect(cloud.useCloud.getState().state).toBe('readonly');
  });

  it('keeps a browser’s own factories as a backup when a GitHub save replaces them', async () => {
    const { seed } = fakeGitHub();
    useStore.getState().updatePlan((p) => p.targets.push({ id: 't', item: 'Desc_Rotor_C', rate: 5 }));
    useStore.setState({ savedAt: 0 }); // made before saving existed
    const plan = newPlan('From GitHub');
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 1000, data: { settings: DEFAULT_SETTINGS, plans: [plan], activeId: plan.id } });
    await cloud.sync();
    expect(useStore.getState().plans[0].name).toBe('From GitHub');
    expect(cloud.useCloud.getState().hasBackup).toBe(true);
    expect(cloud.restoreBackup()).toBe(true);
    expect(useStore.getState().plans[0].targets[0].item).toBe('Desc_Rotor_C');
  });

  it('later changes save, and a conflicting save from elsewhere is retried', async () => {
    const { gh, file, seed } = fakeGitHub();
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 0, data: null });
    await cloud.connect('good');
    useStore.getState().updatePlan((p) => void (p.name = 'Renamed'));
    // someone (another browser) saved in between
    gh.sha = 'other-browser';
    await cloud.saveNow();
    expect(file().data.plans[0].name).toBe('Renamed');
    expect(cloud.useCloud.getState().state).toBe('saved');
  });

  it('a wrong key is rejected with a clear message and not stored', async () => {
    const { seed } = fakeGitHub();
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 0, data: null });
    await expect(cloud.connect('wrong')).rejects.toThrow(/didn’t accept the key/);
    expect(cloud.getKey()).toBeNull();
  });

  it('a read-only key is rejected and not stored', async () => {
    const { seed } = fakeGitHub({ canWrite: false });
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 0, data: null });
    await expect(cloud.connect('good')).rejects.toThrow(/Read and write/);
    expect(cloud.getKey()).toBeNull();
  });

  it('falls back to the raw file when GitHub rate-limits a browser without a key', async () => {
    const { gh, seed } = fakeGitHub();
    const plan = newPlan('Raw');
    seed({ app: 'ficsit-planner', version: 1, updatedAt: 5, data: { settings: DEFAULT_SETTINGS, plans: [plan], activeId: plan.id } });
    gh.rateLimited = true;
    await cloud.sync();
    expect(useStore.getState().plans[0].name).toBe('Raw');
  });
});
