import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { claimOwnership } from '@migaia/reactive/ownership';
import { createStoreRegistry, createStoreToken, StoreRegistry } from '../src/provider-registry';

describe('createStoreToken', () => {
  it('throws when given an empty debug name', () => {
    expect(() => createStoreToken('')).toThrow('[store] IStoreToken requires a debug name');
  });

  it('produces a frozen token carrying the debug name', () => {
    const token = createStoreToken<number>('count');
    expect(token.debugName).toBe('count');
    expect(Object.isFrozen(token)).toBe(true);
  });
});

describe('StoreRegistry register/replace/get/require/has/remove', () => {
  it('registers a value and reads it back via get/require/has', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('count');
    registry.register(token, 1);

    expect(registry.has(token)).toBe(true);
    expect(registry.get(token)).toBe(1);
    expect(registry.require(token)).toBe(1);
    registry.dispose();
  });

  it('require() throws a descriptive error for a token that was never registered', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('missing-count');
    expect(() => registry.require(token)).toThrow('[store] missing provider store: missing-count');
    registry.dispose();
  });

  it('get() returns undefined and has() returns false for an unregistered token', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('count');
    expect(registry.get(token)).toBeUndefined();
    expect(registry.has(token)).toBe(false);
    registry.dispose();
  });

  it('rejects a duplicate registration of the same token', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('count');
    registry.register(token, 1);
    expect(() => registry.register(token, 2)).toThrow(
      '[store] duplicate provider store token: count'
    );
    registry.dispose();
  });

  it('register() returns an idempotent disposer that only removes the entry once', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('count');
    const unregister = registry.register(token, 1);

    unregister();
    expect(registry.has(token)).toBe(false);

    // Re-register under the same token to prove the first disposer is now inert.
    registry.register(token, 2);
    unregister();
    expect(registry.get(token)).toBe(2);
    registry.dispose();
  });

  it('owned registration disposes the value when the returned disposer runs', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<{ dispose(): void }>('owned');
    const dispose = vi.fn();
    const unregister = registry.register(token, { dispose }, { owned: true });

    unregister();
    expect(dispose).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it('non-owned registration never calls dispose on removal', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<{ dispose(): void }>('unowned');
    const dispose = vi.fn();
    registry.register(token, { dispose });

    registry.remove(token);
    expect(dispose).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('replace() disposes the previous owned value when the reference changes', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<{ dispose(): void }>('swap');
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    registry.register(token, { dispose: disposeA }, { owned: true });

    registry.replace(token, { dispose: disposeB }, { owned: true });
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).not.toHaveBeenCalled();
    expect(registry.get(token)?.dispose).toBe(disposeB);
    registry.dispose();
  });

  it('replace() does not dispose the previous value when the reference is unchanged', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<{ dispose(): void }>('same');
    const dispose = vi.fn();
    const value = { dispose };
    registry.register(token, value, { owned: true });

    registry.replace(token, value, { owned: true });
    expect(dispose).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('remove() with disposeOwned=false skips disposal but still removes the entry', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<{ dispose(): void }>('kept-alive');
    const dispose = vi.fn();
    registry.register(token, { dispose }, { owned: true });

    const removed = registry.remove(token, false);
    expect(removed).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    expect(registry.has(token)).toBe(false);
    registry.dispose();
  });

  it('remove() returns false for a token that is not registered', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('absent');
    expect(registry.remove(token)).toBe(false);
    registry.dispose();
  });

  it('rejects registering/replacing a value owned by a different Runtime', () => {
    const runtimeA = createRuntime();
    const runtimeB = createRuntime();
    const registry = new StoreRegistry(runtimeA);
    const token = createStoreToken<object>('foreign');
    const foreignValue = {};
    claimOwnership(foreignValue, runtimeB);

    expect(() => registry.register(token, foreignValue)).toThrow(
      '[store] provider store "foreign" belongs to a different Runtime'
    );

    // Also enforced on replace().
    registry.register(token, {});
    expect(() => registry.replace(token, foreignValue)).toThrow(
      '[store] provider store "foreign" belongs to a different Runtime'
    );
    registry.dispose();
  });

  it('allows registering a value with no declared owner (untracked plain value)', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<object>('plain');
    expect(() => registry.register(token, {})).not.toThrow();
    registry.dispose();
  });
});

