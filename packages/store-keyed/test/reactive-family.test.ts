import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import type { IDisposable } from '@migaia/reactive';
import { computedFamily, createFamily } from '../src/reactive/family';

type IItem = IDisposable & { readonly key: unknown };

function makeItemFactory(disposeImpl?: (key: unknown) => void) {
  const created: IItem[] = [];
  const create = (key: unknown): IItem => {
    let disposed = false;
    const item: IItem = {
      key,
      dispose: vi.fn(() => {
        disposed = true;
        disposeImpl?.(key);
      }),
      get disposed() {
        return disposed;
      }
    };
    created.push(item);
    return item;
  };
  return { create, created };
}

describe('createFamily: basic get/peek/has', () => {
  it('creates lazily on first get() and caches on repeat access', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    const first = family.get('a');
    const second = family.get('a');
    expect(first).toBe(second);
    expect(family.size).toBe(1);
  });

  it('is callable directly (family(key) === family.get(key))', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    expect(family('a')).toBe(family.get('a'));
  });

  it('peek() does not create an entry, and has() reflects peek()', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    expect(family.peek('a')).toBeUndefined();
    expect(family.has('a')).toBe(false);
    family.get('a');
    expect(family.peek('a')).toBeDefined();
    expect(family.has('a')).toBe(true);
  });

  it('supports object keys via an internal WeakMap', () => {
    const { create } = makeItemFactory();
    const family = createFamily<object, IItem>({ create, isObserved: () => false });
    const keyA = {};
    const keyB = {};
    const a = family.get(keyA);
    expect(family.get(keyA)).toBe(a);
    expect(family.get(keyB)).not.toBe(a);
  });
});

describe('createFamily: remove/clear/dispose', () => {
  it('remove() force-disposes even an observed entry and reports whether one existed', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => true });
    const item = family.get('a');
    expect(family.remove('a')).toBe(true);
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(family.remove('a')).toBe(false);
  });

  it('clear() disposes every reachable entry, including observed ones', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => true });
    const a = family.get('a');
    const b = family.get('b');
    family.clear();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(family.size).toBe(0);
  });

  it('dispose() is idempotent and disposes remaining entries once', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    const a = family.get('a');
    family.dispose();
    family.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(family.disposed).toBe(true);
  });

  it('every entry point throws once disposed', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    family.dispose();
    const message = '[store] cannot use a disposed family';
    expect(() => family.get('a')).toThrow(message);
    expect(() => family.peek('a')).toThrow(message);
    expect(() => family.has('a')).toThrow(message);
    expect(() => family.remove('a')).toThrow(message);
    expect(() => family.clear()).toThrow(message);
    expect(() => family.prune()).toThrow(message);
  });
});

