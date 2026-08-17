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

  it('forces non-positive maxHistory/maxTrace up to a minimum of 1', () => {
    const { store } = makeStore();
    const tools = createStoreDevTools(store, { maxHistory: 0, maxTrace: -5 });
    store.increment();
    store.increment();

    expect(tools.history.length).toBe(1);
    expect(tools.trace.length).toBeLessThanOrEqual(1);
    tools.dispose();
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
});