describe('StoreRegistry disposed-state guards', () => {
  it('rejects register/replace/get/require/has/remove after dispose()', () => {
    const registry = createStoreRegistry();
    const token = createStoreToken<number>('count');
    registry.dispose();

    expect(registry.disposed).toBe(true);
    expect(() => registry.register(token, 1)).toThrow('[store] provider registry is disposed');
    expect(() => registry.replace(token, 1)).toThrow('[store] provider registry is disposed');
    expect(() => registry.get(token)).toThrow('[store] provider registry is disposed');
    expect(() => registry.require(token)).toThrow('[store] provider registry is disposed');
    expect(() => registry.has(token)).toThrow('[store] provider registry is disposed');
    expect(() => registry.remove(token)).toThrow('[store] provider registry is disposed');
  });

  it('dispose() is idempotent', () => {
    const registry = createStoreRegistry();
    registry.dispose();
    expect(() => registry.dispose()).not.toThrow();
  });
});

describe('StoreRegistry.dispose() ordering and error aggregation', () => {
  it('disposes owned entities in reverse registration order', () => {
    const registry = createStoreRegistry();
    const order: string[] = [];
    registry.register(
      createStoreToken('first'),
      { dispose: () => order.push('first') },
      { owned: true }
    );
    registry.register(
      createStoreToken('second'),
      { dispose: () => order.push('second') },
      { owned: true }
    );
    registry.register(
      createStoreToken('third'),
      { dispose: () => order.push('third') },
      { owned: true }
    );

    registry.dispose();
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('rethrows a single owned-entity disposal error directly (not wrapped)', () => {
    const registry = createStoreRegistry();
    const boom = new Error('dispose failed');
    registry.register(
      createStoreToken('bad'),
      {
        dispose: () => {
          throw boom;
        }
      },
      { owned: true }
    );

    expect(() => registry.dispose()).toThrow(boom);
  });

  it('wraps multiple owned-entity disposal errors in an AggregateError', () => {
    const registry = createStoreRegistry();
    registry.register(
      createStoreToken('bad1'),
      {
        dispose: () => {
          throw new Error('one');
        }
      },
      { owned: true }
    );
    registry.register(
      createStoreToken('bad2'),
      {
        dispose: () => {
          throw new Error('two');
        }
      },
      { owned: true }
    );

    try {
      registry.dispose();
      expect.unreachable('dispose() should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).message).toBe('[store] provider registry disposal failed');
      expect((error as AggregateError).errors).toHaveLength(2);
    }
  });

  it('never disposes a non-owned entity even though it participates in registration order', () => {
    const registry = createStoreRegistry();
    const dispose = vi.fn();
    registry.register(createStoreToken('unowned'), { dispose });
    registry.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('does not block on a thenable disposer result and reports rejection via runtime.reportError', async () => {
    const runtime = createRuntime();
    const reportError = vi.spyOn(runtime, 'reportError');
    const registry = new StoreRegistry(runtime);
    const boom = new Error('async dispose failed');
    let releaseReject: (() => void) | undefined;
    const pending = new Promise<void>((_resolve, reject) => {
      releaseReject = () => reject(boom);
    });
    registry.register(createStoreToken('async-bad'), { dispose: () => pending }, { owned: true });

    expect(() => registry.dispose()).not.toThrow();
    releaseReject!();
    await vi.waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(boom, { phase: 'lifecycle-hook' })
    );
  });
});

describe('StoreRegistry.disposeAsync()', () => {
  it('awaits thenable disposer results before resolving', async () => {
    const registry = createStoreRegistry();
    let released = false;
    registry.register(
      createStoreToken('slow'),
      {
        dispose: () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              released = true;
              resolve();
            }, 0)
          )
      },
      { owned: true }
    );

    await registry.disposeAsync();
    expect(released).toBe(true);
  });

  it('is single-flight: concurrent calls share the same in-flight completion', async () => {
    const registry = createStoreRegistry();
    const disposeCalls: number[] = [];
    registry.register(
      createStoreToken('once'),
      {
        dispose: () =>
          new Promise<void>((resolve) => {
            disposeCalls.push(1);
            setTimeout(resolve, 0);
          })
      },
      { owned: true }
    );

    const [a, b] = await Promise.all([registry.disposeAsync(), registry.disposeAsync()]);
    expect(a).toBe(b);
    expect(disposeCalls).toHaveLength(1);
  });

  it('resolves immediately for an already-terminal registry', async () => {
    const registry = createStoreRegistry();
    registry.dispose();
    await expect(registry.disposeAsync()).resolves.toBeUndefined();
  });

  it('after a prior sync dispose(), waits for disposers still in flight instead of resolving early', async () => {
    const registry = createStoreRegistry();
    let resolvePending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    registry.register(createStoreToken('lingering'), { dispose: () => pending }, { owned: true });

    registry.dispose(); // synchronous: starts but cannot await the thenable disposer

    let settled = false;
    const asyncDone = registry.disposeAsync().then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on the lingering disposer

    resolvePending!();
    await asyncDone;
    expect(settled).toBe(true);
  });
});

describe('StoreRegistry lifecycle: whenTerminal()/retain()/prepareForRender() (StrictMode-safe candidate reclamation)', () => {
  it('whenTerminal() resolves once dispose() completes synchronously', async () => {
    const registry = createStoreRegistry();
    let resolved = false;
    void registry.whenTerminal().then(() => {
      resolved = true;
    });
    registry.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('retain() releases and disposes the registry once retainCount reaches zero (microtask-deferred)', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      const release = registry.retain(true);
      release();

      expect(registry.disposed).toBe(false); // dispose is deferred to a microtask
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retain() does not dispose when disposeOnRelease is false', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      const release = registry.retain(false);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(false);
    } finally {
      vi.useRealTimers();
      createStoreRegistry(); // no-op to keep symmetry; real dispose not required for GC in tests
    }
  });

  it('StrictMode probe: a retain() that arrives before the deferred release-check fires prevents disposal', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      const releaseFirst = registry.retain(true); // simulated initial mount
      releaseFirst(); // simulated StrictMode unmount probe
      registry.retain(true); // simulated StrictMode remount, before the microtask runs

      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retain()s release disposer is idempotent (second call is a no-op)', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      const release = registry.retain(true);
      release();
      release(); // must not double-decrement retainCount or double-schedule disposal
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prepareForRender() with no barrier disposes an unretained candidate on the next tick', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      registry.prepareForRender();
      expect(registry.disposed).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prepareForRender() never disposes a candidate that was retained (i.e. actually committed)', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      registry.prepareForRender();
      registry.retain(true); // simulates React committing the render before the check fires
      await vi.advanceTimersByTimeAsync(0);
      expect(registry.disposed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prepareForRender() is a no-op once the registry is already disposed', () => {
    const registry = createStoreRegistry();
    registry.dispose();
    expect(() => registry.prepareForRender()).not.toThrow();
  });

  it('prepareForRender(after) arms a bounded fallback timer independent of "after" ever settling', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      const neverSettles = new Promise<void>(() => {});
      registry.prepareForRender(neverSettles);

      // Before the documented ABANDONED_RENDER_FALLBACK_MS bound, nothing happens yet.
      await vi.advanceTimersByTimeAsync(3999);
      expect(registry.disposed).toBe(false);

      // At the bound, the candidate is reclaimed even though `after` never resolved.
      await vi.advanceTimersByTimeAsync(2);
      expect(registry.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prepareForRender(after) arms a fast recheck shortly after "after" settles', async () => {
    vi.useFakeTimers();
    try {
      const registry = createStoreRegistry();
      let resolveAfter: (() => void) | undefined;
      const after = new Promise<void>((resolve) => {
        resolveAfter = resolve;
      });
      registry.prepareForRender(after);

      resolveAfter!();
      await vi.advanceTimersByTimeAsync(0); // let the .then() microtask arm the fast-path timer
      expect(registry.disposed).toBe(false);
      await vi.advanceTimersByTimeAsync(16);
      expect(registry.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
