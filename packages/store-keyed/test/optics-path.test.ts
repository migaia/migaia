import { describe, expect, it, vi } from 'vitest';
import {
  KeyedSplitCache,
  computeUniqueKeys,
  filterOutKey,
  findKeyIndex,
  readOpticPath,
  replaceAtIndex,
  requireKeyIndex,
  shallowArrayEquals,
  spliceInsert,
  writeOpticPath
} from '../src/atom/optics-path';

describe('readOpticPath', () => {
  it('reads a nested path', () => {
    expect(readOpticPath({ a: { b: 1 } }, ['a', 'b'], 'test')).toBe(1);
  });

  it('returns the value itself for an empty path', () => {
    expect(readOpticPath(42, [], 'test')).toBe(42);
  });

  it('throws TypeError when a mid-path segment is not an object', () => {
    expect(() => readOpticPath({ a: null }, ['a', 'b'], 'test')).toThrow(TypeError);
    expect(() => readOpticPath({ a: null }, ['a', 'b'], 'test')).toThrow(
      '[store] test cannot read path segment b'
    );
  });
});

describe('writeOpticPath', () => {
  it('writes a nested path without mutating the source', () => {
    const source = { a: { b: 1, c: 2 } };
    const next = writeOpticPath(source, ['a', 'b'], 99, 'test') as typeof source;
    expect(next).toEqual({ a: { b: 99, c: 2 } });
    expect(source).toEqual({ a: { b: 1, c: 2 } });
    expect(next).not.toBe(source);
    expect(next.a).not.toBe(source.a);
  });

  it('clones arrays with spread rather than mutating in place', () => {
    const source = { list: [1, 2, 3] };
    const next = writeOpticPath(source, ['list'], [9], 'test') as typeof source;
    expect(next.list).toEqual([9]);
    expect(source.list).toEqual([1, 2, 3]);
  });

  it('throws TypeError when the root is not an object', () => {
    expect(() => writeOpticPath(null, ['a'], 1, 'test')).toThrow(TypeError);
    expect(() => writeOpticPath(null, ['a'], 1, 'test')).toThrow(
      '[store] test cannot write path segment a'
    );
  });

  it('throws TypeError when a mid-path segment is not an object', () => {
    expect(() => writeOpticPath({ a: null }, ['a', 'b'], 1, 'test')).toThrow(
      '[store] test cannot write path segment b'
    );
  });

  it('stores "__proto__" as an own data property instead of mutating the prototype chain', () => {
    const source = { own: 1 } as Record<string, unknown>;
    const next = writeOpticPath(source, ['__proto__'], { polluted: true }, 'test') as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(next, '__proto__')).toBe(true);
    expect(next.__proto__).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('findKeyIndex', () => {
  const keyOf = (item: { id: string }) => item.id;

  it('returns the index of the matching item', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(findKeyIndex(items, keyOf, 'b')).toBe(1);
  });

  it('returns -1 when nothing matches', () => {
    expect(findKeyIndex([{ id: 'a' }], keyOf, 'z')).toBe(-1);
  });
});

describe('requireKeyIndex', () => {
  const keyOf = (item: { id: string }) => item.id;

  it('throws with the given label when the key is absent', () => {
    expect(() => requireKeyIndex([{ id: 'a' }], keyOf, 'missing', 'boom')).toThrow('[store] boom');
  });
});

describe('shallowArrayEquals', () => {
  it('is true for same-length arrays with identical elements by reference', () => {
    const a = {};
    expect(shallowArrayEquals([a, 1], [a, 1])).toBe(true);
  });

  it('is false when lengths differ', () => {
    expect(shallowArrayEquals([1], [1, 2])).toBe(false);
  });

  it('is false when any element differs', () => {
    expect(shallowArrayEquals([{}], [{}])).toBe(false);
  });
});

describe('computeUniqueKeys', () => {
  it('returns the frozen key list in order', () => {
    const keys = computeUniqueKeys([{ id: 'a' }, { id: 'b' }], (item) => item.id, 'label');
    expect(keys).toEqual(['a', 'b']);
    expect(Object.isFrozen(keys)).toBe(true);
  });

  it('throws when two items resolve to the same key', () => {
    expect(() =>
      computeUniqueKeys([{ id: 'a' }, { id: 'a' }], (item) => item.id, 'mylabel')
    ).toThrow('[store] mylabel keys must be unique');
  });
});

describe('spliceInsert', () => {
  it('appends by default (POSITIVE_INFINITY index)', () => {
    expect(spliceInsert([1, 2], 3, Number.POSITIVE_INFINITY)).toEqual([1, 2, 3]);
  });

  it('clamps a negative index to 0', () => {
    expect(spliceInsert([1, 2], 0, -10)).toEqual([0, 1, 2]);
  });

  it('clamps an index beyond the length to the end', () => {
    expect(spliceInsert([1, 2], 3, 999)).toEqual([1, 2, 3]);
  });

  it('inserts in the middle at an exact index', () => {
    expect(spliceInsert([1, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it('returns a frozen array and does not mutate the source', () => {
    const source = [1, 2];
    const next = spliceInsert(source, 3, 0);
    expect(source).toEqual([1, 2]);
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe('filterOutKey', () => {
  const keyOf = (item: { id: string }) => item.id;

  it('removes the matching item and reports removed: true', () => {
    const result = filterOutKey([{ id: 'a' }, { id: 'b' }], keyOf, 'a');
    expect(result.removed).toBe(true);
    expect(result.next).toEqual([{ id: 'b' }]);
  });

  it('returns the original array reference (not a copy) when nothing matched', () => {
    const source = [{ id: 'a' }];
    const result = filterOutKey(source, keyOf, 'missing');
    expect(result.removed).toBe(false);
    expect(result.next).toBe(source);
  });
});

describe('replaceAtIndex', () => {
  it('replaces the value at the given index without mutating the source', () => {
    const source = [1, 2, 3];
    const next = replaceAtIndex(source, 1, 99);
    expect(next).toEqual([1, 99, 3]);
    expect(source).toEqual([1, 2, 3]);
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe('KeyedSplitCache', () => {
  it('of() creates once and returns the cached value on subsequent calls', () => {
    const cache = new KeyedSplitCache<string, { value: number }>();
    const create = vi.fn(() => ({ value: 1 }));
    const first = cache.of('a', create);
    const second = cache.of('a', create);
    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('get() returns undefined for a key that was never created', () => {
    const cache = new KeyedSplitCache<string, number>();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('prune() only evicts keys that are both not-live and shouldEvict-approved, running onEvict first', () => {
    const cache = new KeyedSplitCache<string, { disposed: boolean }>();
    cache.of('a', () => ({ disposed: false }));
    cache.of('b', () => ({ disposed: false }));
    const onEvict = vi.fn();
    // Neither key is "live", but shouldEvict blocks eviction entirely -> nothing removed.
    const blocked = cache.prune(
      () => false,
      () => false,
      onEvict
    );
    expect(blocked).toBe(0);
    expect(cache.size).toBe(2);
    expect(onEvict).not.toHaveBeenCalled();

    // 'b' is live (retained regardless); 'a' is not live and shouldEvict approves -> evicted.
    const removed = cache.prune((key) => key === 'b', undefined, onEvict);
    expect(removed).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(onEvict).toHaveBeenCalledTimes(1);
  });

  it('clear() empties the cache; keys()/values() iterate current entries', () => {
    const cache = new KeyedSplitCache<string, number>();
    cache.of('a', () => 1);
    cache.of('b', () => 2);
    expect([...cache.keys()].sort()).toEqual(['a', 'b']);
    expect([...cache.values()].sort()).toEqual([1, 2]);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
