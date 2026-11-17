import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SETTINGS, newPlan, uid, type Note, type Plan, type Settings } from './types';
import { stamp } from './identity';

export type ViewTab = 'graph' | 'tree' | 'items' | 'buildings';
export type SideTab = 'outputs' | 'inputs' | 'recipes' | 'byproducts';
export type SettingsTab = 'alts' | 'general' | 'mam' | 'sync';

export interface UIState {
  views: [ViewTab, ViewTab];
  split: boolean;
  sideTab: SideTab;
  sideWidth: number;
  focusItem: string | null;
  settingsOpen: boolean;
  settingsTab?: SettingsTab;
  page?: 'planner' | 'notes';
  activeNote?: string | null;
  calcOpen?: boolean;
  calcAt?: { left: number; bottom: number };
}

export interface SaveData {
  settings: Settings;
  plans: Plan[];
  activeId: string;
  notes?: Note[];
}

interface State {
  settings: Settings;
  plans: Plan[];
  activeId: string;
  /** when your factories or unlocks last changed (ms); 0 = never */
  savedAt: number;
  notes: Note[];
  ui: UIState;
  setSettings: (fn: (s: Settings) => void) => void;
  updatePlan: (fn: (p: Plan) => void) => void;
  addPlan: () => void;
  duplicatePlan: () => void;
  removePlan: (id: string) => void;
  setActive: (id: string) => void;
  setUI: (patch: Partial<UIState>) => void;
  importAll: (data: { settings: Settings; plans: Plan[]; notes?: Note[] }) => void;
  addNote: () => string;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'text'>>) => void;
  deleteNote: (id: string) => void;
  /** take factories, notes and unlocks combined with a GitHub save (keeps which factory you're looking at) */
  applyRemote: (data: Pick<SaveData, 'settings' | 'plans' | 'notes'>, savedAt: number) => void;
}

/** change time that always moves forward, even for two changes in the same millisecond */
const bump = (st: { savedAt: number }) => Math.max(Date.now(), st.savedAt + 1);
const normalise = (data: Partial<SaveData>) => {
  const plans = data.plans?.length ? data.plans.map((p) => ({ ...newPlan(), ...p })) : [newPlan('Factory 1')];
  const activeId = plans.some((p) => p.id === data.activeId) ? data.activeId! : plans[0].id;
  const notes = Array.isArray(data.notes) ? data.notes.filter((n) => n && n.id) : [];
  return { settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }, plans, activeId, notes };
};

const first = newPlan('Factory 1');

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      plans: [first],
      activeId: first.id,
      savedAt: 0,
      notes: [],
      ui: {
        views: ['graph', 'tree'],
        split: false,
        sideTab: 'outputs',
        sideWidth: 440,
        focusItem: null,
        settingsOpen: false,
      },
      setSettings: (fn) =>
        set((st) => {
          const s = clone(st.settings);
          fn(s);
          const t = bump(st);
          s.updatedAt = t;
          return { settings: s, savedAt: t };
        }),
      updatePlan: (fn) =>
        set((st) => {
          const t = bump(st);
          return {
            plans: st.plans.map((p) => {
              if (p.id !== st.activeId) return p;
              const c = clone(p);
              fn(c);
              return stamp(c, t);
            }),
            savedAt: t,
          };
        }),
      addPlan: () =>
        set((st) => {
          const t = bump(st);
          const p = stamp(newPlan(`Factory ${st.plans.length + 1}`), t);
          return { plans: [...st.plans, p], activeId: p.id, savedAt: t };
        }),
      duplicatePlan: () =>
        set((st) => {
          const cur = st.plans.find((p) => p.id === st.activeId);
          if (!cur) return {};
          const t = bump(st);
          const p = stamp({ ...clone(cur), id: newPlan().id, name: cur.name + ' (copy)' }, t);
          return { plans: [...st.plans, p], activeId: p.id, savedAt: t };
        }),
      removePlan: (id) =>
        set((st) => {
          let plans = st.plans.filter((p) => p.id !== id);
          if (!plans.length) plans = [newPlan('Factory 1')];
          const activeId = st.activeId === id ? plans[0].id : st.activeId;
          return { plans, activeId, savedAt: bump(st) };
        }),
      setActive: (id) => set({ activeId: id }),
      setUI: (patch) => set((st) => ({ ui: { ...st.ui, ...patch } })),
      importAll: (data) =>
        set((st) => {
          // an import replaces everything, so mark it all as just edited
          const t = bump(st);
          const n = normalise(clone(data));
          n.settings.updatedAt = t;
          n.plans.forEach((p) => stamp(p, t));
          n.notes.forEach((x) => stamp(x, t));
          return { ...n, savedAt: t };
        }),
      applyRemote: (data, savedAt) =>
        set((st) => {
          const n = normalise({ ...data, activeId: st.activeId });
          return { settings: n.settings, plans: n.plans, notes: n.notes, activeId: n.activeId, savedAt: Math.max(st.savedAt, savedAt) };
        }),
      addNote: () => {
        const t = Date.now();
        const note: Note = stamp({ id: uid(), title: '', text: '', createdAt: t, updatedAt: t }, t);
        set((st) => ({ notes: [note, ...st.notes], savedAt: bump(st) }));
        return note.id;
      },
      updateNote: (id, patch) =>
        set((st) => ({
          notes: st.notes.map((n) => (n.id === id ? stamp({ ...n, ...patch }, Date.now()) : n)),
          savedAt: bump(st),
        })),
      deleteNote: (id) => set((st) => ({ notes: st.notes.filter((n) => n.id !== id), savedAt: bump(st) })),
    }),
    {
      name: 'ficsit-planner-v1',
      storage: createJSONStorage(() => {
        try {
          const k = '__t';
          localStorage.setItem(k, '1');
          localStorage.removeItem(k);
          return localStorage;
        } catch {
          const mem: Record<string, string> = {};
          return {
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => void (mem[k] = v),
            removeItem: (k: string) => void delete mem[k],
          };
        }
      }),
      partialize: (st) => ({
        settings: st.settings,
        plans: st.plans,
        activeId: st.activeId,
        savedAt: st.savedAt,
        notes: st.notes,
        ui: { ...st.ui, settingsOpen: false, focusItem: null },
      }),
      merge: (persisted: any, current) => {
        const p = persisted ?? {};
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          plans: (p.plans ?? current.plans).map((pl: Plan) => ({ ...newPlan(), ...pl })),
          savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
          notes: Array.isArray(p.notes) ? p.notes : [],
          ui: { ...current.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);

export const useActivePlan = () => useStore((st) => st.plans.find((p) => p.id === st.activeId) ?? st.plans[0]);
