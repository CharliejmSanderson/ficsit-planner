/**
 * Two people using the planner at the same time: two separate "browsers" (each with its own copy of the
 * app and its own localStorage) talking to one fake GitHub.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const storage: Record<string, Record<string, string>> = {};
let active: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in active ? active[k] : null),
  setItem: (k: string, v: string) => void (active[k] = String(v)),
  removeItem: (k: string) => void delete active[k],
};

/** in-memory GitHub contents API with sha conflicts and ETags */
function fakeGitHub() {
  const gh = { content: null as string | null, sha: null as string | null, n: 0, notModified: 0, puts: 0 };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (h.Authorization && h.Authorization !== 'Bearer good') return json(401, { message: 'Bad credentials' });
    if (!init?.method || init.method === 'GET') {
      if (!gh.content) return json(404, { message: 'Not Found' });
      if (h['If-None-Match'] === `"${gh.sha}"`) {
        gh.notModified++;
        return json(304, null);
      }
      return json(200, { content: gh.content, sha: gh.sha }, { ETag: `"${gh.sha}"` });
    }
    const body = JSON.parse(String(init.body));
    if (gh.sha && body.sha !== gh.sha) return json(409, { message: 'does not match' });
    gh.content = body.content;
    gh.sha = 'sha' + ++gh.n;
    gh.puts++;
    return json(200, { content: { sha: gh.sha } });
  };
  const file = () => JSON.parse(Buffer.from(gh.content!, 'base64').toString('utf8'));
  return { gh, fetchImpl: fetchImpl as typeof fetch, file };
}

type Browser = Awaited<ReturnType<typeof openBrowser>>;
const open: Browser[] = [];

/** a fresh copy of the app with its own storage, like a separate computer */
async function openBrowser(name: string, fetchImpl: typeof fetch, person?: string) {
  storage[name] ??= {};
  active = storage[name];
  vi.resetModules();
  const { useStore } = await import('../src/lib/store');
  const cloud = await import('../src/lib/cloud');
  const identity = await import('../src/lib/identity');
  cloud.setFetch(fetchImpl);
  if (person) identity.setName(person);
  const b = {
    store: useStore,
    cloud,
    /** run something in this browser */
    async do<T>(fn: () => T | Promise<T>): Promise<T> {
      active = storage[name];
      return await fn();
    },
    get plans() {
      return useStore.getState().plans;
    },
    plan(n: string) {
      return useStore.getState().plans.find((p) => p.name === n);
    },
  };
  open.push(b);
  return b;
}

afterEach(() => {
  for (const b of open) b.cloud._resetCloud();
  open.length = 0;
  for (const k of Object.keys(storage)) delete storage[k];
  vi.useRealTimers();
});

/** Charlie sets up a factory and connects; Alex opens the link and connects too */
async function twoPeople() {
  const g = fakeGitHub();
  const charlie = await openBrowser('charlie', g.fetchImpl, 'Charlie');
  await charlie.do(async () => {
    charlie.store.getState().updatePlan((p) => {
      p.name = 'Main';
      p.targets.push({ id: 't1', item: 'Desc_Computer_C', rate: 5 });
    });
    await charlie.cloud.connect('good');
  });
  const alex = await openBrowser('alex', g.fetchImpl, 'Alex');
  await alex.do(async () => {
    await alex.cloud.sync();
    await alex.cloud.connect('good');
  });
  await charlie.do(() => charlie.cloud.pull());
  return { g, charlie, alex };
}