describe('createFamily: maxSize (unobserved-only LRU)', () => {
  it('evicts the least-recently-accessed unobserved entry once over capacity', () => {
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({ create, isObserved: () => false, maxSize: 2 });
    const a = family.get('a');
    family.get('b');
    family.get('a'); // touch 'a' so 'b' becomes the least-recently-used
    family.get('c'); // over capacity -> evict least-recently-used ('b')
    expect(family.has('a')).toBe(true);
    expect(family.has('b')).toBe(false);
    expect(family.has('c')).toBe(true);
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('does not count observed entries against the capacity limit', () => {
    const observed = new Set<unknown>();
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({
      create,
      isObserved: (value) => observed.has((value as IItem).key),
      maxSize: 1
    });
    const a = family.get('a');
    observed.add('a');
    family.get('b'); // 'a' is observed, so it is exempt from the maxSize=1 budget
    expect(family.has('a')).toBe(true);
    expect(family.has('b')).toBe(true);
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('rejects a non-positive-integer maxSize', () => {
    const { create } = makeItemFactory();
    expect(() =>
      createFamily<string, IItem>({ create, isObserved: () => false, maxSize: 0 })
    ).toThrow(RangeError);
    expect(() =>
      createFamily<string, IItem>({ create, isObserved: () => false, maxSize: 1.5 })
    ).toThrow('[store] family maxSize must be a positive integer');
  });
});

describe('createFamily: ttl with an injected clock', () => {
  it('an expired, unobserved entry is recreated on next get()', () => {
    let clock = 0;
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({
      create,
      isObserved: () => false,
      ttl: 100,
      now: () => clock
    });
    const first = family.get('a');
    clock = 50;
    expect(family.get('a')).toBe(first); // not expired yet
    clock = 150;
    const second = family.get('a');
    expect(second).not.toBe(first);
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });

  it('an expired but observed entry is retained until it stops being observed', () => {
    let clock = 0;
    let observedFlag = true;
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({
      create,
      isObserved: () => observedFlag,
      ttl: 100,
      now: () => clock
    });
    const first = family.get('a');
    clock = 200; // well past expiry
    expect(family.peek('a')).toBe(first); // still observed -> retained despite expiry
    expect(family.prune()).toBe(0);
    observedFlag = false;
    expect(family.prune()).toBe(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(family.peek('a')).toBeUndefined();
  });

  it('peek() on an expired unobserved entry disposes it and returns undefined', () => {
    let clock = 0;
    const { create } = makeItemFactory();
    const family = createFamily<string, IItem>({
      create,
      isObserved: () => false,
      ttl: 10,
      now: () => clock
    });
    const first = family.get('a');
    clock = 20;
    expect(family.peek('a')).toBeUndefined();
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects a negative or NaN ttl', () => {
    const { create } = makeItemFactory();
    expect(() => createFamily<string, IItem>({ create, isObserved: () => false, ttl: -1 })).toThrow(
      '[store] family ttl must be non-negative'
    );
    expect(() =>
      createFamily<string, IItem>({ create, isObserved: () => false, ttl: Number.NaN })
    ).toThrow(RangeError);
  });
});

describe('createFamily: aggregated disposal failures', () => {
  it('a single disposal failure during clear() is thrown as-is', () => {
    const create = (): IItem => ({
      key: 'x',
      dispose: () => {
        throw new Error('boom');
      },
      disposed: false
    });
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    family.get('a');
    expect(() => family.clear()).toThrow('boom');
  });

  it('multiple disposal failures during clear() are combined into an AggregateError', () => {
    const create = (key: string): IItem => ({
      key,
      dispose: () => {
        throw new Error(`boom-${key}`);
      },
      disposed: false
    });
    const family = createFamily<string, IItem>({ create, isObserved: () => false });
    family.get('a');
    family.get('b');
    expect(() => family.clear()).toThrow(AggregateError);
    try {
      const family2 = createFamily<string, IItem>({ create, isObserved: () => false });
      family2.get('a');
      family2.get('b');
      family2.clear();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
      expect((error as AggregateError).message).toBe(
        '[store] family disposal failed for multiple entries'
      );
    }
  });
});

describe('createFamily: missing WeakRef/FinalizationRegistry', () => {
  it('throws a descriptive error instead of silently degrading', () => {
    const originalWeakRef = globalThis.WeakRef;
    // @ts-expect-error intentionally deleting a required global to test the guard
    delete globalThis.WeakRef;
    try {
      expect(() =>
        createFamily<string, IItem>({
          create: () => makeItemFactory().create('a'),
          isObserved: () => false
        })
      ).toThrow(
        '[store] createFamily() requires WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox'
      );
    } finally {
      globalThis.WeakRef = originalWeakRef;
    }
  });
});

describe('computedFamily', () => {
  it('derives a computed value per key from the given runtime', () => {
    const runtime = createRuntime();
    const family = computedFamily((multiplier: number) => multiplier * 2, runtime);
    const computed = family.get(3);
    expect(computed.value).toBe(6);
    family.dispose();
  });

  it('isObserved reflects the underlying computed value observed state', () => {
    const runtime = createRuntime();
    const family = computedFamily((key: number) => key, runtime, { maxSize: 1 });
    const a = family.get(1);
    const unsubscribe = runtime.effect(() => {
      void a.value;
    });
    family.get(2); // over capacity, but 'a' is observed via the effect -> retained
    expect(family.has(1)).toBe(true);
    // `runtime.effect()` returns an `IDisposer` (`() => void`), not an object with a `.dispose()`
    // method — call it directly.
    unsubscribe();
    family.dispose();
  });
});
