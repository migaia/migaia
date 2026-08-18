import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import {
  atomDef,
  atomDefFactory,
  createAtomStore,
  defaultAtomStore,
  derivedDef,
  previewSafeAtomDefFactory,
  writableDef
} from '../src';

describe('AtomStore: reads', () => {
  it('preserves cloneable prototypes and fails closed for non-cloneable initial values', () => {
    const date = new Date('2020-01-02T03:04:05.000Z');
    const dateStore = createAtomStore(createRuntime());
    const dateDef = atomDef({ when: date });
    const snapshot = dateStore.get(dateDef);
    expect(snapshot.when).toBeInstanceOf(Date);
    expect(snapshot.when).not.toBe(date);
    dateStore.dispose();

    const functionStore = createAtomStore(createRuntime());
    const functionDef = atomDef({ run: () => 1 });
    expect(() => functionStore.get(functionDef)).toThrow(
      '[store] primitive initial value cannot be cloned independently'
    );
    functionStore.dispose();
  });

  it('get() returns the primitive init value and reflects writes', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    expect(store.get(count)).toBe(0);
    store.set(count, 5);
    expect(store.get(count)).toBe(5);
    store.dispose();
  });

  it('set() accepts a functional updater', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(1);
    store.set(count, (previous: number) => previous + 41);
    expect(store.get(count)).toBe(42);
    store.dispose();
  });

  it('primitive-factory create() runs once per store, lazily on first access', () => {
    const store = createAtomStore(createRuntime());
    const create = vi.fn(() => ({ value: 1 }));
    const def = atomDefFactory(create);
    expect(create).not.toHaveBeenCalled();
    const first = store.get(def);
    const second = store.get(def);
    expect(create).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    store.dispose();
  });

  it('derived definitions recompute from their dependencies', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(2);
    const doubled = derivedDef((get) => get(count) * 2);
    expect(store.get(doubled)).toBe(4);
    store.set(count, 10);
    expect(store.get(doubled)).toBe(20);
    store.dispose();
  });

  it('custom equals suppresses downstream notification when the selected value is unchanged', () => {
    const store = createAtomStore(createRuntime());
    const source = atomDef({ id: 1, noise: 0 });
    const idOnly = derivedDef((get) => get(source).id, undefined, Object.is);
    let notifications = 0;
    const unsubscribe = store.sub(idOnly, () => notifications++);
    store.set(source, (previous: { id: number; noise: number }) => ({
      ...previous,
      noise: previous.noise + 1
    }));
    expect(store.get(idOnly)).toBe(1);
    expect(notifications).toBe(0);
    store.set(source, (previous: { id: number; noise: number }) => ({ ...previous, id: 2 }));
    expect(notifications).toBe(1);
    unsubscribe();
    store.dispose();
  });

  it('peek() returns the current value without requiring a tracking context', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(7);
    expect(store.peek(count)).toBe(7);
    store.dispose();
  });
});

describe('AtomStore: writable-derived', () => {
  it('write(get, set, ...args) can read and write other definitions', () => {
    const store = createAtomStore(createRuntime());
    const a = atomDef(1);
    const b = atomDef(10);
    const swap = writableDef(
      (get) => get(a) + get(b),
      (get, set) => {
        const currentA = get(a);
        const currentB = get(b);
        set(a, currentB);
        set(b, currentA);
      }
    );
    store.set(swap);
    expect(store.get(a)).toBe(10);
    expect(store.get(b)).toBe(1);
    store.dispose();
  });

  it('write() return value is propagated as the result of store.set()', () => {
    const store = createAtomStore(createRuntime());
    const counter = atomDef(0);
    const incrementBy = writableDef(
      (get) => get(counter),
      (get, set, amount: number) => {
        const next = get(counter) + amount;
        set(counter, next);
        return next;
      }
    );
    const result = store.set(incrementBy, 5);
    expect(result).toBe(5);
    expect(store.get(counter)).toBe(5);
    store.dispose();
  });
});

describe('AtomStore: error paths', () => {
  it('set() on a read-only derived definition throws TypeError', () => {
    const store = createAtomStore(createRuntime());
    const readOnly = derivedDef(() => 1);
    expect(() => store.set(readOnly as never, 2)).toThrow(TypeError);
    expect(() => store.set(readOnly as never, 2)).toThrow(
      '[store] atom override resolved to a read-only definition'
    );
    store.dispose();
  });

  it('rejects a non-definition value at every entry point', () => {
    const store = createAtomStore(createRuntime());
    const bogus = { kind: 'primitive', init: 1 } as never;
    expect(() => store.get(bogus)).toThrow('[store] not an atom definition');
    expect(() => store.set(bogus, 1)).toThrow('[store] not an atom definition');
    expect(() => store.sub(bogus, () => {})).toThrow('[store] not an atom definition');
    expect(() => store.isObserved(bogus)).toThrow('[store] not an atom definition');
    expect(() => store.release(bogus)).toThrow('[store] not an atom definition');
    store.dispose();
  });

  it('every entry point throws once the store is disposed', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    store.dispose();
    const message = '[store] cannot use a disposed atom store';
    expect(() => store.get(count)).toThrow(message);
    expect(() => store.peek(count)).toThrow(message);
    expect(() => store.preview(count)).toThrow(message);
    expect(() => store.set(count, 1)).toThrow(message);
    expect(() => store.sub(count, () => {})).toThrow(message);
    expect(() => store.override(count, atomDef(1))).toThrow(message);
    expect(() => store.isObserved(count)).toThrow(message);
    expect(() => store.release(count)).toThrow(message);
  });
});

