/**
 * Combining two people's edits.
 *
 * Each browser remembers the last version it saw on GitHub (the "base"). To combine this browser's
 * data with a newer GitHub save, every value is compared three ways:
 *   - only one side changed it from the base → take that change
 *   - both changed it the same way → fine
 *   - both changed it differently → the more recently edited factory/note/settings wins
 * Lists of things with ids (factories, notes, outputs, inputs, nodes) are matched by id, so two people
 * adding different outputs to the same factory keeps both. Deleting something the other person
 * didn't touch deletes it; deleting something the other person just edited keeps their edit.
 */
import type { Note, Plan, Settings } from './types';

export interface Shared {
  settings: Settings;
  plans: Plan[];
  notes: Note[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every((e) => isObj(e) && typeof e.id === 'string');

/** deep equality for JSON data; a key set to undefined counts as missing */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
  }
  const ao = a as Obj;
  const bo = b as Obj;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(ao[k], bo[k]));
}

/** three-way merge of one value; `undefined` means "not there" */
export function merge3(base: unknown, local: unknown, remote: unknown, preferLocal: boolean): unknown {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  // both changed it. If one side deleted it, keep the other side's edit
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  if (isIdList(local) && isIdList(remote)) return mergeList(isIdList(base) ? base : [], local, remote, () => preferLocal);
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const v = merge3(b[k], local[k], remote[k], preferLocal);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return preferLocal ? local : remote;
}

/**
 * Merge lists of things with ids. Order follows this browser's list; things only the other side has
 * are slotted in after whatever came before them on that side.
 */
export function mergeList<T extends { id: string }>(base: T[], local: T[], remote: T[], preferLocal: (l: T, r: T) => boolean): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const l of local) {
    seen.add(l.id);
    const rv = r.get(l.id);
    const m = merge3(b.get(l.id), l, rv, rv ? preferLocal(l, rv) : true) as T | undefined;
    if (m !== undefined) out.push(m);
  }
  remote.forEach((rv, i) => {
    if (seen.has(rv.id)) return;
    const m = merge3(b.get(rv.id), undefined, rv, false) as T | undefined;
    if (m === undefined) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === remote[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, m);
  });
  return out;
}

const newer = (l: { updatedAt?: number }, r: { updatedAt?: number }) => (l.updatedAt ?? 0) >= (r.updatedAt ?? 0);

/** Combine this browser's data with GitHub's, given the last version both started from (null if unknown). */
export function mergeSaves(base: Shared | null, local: Shared, remote: Shared): Shared {
  return {
    settings: merge3(base?.settings, local.settings, remote.settings, newer(local.settings, remote.settings)) as Settings,
    plans: mergeList(base?.plans ?? [], local.plans, remote.plans, newer),
    notes: mergeList(base?.notes ?? [], local.notes, remote.notes, newer),
  };
}

/** A short description of what changed between two versions, e.g. "Alex changed Steel Mill and edited 1 note". */
export function describeChanges(before: Shared, after: Shared, me: string): string | null {
  const parts: string[] = [];
  const who = new Set<string>();
  const was = new Map(before.plans.map((p) => [p.id, p]));
  const now = new Set(after.plans.map((p) => p.id));
  const added: string[] = [];
  const changed: string[] = [];
  for (const p of after.plans) {
    const old = was.get(p.id);
    if (old && same(old, p)) continue;
    (old ? changed : added).push(p.name);
    if (p.updatedBy) who.add(p.updatedBy);
  }
  const removed = before.plans.filter((p) => !now.has(p.id)).map((p) => p.name);
  const list = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' and '));
  if (changed.length) parts.push(`changed ${list(changed)}`);
  if (added.length) parts.push(`added ${list(added)}`);
  if (removed.length) parts.push(`deleted ${list(removed)}`);

  const oldNotes = new Map(before.notes.map((n) => [n.id, n]));
  const nowNotes = new Set(after.notes.map((n) => n.id));
  let notes = before.notes.filter((n) => !nowNotes.has(n.id)).length;
  for (const n of after.notes) {
    const old = oldNotes.get(n.id);
    if (old && same(old, n)) continue;
    notes++;
    if (n.updatedBy) who.add(n.updatedBy);
  }
  if (notes) parts.push(`edited ${notes} note${notes === 1 ? '' : 's'}`);
  if (!same(before.settings, after.settings)) parts.push('changed unlocks/settings');
  if (!parts.length) return null;

  who.delete(me);
  const names = [...who];
  const text = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
  return names.length ? `${names.join(' & ')} ${text}` : `Update from GitHub: ${text}`;
}