describe('sharing with a friend', () => {
  it('a friend opening the link sees your factories, and later changes without reloading', async () => {
    const g = fakeGitHub();
    const charlie = await openBrowser('charlie', g.fetchImpl, 'Charlie');
    await charlie.do(async () => {
      charlie.store.getState().updatePlan((p) => void (p.name = 'Main'));
      await charlie.cloud.connect('good');
    });
    const viewer = await openBrowser('viewer', g.fetchImpl);
    await viewer.do(() => viewer.cloud.sync());
    expect(viewer.plans.map((p) => p.name)).toEqual(['Main']);
    expect(viewer.cloud.useCloud.getState().state).toBe('readonly');

    await charlie.do(async () => {
      charlie.store.getState().addPlan();
      charlie.store.getState().updatePlan((p) => void (p.name = 'Oil'));
      await charlie.cloud.saveNow();
    });
    await viewer.do(() => viewer.cloud.pull());
    expect(viewer.plans.map((p) => p.name)).toEqual(['Main', 'Oil']);
    expect(viewer.cloud.useCloud.getState().incoming?.text).toBe('Charlie added Oil');

    // nothing new: GitHub answers "not modified"
    const before = g.gh.notModified;
    await viewer.do(() => viewer.cloud.pull());
    expect(g.gh.notModified).toBe(before + 1);
  });

  it('both editing different factories at the same time keeps both', async () => {
    const { g, charlie, alex } = await twoPeople();
    await charlie.do(() => charlie.store.getState().updatePlan((p) => p.targets.push({ id: 't2', item: 'Desc_Motor_C', rate: 2 })));
    await alex.do(() => {
      alex.store.getState().addPlan();
      alex.store.getState().updatePlan((p) => void (p.name = 'Steel'));
    });
    await charlie.do(() => charlie.cloud.saveNow());
    await alex.do(() => alex.cloud.saveNow()); // GitHub changed underneath: combined, not overwritten
    await charlie.do(() => charlie.cloud.pull());

    for (const b of [charlie, alex]) {
      expect(b.plans.map((p) => p.name)).toEqual(['Main', 'Steel']);
      expect(b.plan('Main')!.targets.map((t) => t.id)).toEqual(['t1', 't2']);
    }
    expect(g.file().data.plans.map((p: { name: string }) => p.name)).toEqual(['Main', 'Steel']);
    expect(charlie.cloud.useCloud.getState().incoming?.text).toBe('Alex added Steel');
    // each person stays on the factory they were looking at
    expect(charlie.store.getState().activeId).toBe(charlie.plan('Main')!.id);
    expect(alex.store.getState().activeId).toBe(alex.plan('Steel')!.id);
  });

  it('both adding outputs to the same factory keeps both outputs', async () => {
    const { charlie, alex } = await twoPeople();
    await charlie.do(() => charlie.store.getState().updatePlan((p) => p.targets.push({ id: 'c', item: 'Desc_Motor_C', rate: 2 })));
    await alex.do(() =>
      alex.store.getState().updatePlan((p) => {
        p.targets.push({ id: 'a', item: 'Desc_Rotor_C', rate: 4 });
        p.recipeChoice['Desc_Screw_C'] = ['Recipe_Alternate_Screw_C'];
      }),
    );
    await alex.do(() => alex.cloud.saveNow());
    await charlie.do(() => charlie.cloud.saveNow());
    await alex.do(() => alex.cloud.pull());
    for (const b of [charlie, alex]) {
      // Alex saved first, so his output comes first
      expect(b.plan('Main')!.targets.map((t) => t.id)).toEqual(['t1', 'a', 'c']);
      expect(b.plan('Main')!.recipeChoice['Desc_Screw_C']).toEqual(['Recipe_Alternate_Screw_C']);
    }
  });

  it('when both change the same thing, the later edit wins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    const { charlie, alex } = await twoPeople();
    vi.setSystemTime(new Date('2026-11-18T10:01:00Z'));
    await charlie.do(() => charlie.store.getState().updatePlan((p) => void (p.targets[0].rate = 10)));
    vi.setSystemTime(new Date('2026-11-18T10:02:00Z'));
    await alex.do(() => alex.store.getState().updatePlan((p) => void (p.targets[0].rate = 7.5)));
    // Alex's later edit wins whichever order the saves happen in
    await alex.do(() => alex.cloud.saveNow());
    await charlie.do(() => charlie.cloud.saveNow());
    await alex.do(() => alex.cloud.pull());
    expect(charlie.plan('Main')!.targets[0].rate).toBe(7.5);
    expect(alex.plan('Main')!.targets[0].rate).toBe(7.5);
  });

  it('deleting a factory deletes it for both, unless the other person was just editing it', async () => {
    const { charlie, alex } = await twoPeople();
    await alex.do(async () => {
      alex.store.getState().addPlan();
      alex.store.getState().updatePlan((p) => void (p.name = 'Spare'));
      alex.store.getState().addPlan();
      alex.store.getState().updatePlan((p) => void (p.name = 'Busy'));
      await alex.cloud.saveNow();
    });
    await charlie.do(() => charlie.cloud.pull());
    expect(charlie.plans.map((p) => p.name)).toEqual(['Main', 'Spare', 'Busy']);

    // Charlie deletes both; meanwhile Alex keeps working on Busy
    await charlie.do(async () => {
      charlie.store.getState().removePlan(charlie.plan('Spare')!.id);
      charlie.store.getState().removePlan(charlie.plan('Busy')!.id);
    });
    await alex.do(() => alex.store.getState().updatePlan((p) => p.targets.push({ id: 'b', item: 'Desc_Cable_C', rate: 30 })));
    await charlie.do(() => charlie.cloud.saveNow());
    await alex.do(() => alex.cloud.saveNow());
    await charlie.do(() => charlie.cloud.pull());
    for (const b of [charlie, alex]) expect(b.plans.map((p) => p.name)).toEqual(['Main', 'Busy']);
  });

  it('notes and unlocks combine too', async () => {
    const { charlie, alex } = await twoPeople();
    await charlie.do(() => {
      const id = charlie.store.getState().addNote();
      charlie.store.getState().updateNote(id, { title: 'Oil field', text: 'North-east' });
      charlie.store.getState().setSettings((s) => void (s.unlockedAlts['Recipe_Alternate_Screw_C'] = true));
    });
    await alex.do(() => {
      const id = alex.store.getState().addNote();
      alex.store.getState().updateNote(id, { title: 'Trains', text: 'Loop by the river' });
      alex.store.getState().setSettings((s) => void (s.unlockedAlts['Recipe_Alternate_WetConcrete_C'] = true));
    });
    await charlie.do(() => charlie.cloud.saveNow());
    await alex.do(() => alex.cloud.saveNow());
    await charlie.do(() => charlie.cloud.pull());
    for (const b of [charlie, alex]) {
      expect(new Set(b.store.getState().notes.map((n) => n.title))).toEqual(new Set(['Oil field', 'Trains']));
      expect(Object.keys(b.store.getState().settings.unlockedAlts).sort()).toEqual(['Recipe_Alternate_Screw_C', 'Recipe_Alternate_WetConcrete_C']);
    }
    expect(charlie.cloud.useCloud.getState().incoming?.text).toBe('Alex edited 1 note and changed unlocks/settings');
  });

  it('remembers what it last saw on GitHub across a reload, so offline edits combine correctly', async () => {
    const { g, charlie, alex } = await twoPeople();
    // Charlie edits, then closes the tab before it saves
    await charlie.do(() => charlie.store.getState().updatePlan((p) => p.targets.push({ id: 'late', item: 'Desc_Motor_C', rate: 1 })));
    // meanwhile Alex deletes nothing but adds a factory
    await alex.do(async () => {
      alex.store.getState().addPlan();
      alex.store.getState().updatePlan((p) => void (p.name = 'Copper'));
      await alex.cloud.saveNow();
    });
    // Charlie's browser opens again (fresh app, same storage)
    charlie.cloud._resetCloud();
    const again = await openBrowser('charlie', g.fetchImpl);
    await again.do(() => again.cloud.sync());
    expect(again.plans.map((p) => p.name)).toEqual(['Main', 'Copper']);
    expect(again.plan('Main')!.targets.map((t) => t.id)).toEqual(['t1', 'late']);
    expect(g.file().data.plans.find((p: { name: string }) => p.name === 'Main').targets).toHaveLength(2);
  });
});