describe('AtomStore: subscriptions', () => {
  it('sub() does not fire on the initial run, only on subsequent changes', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    const onChange = vi.fn();
    const unsubscribe = store.sub(count, onChange);
    expect(onChange).not.toHaveBeenCalled();
    store.set(count, 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.dispose();
  });

  it('unsubscribe() stops further notifications and is idempotent', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    const onChange = vi.fn();
    const unsubscribe = store.sub(count, onChange);
    unsubscribe();
    unsubscribe();
    store.set(count, 1);
    expect(onChange).not.toHaveBeenCalled();
    store.dispose();
  });

  it('an error thrown inside onChange is routed to runtime.reportError and does not kill the subscription', () => {
    const onError = vi.fn();
    const store = createAtomStore(createRuntime({ onError }));
    const count = atomDef(0);
    let calls = 0;
    const unsubscribe = store.sub(count, () => {
      calls++;
      throw new Error('listener boom');
    });
    store.set(count, 1);
    expect(calls).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'subscription-listener' });
    // The Effect must still be alive: a second change fires onChange again.
    store.set(count, 2);
    expect(calls).toBe(2);
    unsubscribe();
    store.dispose();
  });

  it('contains a throwing runtime reporter without killing the subscription', () => {
    const runtime = createRuntime();
    const reporterFailure = new Error('runtime reporter failed');
    const hostReportError = vi.fn();
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      throw reporterFailure;
    });
    vi.stubGlobal('reportError', hostReportError);
    try {
      const store = createAtomStore(runtime);
      const count = atomDef(0);
      let calls = 0;
      const unsubscribe = store.sub(count, () => {
        calls++;
        throw new Error('listener boom');
      });

      expect(() => store.set(count, 1)).not.toThrow();
      expect(() => store.set(count, 2)).not.toThrow();
      expect(calls).toBe(2);
      expect(hostReportError).toHaveBeenCalledWith(reporterFailure);
      unsubscribe();
      store.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('AtomStore: override', () => {
  it('a read-only definition can be routed to any other definition of the same value type', () => {
    const store = createAtomStore(createRuntime());
    const original = derivedDef(() => 1);
    const replacement = derivedDef(() => 999);
    expect(store.get(original)).toBe(1);
    const undo = store.override(original, replacement);
    expect(store.get(original)).toBe(999);
    undo();
    expect(store.get(original)).toBe(1);
    store.dispose();
  });

  it('primitive can only be overridden by primitive/primitive-factory', () => {
    const store = createAtomStore(createRuntime());
    const primitive = atomDef(1);
    const derived = derivedDef(() => 2);
    expect(() => store.override(primitive, derived as never)).toThrow(
      '[store] atom override must preserve the original write contract'
    );
    const undo = store.override(primitive, atomDef(2));
    expect(store.get(primitive)).toBe(2);
    undo();
    store.dispose();
  });

  it('writable-derived can only be overridden by another writable-derived', () => {
    const store = createAtomStore(createRuntime());
    const base = atomDef(0);
    const writable = writableDef(
      (get) => get(base),
      (get, set, value: number) => set(base, value)
    );
    const primitiveReplacement = atomDef(1);
    expect(() => store.override(writable, primitiveReplacement as never)).toThrow(
      '[store] atom override must preserve the original write contract'
    );
    store.dispose();
  });

  it('overriding invalidates existing subscribers of the original definition', () => {
    const store = createAtomStore(createRuntime());
    const original = derivedDef(() => 1);
    const onChange = vi.fn();
    const unsubscribe = store.sub(original, onChange);
    store.override(
      original,
      derivedDef(() => 2)
    );
    // `invalidateResolved()` disconnects the old instance's downstream edge and marks the
    // subscribing Effect dirty via `onDependencyDisconnected()`, which only *enqueues* it on the
    // scheduler (reactive/src/reactive/effect.class.ts) — it never re-runs synchronously. The
    // Effect only actually re-executes (and thus calls `onChange`) once the queue is flushed.
    store.runtime.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.peek(original)).toBe(2);
    unsubscribe();
    store.dispose();
  });

  it('supports stacked overrides; undoing a non-top layer still leaves the top layer resolved', () => {
    const store = createAtomStore(createRuntime());
    const original = derivedDef(() => 'base');
    const layer1 = derivedDef(() => 'layer1');
    const layer2 = derivedDef(() => 'layer2');
    const undo1 = store.override(original, layer1);
    const undo2 = store.override(original, layer2);
    expect(store.get(original)).toBe('layer2');
    undo1();
    expect(store.get(original)).toBe('layer2');
    undo2();
    expect(store.get(original)).toBe('base');
    store.dispose();
  });

  it('detects a cyclic override chain', () => {
    const store = createAtomStore(createRuntime());
    const a = derivedDef(() => 'a');
    const b = derivedDef(() => 'b');
    store.override(a, b);
    // `override()` itself resolves the chain right after registering the new layer (to decide
    // whether to invalidate existing subscribers) — the cycle a→b→a is detected and thrown here,
    // synchronously, not deferred to the next `resolve()` at a `get()` call site.
    expect(() => store.override(b, a)).toThrow('[store] cyclic atom override');
    store.dispose();
  });

  it('an undo function is a no-op after the store is disposed', () => {
    const store = createAtomStore(createRuntime());
    const original = derivedDef(() => 1);
    const undo = store.override(
      original,
      derivedDef(() => 2)
    );
    store.dispose();
    expect(() => undo()).not.toThrow();
  });
});

