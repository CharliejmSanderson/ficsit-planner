import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SETTINGS, newPlan, type Plan, type Settings } from './types';

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
}

export interface SaveData {
  settings: Settings;
  plans: Plan[];
  activeId: string;
}

interface State {
  settings: Settings;
  plans: Plan[];
  activeId: string;
  /** when your factories or unlocks last changed (ms); 0 = never */
  savedAt: number;
  ui: UIState;
  setSettings: (fn: (s: Settings) => void) => void;
  updatePlan: (fn: (p: Plan) => void) => void;
  addPlan: () => void;
  duplicatePlan: () => void;
  removePlan: (id: string) => void;
  setActive: (id: string) => void;
  setUI: (patch: Partial<UIState>) => void;
  importAll: (data: { settings: Settings; plans: Plan[] }) => void;
  /** replace factories and unlocks with a save (from GitHub), keeping its timestamp */
  applySave: (data: SaveData, savedAt: number) => void;
}

/** change time that always moves forward, even for two changes in the same millisecond */
const bump = (st: { savedAt: number }) => Math.max(Date.now(), st.savedAt + 1);
const normalise = (data: Partial<SaveData>) => {
  const plans = data.plans?.length ? data.plans.map((p) => ({ ...newPlan(), ...p })) : [newPlan('Factory 1')];
  const activeId = plans.some((p) => p.id === data.activeId) ? data.activeId! : plans[0].id;
  return { settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }, plans, activeId };
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
          return { settings: s, savedAt: bump(st) };
        }),
      updatePlan: (fn) =>
        set((st) => ({
          plans: st.plans.map((p) => {
            if (p.id !== st.activeId) return p;
            const c = clone(p);
            fn(c);
            return c;
          }),
          savedAt: bump(st),
        })),
      addPlan: () =>
        set((st) => {
          const p = newPlan(`Factory ${st.plans.length + 1}`);
          return { plans: [...st.plans, p], activeId: p.id, savedAt: bump(st) };
        }),
      duplicatePlan: () =>
        set((st) => {
          const cur = st.plans.find((p) => p.id === st.activeId);
          if (!cur) return {};
          const p = { ...clone(cur), id: newPlan().id, name: cur.name + ' (copy)' };
          return { plans: [...st.plans, p], activeId: p.id, savedAt: bump(st) };
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
      importAll: (data) => set((st) => ({ ...normalise(data), savedAt: bump(st) })),
      applySave: (data, savedAt) => set(() => ({ ...normalise(data), savedAt })),
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
          ui: { ...current.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);

export const useActivePlan = () => useStore((st) => st.plans.find((p) => p.id === st.activeId) ?? st.plans[0]);
