import { describe, expect, it } from 'vitest';
import { createStore } from '@migaia/store-light';
import { bindStoreMiddleware, createMutationPolicy, type IMiddlewareEvent } from '../src/index';

describe('bindStoreMiddleware', () => {
  it('default clone (structuredClone) produces independent previous/next snapshots', () => {
    const store = createStore({ value: 1 });
    const host = bindStoreMiddleware(store);
    const events: IMiddlewareEvent<Record<string, unknown>>[] = [];
    host.attachBindingDisposer(() => undefined);
    const seen: Array<{ previous: unknown; next: unknown }> = [];
    void events;
    // Use a middlewarePlugin-free approach: subscribe directly via recordState by installing
    // a plugin through the public API.
    return host
      .use({
        name: 'capture',
        install: (core) => {
          core.usePipeline((event, next) => {
            if (event.type === 'state') seen.push({ previous: event.previous, next: event.next });
            next(event);
          });
          return {};
        }
      })
      .then(async () => {
        store.value = 2;
        await Promise.resolve();
        expect(seen).toHaveLength(1);
        const first = seen[0]!;
        expect(first.previous).toEqual({ value: 1 });
        expect(first.next).toEqual({ value: 2 });
        // Mutate the store further; the already-recorded snapshot must not change,
        // proving structuredClone gave us an independent copy, not a live reference.
        store.value = 3;
        expect(first.next).toEqual({ value: 2 });
        return host.dispose();
      });
  });

  it('honors a custom clone function instead of the structuredClone default', async () => {
    const store = createStore({ value: 1 });
    const calls: Record<string, unknown>[] = [];
    const host = bindStoreMiddleware(store, {
      clone: (state) => {
        calls.push(state);
        return { ...state };
      }
    });
    store.value = 2;
    await Promise.resolve();
    expect(calls.length).toBeGreaterThan(0);
    await host.dispose();
  });

  it('captures "previous" as the state at bind time, not at store-creation time', async () => {
    const store = createStore({ value: 1 });
    store.value = 5; // mutate BEFORE binding
    const host = bindStoreMiddleware(store);
    const seen: Array<{ previous: unknown; next: unknown }> = [];
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          if (event.type === 'state') seen.push({ previous: event.previous, next: event.next });
          next(event);
        });
        return {};
      }
    });
    store.value = 6;
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    // previous must reflect the bind-time value (5), not the creation-time value (1)
    expect(seen[0]).toEqual({ previous: { value: 5 }, next: { value: 6 } });
    await host.dispose();
  });

  it('forwards Runtime action trace as action:start/end events with "<debugName>.<method>" names', async () => {
    const store = createStore(
      {
        value: 1,
        increment() {
          this.value++;
        }
      },
      { debugName: 'Counter' }
    );
    const host = bindStoreMiddleware(store);
    const events: IMiddlewareEvent<Record<string, unknown>>[] = [];
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event);
          next(event);
        });
        return {};
      }
    });
    store.increment();
    const actionEvents = events.filter((e) => e.type === 'action');
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'end']);
    expect(actionEvents.every((e) => (e as { name: string }).name === 'Counter.increment')).toBe(
      true
    );
    await host.dispose();
  });

  it('forwards action:error when the traced action throws', async () => {
    const store = createStore(
      {
        value: 1,
        blowUp() {
          throw new Error('kaboom');
        }
      },
      { debugName: 'Counter' }
    );
    const host = bindStoreMiddleware(store);
    const events: IMiddlewareEvent<Record<string, unknown>>[] = [];
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event);
          next(event);
        });
        return {};
      }
    });
    expect(() => store.blowUp()).toThrow('kaboom');
    const actionEvents = events.filter((e) => e.type === 'action');
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'error']);
    await host.dispose();
  });

  it('actionPrefix filters out non-matching actions entirely (not even start is forwarded)', async () => {
    const store = createStore(
      {
        value: 1,
        allowedAction() {
          this.value++;
        },
        otherAction() {
          this.value++;
        }
      },
      { debugName: 'Counter' }
    );
    const host = bindStoreMiddleware(store, { actionPrefix: 'Counter.allowed' });
    const events: IMiddlewareEvent<Record<string, unknown>>[] = [];
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event);
          next(event);
        });
        return {};
      }
    });
    store.otherAction();
    expect(events.filter((e) => e.type === 'action')).toHaveLength(0);
    store.allowedAction();
    const actionEvents = events.filter((e) => e.type === 'action');
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'end']);
    await host.dispose();
  });

  it('dispose() unsubscribes both bindings: no further events after dispose, and the store itself keeps working', async () => {
    const store = createStore({ value: 1 });
    const host = bindStoreMiddleware(store);
    const events: IMiddlewareEvent<Record<string, unknown>>[] = [];
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event);
          next(event);
        });
        return {};
      }
    });
    store.value = 2;
    await Promise.resolve();
    expect(events.length).toBeGreaterThan(0);
    await host.dispose();
    events.length = 0;
    store.value = 3;
    expect(events).toHaveLength(0);
    expect(store.value).toBe(3); // store itself is unaffected by host.dispose()
  });

  it('returns the host with a readonly `.store` property pointing back at the original store', () => {
    const store = createStore({ value: 1 });
    const host = bindStoreMiddleware(store);
    expect(host.store).toBe(store);
    return host.dispose();
  });

  it('forwards a supplied mutationPolicy instance to the underlying host', () => {
    const store = createStore({ value: 1 });
    const policy = createMutationPolicy('actions-only');
    const host = bindStoreMiddleware(store, { mutationPolicy: policy });
    expect(host.mutationPolicy).toBe(policy);
    return host.dispose();
  });
});
