import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SETTINGS, newPlan, type Plan, type Settings } from './types';

export type ViewTab = 'graph' | 'tree' | 'items' | 'buildings';
export type SideTab = 'outputs' | 'inputs' | 'recipes' | 'byproducts';

export interface UIState {
  views: [ViewTab, ViewTab];
  split: boolean;
  sideTab: SideTab;
  sideWidth: number;
  focusItem: string | null;
  settingsOpen: boolean;
}

interface State {
  settings: Settings;
  plans: Plan[];
  activeId: string;
  ui: UIState;
  setSettings: (fn: (s: Settings) => void) => void;
  updatePlan: (fn: (p: Plan) => void) => void;
  addPlan: () => void;
  duplicatePlan: () => void;
  removePlan: (id: string) => void;
  setActive: (id: string) => void;
  setUI: (patch: Partial<UIState>) => void;
  importAll: (data: { settings: Settings; plans: Plan[] }) => void;
}

const first = newPlan('Factory 1');

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      plans: [first],
      activeId: first.id,
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
          return { settings: s };
        }),
      updatePlan: (fn) =>
        set((st) => ({
          plans: st.plans.map((p) => {
            if (p.id !== st.activeId) return p;
            const c = clone(p);
            fn(c);
            return c;
          }),
        })),
      addPlan: () =>
        set((st) => {
          const p = newPlan(`Factory ${st.plans.length + 1}`);
          return { plans: [...st.plans, p], activeId: p.id };
        }),
      duplicatePlan: () =>
        set((st) => {
          const cur = st.plans.find((p) => p.id === st.activeId);
          if (!cur) return {};
          const p = { ...clone(cur), id: newPlan().id, name: cur.name + ' (copy)' };
          return { plans: [...st.plans, p], activeId: p.id };
        }),
      removePlan: (id) =>
        set((st) => {
          let plans = st.plans.filter((p) => p.id !== id);
          if (!plans.length) plans = [newPlan('Factory 1')];
          const activeId = st.activeId === id ? plans[0].id : st.activeId;
          return { plans, activeId };
        }),
      setActive: (id) => set({ activeId: id }),
      setUI: (patch) => set((st) => ({ ui: { ...st.ui, ...patch } })),
      importAll: (data) =>
        set(() => {
          const plans = data.plans?.length ? data.plans.map((p) => ({ ...newPlan(), ...p })) : [newPlan('Factory 1')];
          return { settings: { ...DEFAULT_SETTINGS, ...data.settings }, plans, activeId: plans[0].id };
        }),
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
      partialize: (st) => ({ settings: st.settings, plans: st.plans, activeId: st.activeId, ui: { ...st.ui, settingsOpen: false, focusItem: null } }),
      merge: (persisted: any, current) => {
        const p = persisted ?? {};
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          plans: (p.plans ?? current.plans).map((pl: Plan) => ({ ...newPlan(), ...pl })),
          ui: { ...current.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);

export const useActivePlan = () => useStore((st) => st.plans.find((p) => p.id === st.activeId) ?? st.plans[0]);
