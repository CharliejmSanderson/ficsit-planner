import { describe, it, expect } from 'vitest';
import { merge3, mergeList, same } from '../src/lib/merge';

describe('merge', () => {
  it('same() ignores key order and undefined keys', () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(same({ a: 1 }, { a: '1' })).toBe(false);
  });

  it('takes whichever side changed a value', () => {
    expect(merge3(1, 1, 2, true)).toBe(2);
    expect(merge3(1, 3, 1, false)).toBe(3);
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }, true)).toEqual({ a: 2, b: 3 });
  });

  it('a real conflict goes to the preferred side', () => {
    expect(merge3(1, 2, 3, true)).toBe(2);
    expect(merge3(1, 2, 3, false)).toBe(3);
  });

  it('handles keys added and removed on either side', () => {
    expect(merge3({ x: true }, { x: true, y: true }, {}, true)).toEqual({ y: true });
    expect(merge3({}, { a: 1 }, { b: 2 }, true)).toEqual({ a: 1, b: 2 });
  });

  it('keeps an edit over a deletion', () => {
    expect(merge3({ a: 1 }, {}, { a: 2 }, true)).toEqual({ a: 2 });
  });

  it('merges id lists by id and keeps order sensible', () => {
    const base = [{ id: 'a' }, { id: 'b' }];
    const local = [{ id: 'a' }, { id: 'b' }, { id: 'l' }];
    const remote = [{ id: 'r' }, { id: 'a' }, { id: 'b', v: 1 }];
    expect(mergeList(base, local, remote, () => true)).toEqual([{ id: 'r' }, { id: 'a' }, { id: 'b', v: 1 }, { id: 'l' }]);
  });

  it('with no common base, keeps everything from both sides', () => {
    const out = mergeList([], [{ id: 'a', n: 1 }], [{ id: 'b', n: 2 }], () => true);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('treats lists of plain values as a single value', () => {
    expect(merge3(['x'], ['x', 'y'], ['z'], false)).toEqual(['z']);
  });
});
