import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { createStore } from '@migaia/store-light';
import { createStoreDevTools } from '../src/index';

function makeStore(runtimeOverrides?: Parameters<typeof createRuntime>[0]) {
  const runtime = createRuntime(runtimeOverrides);
  const store = createStore(
    {
      count: 0,
      increment() {
        this.count++;
      },
      boom() {
        throw new Error('boom');
      }
    },
    { runtime, debugName: 'myStore' }
  );
  return { runtime, store };
}

describe('createStoreDevTools', () => {
  it('rejects null options with a tagged configuration error', () => {
    const store = createStore({ count: 0 });
    expect(() => createStoreDevTools(store, null as never)).toThrow(
      '[store] DevTools options must be an object'
    );
    store.$dispose();
  });

  it('rejects non-function now and clone callbacks before subscribing', () => {
    const { store } = makeStore();
    expect(() => createStoreDevTools(store, { now: 1 as never })).toThrow(
      '[store] DevTools now must be a function'
    );
    expect(() => createStoreDevTools(store, { clone: 1 as never })).toThrow(
      '[store] DevTools clone must be a function'
    );
    store.$dispose();
  });

  it('records an initial snapshot synchronously at construction time', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    expect(tools.history).toHaveLength(1);
    expect(tools.history[0]).toMatchObject({ id: 1, label: 'initial', state: { count: 0 } });
    tools.dispose();
  });

  it('record() appends a manual snapshot with a default or custom label and returns it', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    const entry = tools.record();
    expect(entry.label).toBe('state change');
    expect(tools.history).toHaveLength(2);
    expect(tools.history[1]).toBe(entry);

    const labeled = tools.record('before-submit');
    expect(labeled.label).toBe('before-submit');
    expect(tools.history).toHaveLength(3);
    tools.dispose();
  });

  it('auto-records on store notification and auto-traces the action that caused it', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    store.increment();

    expect(tools.history).toHaveLength(2);
    expect(tools.history[1]).toMatchObject({ label: 'state change', state: { count: 1 } });

    expect(tools.actions).toHaveLength(1);
    expect(tools.actions[0].name).toBe('myStore.increment');
    expect(tools.actions[0].error).toBeUndefined();
    expect(typeof tools.actions[0].durationMs).toBe('number');
    tools.dispose();
  });

  it('records a failed action with its error, without producing a spurious history entry', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    const historyBefore = tools.history.length;

    expect(() => store.boom()).toThrow('boom');

    expect(tools.actions).toHaveLength(1);
    expect(tools.actions[0].name).toBe('myStore.boom');
    expect(tools.actions[0].error).toBeInstanceOf(Error);
    expect((tools.actions[0].error as Error).message).toBe('boom');
    // boom() never wrote a signal, so the store never notified $subscribe.
    expect(tools.history).toHaveLength(historyBefore);
    tools.dispose();
  });

  it('captureRuntimeTrace: false disables trace capture and automatic action recording', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, { captureRuntimeTrace: false });
    store.increment();

    expect(tools.trace).toEqual([]);
    expect(tools.actions).toEqual([]);

    // manual recordAction still works even with capture disabled
    tools.recordAction({ name: 'manual', durationMs: 1 });
    expect(tools.actions).toHaveLength(1);
    expect(tools.actions[0].name).toBe('manual');
    tools.dispose();
  });

  it('maxHistory bounds history while maxTrace independently bounds actions', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, { maxHistory: 2 });
    // 1 initial + 3 increments = 4 notifications total, capped to 2
    store.increment();
    store.increment();
    store.increment();

    expect(tools.history).toHaveLength(2);
    expect(tools.history.map((h) => h.state.count)).toEqual([2, 3]);
    expect(tools.actions).toHaveLength(3);
    expect(tools.actions.map((a) => a.name)).toEqual([
      'myStore.increment',
      'myStore.increment',
      'myStore.increment'
    ]);
    tools.dispose();
  });

  it('rejects non-positive maxHistory/maxTrace instead of disabling bounds', () => {
    const { store } = makeStore();
    expect(() => createStoreDevTools(store, { maxHistory: 0 })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    );
    expect(() => createStoreDevTools(store, { maxTrace: -5 })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    );
    store.$dispose();
  });

  it('rejects non-finite and fractional queue limits before subscribing', () => {
    const { store } = makeStore();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => createStoreDevTools(store, { maxHistory: value })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      );
      expect(() => createStoreDevTools(store, { maxTrace: value })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      );
    }
    store.$dispose();
  });

  it('trace never exceeds maxTrace even under many runtime events', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, { maxTrace: 3 });
    for (let i = 0; i < 10; i++) store.increment();

    expect(tools.trace.length).toBeLessThanOrEqual(3);
    tools.dispose();
  });

  it('uses the provided now() for every timestamp instead of Date.now()', () => {
    const { store } = makeStore();
    let clock = 1000;
    const tools = createStoreDevTools(store, { now: () => clock });
    expect(tools.history[0].timestamp).toBe(1000);

    clock = 2000;
    tools.record('tick');
    expect(tools.history[1].timestamp).toBe(2000);
    tools.dispose();
  });

  it('default clone (ClonePolicy.diagnostic) produces an independent snapshot', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    const entry = tools.history[0];
    store.count = 999;
    // the recorded snapshot must not have been mutated by the later write
    expect(entry.state.count).toBe(0);
    tools.dispose();
  });

  it('honors a custom clone function in place of the default policy', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, {
      clone: (state) => ({ ...state, tag: 'custom' })
    });
    expect(tools.history[0].state).toMatchObject({ count: 0, tag: 'custom' });
    tools.dispose();
  });

  it('jumpTo() hydrates the store from a past snapshot without recording a new history entry', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    const initialId = tools.history[0].id;

    store.increment();
    store.increment();
    expect(store.count).toBe(2);
    const lengthBeforeJump = tools.history.length;

    tools.jumpTo(initialId);
    expect(store.count).toBe(0);
    // the $hydrate-triggered notification must be suppressed while replaying
    expect(tools.history).toHaveLength(lengthBeforeJump);

    // the replay guard must fully reset: a real mutation afterwards records normally again
    store.increment();
    expect(tools.history).toHaveLength(lengthBeforeJump + 1);
    tools.dispose();
  });

  it('jumpTo() throws RangeError for an unknown id', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    expect(() => tools.jumpTo(999)).toThrow(RangeError);
    expect(() => tools.jumpTo(999)).toThrow('[store] unknown history entry: 999');
    tools.dispose();
  });

  it('jumpTo() drops history entries that have been trimmed by maxHistory', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, { maxHistory: 2 });
    const firstId = tools.history[0].id; // 'initial', will be trimmed
    store.increment();
    store.increment(); // now only the last 2 entries remain; firstId is gone

    expect(() => tools.jumpTo(firstId)).toThrow(RangeError);
    tools.dispose();
  });

  it('clear() resets all three queues to a single fresh "initial" entry, without resetting the id counter', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    store.increment();
    store.increment();
    const idBeforeClear = tools.history[tools.history.length - 1].id;

    tools.clear();
    expect(tools.history).toHaveLength(1);
    expect(tools.history[0].label).toBe('initial');
    expect(tools.actions).toEqual([]);
    expect(tools.trace).toEqual([]);
    expect(tools.history[0].id).toBeGreaterThan(idBeforeClear);
    tools.dispose();
  });

  it('dispose() is idempotent and detaches store/runtime listeners', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    const historyLengthAtDispose = tools.history.length;

    tools.dispose();
    expect(() => tools.dispose()).not.toThrow();

    // listeners are detached: further mutations must not grow history/actions
    store.increment();
    expect(tools.history).toHaveLength(historyLengthAtDispose);
    expect(tools.actions).toEqual([]);
  });

  it('after dispose(), mutating methods throw but read-only queues remain accessible', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store);
    tools.dispose();

    expect(() => tools.record()).toThrow('[store] DevTools session is disposed');
    expect(() => tools.recordAction({ name: 'x' })).toThrow('[store] DevTools session is disposed');
    expect(() => tools.jumpTo(1)).toThrow('[store] DevTools session is disposed');
    expect(() => tools.clear()).toThrow('[store] DevTools session is disposed');

    expect(() => tools.history).not.toThrow();
    expect(() => tools.actions).not.toThrow();
    expect(() => tools.trace).not.toThrow();
  });

  it('manual record() propagates a throwing clone() directly to the caller', () => {
    const { store } = makeStore();
    let shouldThrow = false;
    const tools = createStoreDevTools(store, {
      clone: (state) => {
        if (shouldThrow) throw new Error('clone failed');
        return { ...state };
      }
    });
    shouldThrow = true;
    expect(() => tools.record()).toThrow('clone failed');
    tools.dispose();
  });

  it('keeps all diagnostic queues unchanged when clear cannot create its replacement snapshot', () => {
    const { store } = makeStore();
    let shouldThrow = false;
    const tools = createStoreDevTools(store, {
      clone: (state) => {
        if (shouldThrow) throw new Error('clear snapshot failed');
        return { ...state };
      }
    });
    tools.recordAction({ name: 'before-clear' });
    const historyBefore = [...tools.history];
    const actionsBefore = [...tools.actions];
    const traceBefore = [...tools.trace];
    shouldThrow = true;

    expect(() => tools.clear()).toThrow('clear snapshot failed');
    expect(tools.history).toEqual(historyBefore);
    expect(tools.actions).toEqual(actionsBefore);
    expect(tools.trace).toEqual(traceBefore);
    tools.dispose();
  });

  it('retains non-Error construction failure and unsubscribe cleanup failure in order', () => {
    const { runtime, store } = makeStore();
    const primary = Symbol('trace subscription failed');
    const cleanup = Symbol('unsubscribe failed');
    vi.spyOn(runtime, 'subscribeTrace').mockImplementation(() => {
      throw primary;
    });
    vi.spyOn(store, '$subscribe').mockReturnValue(() => {
      throw cleanup;
    });

    try {
      createStoreDevTools(store);
      throw new Error('expected construction to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([primary, cleanup]);
    }
  });

  it('a throwing clone() during an auto-triggered record is isolated via runtime.reportError, not thrown to business code', () => {
    const onError = vi.fn();
    const { store } = makeStore({ onError });
    let shouldThrow = false;
    const tools = createStoreDevTools(store, {
      clone: (state) => {
        if (shouldThrow) throw new Error('diagnostic clone failed');
        return { ...state };
      }
    });
    shouldThrow = true;

    // the business mutation itself must not throw...
    expect(() => store.increment()).not.toThrow();
    // ...but the failure must be reported with phase 'trace-listener'
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, context] = onError.mock.calls[0];
    expect((error as Error).message).toBe('diagnostic clone failed');
    expect(context).toMatchObject({ phase: 'trace-listener' });
    tools.dispose();
  });

  it('isolates a throwing diagnostic clock in runtime trace capture', () => {
    const onError = vi.fn();
    const { store } = makeStore({ onError });
    let calls = 0;
    const tools = createStoreDevTools(store, {
      now: () => {
        calls++;
        if (calls > 1) throw new Error('clock failed');
        return calls;
      }
    });
    expect(() => store.increment()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'clock failed' }),
      expect.objectContaining({ phase: 'trace-listener' })
    );
    tools.dispose();
  });

  it('contains a runtime reporter failure during auto-record diagnostics', () => {
    const reported: unknown[] = [];
    const previous = (globalThis as { reportError?: (error: unknown) => void }).reportError;
    (globalThis as { reportError?: (error: unknown) => void }).reportError = (error) => {
      reported.push(error);
    };
    const { store, runtime } = makeStore();
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      throw new Error('runtime reporter failed');
    });
    let shouldThrow = false;
    const tools = createStoreDevTools(store, {
      clone: (state) => {
        if (shouldThrow) throw new Error('diagnostic clone failed');
        return { ...state };
      }
    });
    try {
      shouldThrow = true;
      expect(() => store.increment()).not.toThrow();
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({ message: 'runtime reporter failed' });
    } finally {
      tools.dispose();
      if (previous)
        (globalThis as { reportError?: (error: unknown) => void }).reportError = previous;
      else delete (globalThis as { reportError?: (error: unknown) => void }).reportError;
    }
  });
});

it('contains revoked and throwing options getters as tagged configuration errors', () => {
  const { store } = makeStore();
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expect(() => createStoreDevTools(store, revoked.proxy as never)).toThrow(
    expect.objectContaining({
      source: '@migaia/store-devtools',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
  );
  expect(() =>
    createStoreDevTools(store, {
      get maxHistory() {
        throw new Error('limit getter failed');
      }
    } as never)
  ).toThrow(
    expect.objectContaining({
      source: '@migaia/store-devtools',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
  );
});