describe('AtomStore: preview', () => {
  it('previews a primitive without materializing a persistent instance', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(3);
    expect(store.preview(count)).toBe(3);
    expect(store.size).toBe(0);
    store.dispose();
  });

  it('short-circuits to peek() semantics once a real instance already exists', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(1);
    store.get(count);
    store.set(count, 9);
    expect(store.preview(count)).toBe(9);
    store.dispose();
  });

  it('rejects a non-preview-safe primitive-factory', () => {
    const store = createAtomStore(createRuntime());
    const def = atomDefFactory(() => 1);
    expect(() => store.preview(def)).toThrow('[store] atom factory is not marked preview-safe');
    store.dispose();
  });

  it('allows a preview-safe primitive-factory and does not persist an instance', () => {
    const store = createAtomStore(createRuntime());
    const create = vi.fn(() => 5);
    const def = previewSafeAtomDefFactory(create);
    expect(store.preview(def)).toBe(5);
    expect(store.size).toBe(0);
    store.dispose();
  });

  it('detects a self-referential circular preview', () => {
    const store = createAtomStore(createRuntime());
    let selfDef: ReturnType<typeof derivedDef<number>>;
    selfDef = derivedDef((get) => get(selfDef));
    expect(() => store.preview(selfDef)).toThrow('[store] circular atom preview detected');
    store.dispose();
  });
});

describe('AtomStore: observation and release', () => {
  it('isObserved() is false until a subscriber attaches, and false again after unsubscribing', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    expect(store.isObserved(count)).toBe(false);
    const unsubscribe = store.sub(count, () => {});
    expect(store.isObserved(count)).toBe(true);
    unsubscribe();
    expect(store.isObserved(count)).toBe(false);
    store.dispose();
  });

  it('isObserved() does not create an instance merely by being queried', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    expect(store.isObserved(count)).toBe(false);
    expect(store.size).toBe(0);
    store.dispose();
  });

  it('release() removes only the targeted instance and reports whether it did', () => {
    const store = createAtomStore(createRuntime());
    const a = atomDef(1);
    const b = atomDef(2);
    store.get(a);
    store.get(b);
    expect(store.size).toBe(2);
    expect(store.release(a)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.release(a)).toBe(false);
    store.dispose();
  });

  it('releasing a definition resets its state on the next access', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    store.set(count, 100);
    store.release(count);
    expect(store.get(count)).toBe(0);
    store.dispose();
  });
});

describe('AtomStore: dispose', () => {
  it('is idempotent', () => {
    const store = createAtomStore(createRuntime());
    store.dispose();
    expect(() => store.dispose()).not.toThrow();
    expect(store.disposed).toBe(true);
  });

  it('unsubscribes all active subscriptions and releases all instances', () => {
    const store = createAtomStore(createRuntime());
    const count = atomDef(0);
    const onChange = vi.fn();
    store.sub(count, onChange);
    store.get(count);
    expect(store.size).toBe(1);
    store.dispose();
    expect(store.size).toBe(0);
  });
});

describe('defaultAtomStore', () => {
  it('returns the same store for the same runtime, and a fresh one after disposal', () => {
    const runtime = createRuntime();
    const first = defaultAtomStore(runtime);
    const second = defaultAtomStore(runtime);
    expect(first).toBe(second);
    first.dispose();
    const third = defaultAtomStore(runtime);
    expect(third).not.toBe(first);
    expect(third.disposed).toBe(false);
    third.dispose();
  });

  it('gives independent state per runtime', () => {
    const runtimeA = createRuntime();
    const runtimeB = createRuntime();
    const storeA = defaultAtomStore(runtimeA);
    const storeB = defaultAtomStore(runtimeB);
    expect(storeA).not.toBe(storeB);
    storeA.dispose();
    storeB.dispose();
  });
});
