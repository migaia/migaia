import { describe, expect, it, vi } from 'vitest';
import { createLifecycleScope } from '../src/lifecycle-scope';
import { LifecycleErrorCode } from '../src/error-code';
import type { IReleaseDescriptor } from '../src/types';

const forceDescriptor = (force: IReleaseDescriptor['force']): IReleaseDescriptor => ({ force });

describe('L-T2 LifecycleScope: own/release/dispose', () => {
  it('release() unregisters a resource without releasing it', async () => {
    const force = vi.fn();
    const scope = createLifecycleScope();
    const resource = scope.own({}, forceDescriptor(force));
    expect(scope.release(resource)).toBe(true);
    await scope.dispose();
    expect(force).not.toHaveBeenCalled();
  });

  it('release() returns false for an unknown resource', () => {
    const scope = createLifecycleScope();
    expect(scope.release({})).toBe(false);
  });

  it('close()-then-dispose(): resources present at close() are released in reverse order (snapshot)', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope();
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'b',
      forceDescriptor(() => {
        calls.push('b');
      })
    );
    await scope.dispose();
    expect(calls).toEqual(['b', 'a']);
  });

  it('own() during closing/terminal throws and does not add a new resource', async () => {
    const scope = createLifecycleScope();
    scope.own(
      'a',
      forceDescriptor(() => {})
    );
    const disposePromise = scope.dispose();
    expect(() =>
      scope.own(
        'b',
        forceDescriptor(() => {})
      )
    ).toThrowError(expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantOwn }));
    await disposePromise;
    expect(() =>
      scope.own(
        'c',
        forceDescriptor(() => {})
      )
    ).toThrowError(expect.objectContaining({ code: LifecycleErrorCode.scopeTerminal }));
  });
});

describe('L-T3 LifecycleScope: sync/async reentrancy', () => {
  it('a synchronous disposer that reentrantly calls dispose() is rejected, error attributed to it, rest continues', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'reentrant',
      forceDescriptor(() => {
        expect(() => scope.dispose()).toThrowError(
          expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantDispose })
        );
        calls.push('reentrant-caught-locally');
      })
    );
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c');
      })
    );
    const errors = await scope.dispose();
    expect(calls).toEqual(['c', 'reentrant-caught-locally', 'a']);
    // The reentrant scope.dispose() call was caught locally by this test's own try, so it never
    // reaches the sink — that's fine, this proves attribution via normal call-stack propagation
    // when the disposer does NOT itself catch it (see next test).
    expect(errors).toEqual([]);
  });

  it('an uncaught reentrant dispose() from within a disposer is attributed to that disposer, others continue', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'reentrant',
      forceDescriptor(() => {
        calls.push('reentrant');
        scope.dispose(); // not caught here — propagates up through this disposer's own execution
      })
    );
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c');
      })
    );
    const errors = await scope.dispose();
    expect(calls).toEqual(['c', 'reentrant', 'a']);
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as { code: string }).code).toBe(
      LifecycleErrorCode.scopeReentrantDispose
    );
    expect(errors[0]!.source).toBeDefined();
  });

  it('an async disposer that reentrantly calls dispose() from its continuation is also rejected', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own('async-reentrant', {
      force: async () => {
        await Promise.resolve();
        calls.push('async-reentrant');
        scope.dispose();
      }
    });
    const errors = await scope.dispose();
    expect(calls).toEqual(['async-reentrant', 'a']);
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as { code: string }).code).toBe(
      LifecycleErrorCode.scopeReentrantDispose
    );
  });

  it('own() from within a disposer is rejected the same way (L-T37 shares this mechanism)', async () => {
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'x',
      forceDescriptor(() => {
        scope.own(
          'late',
          forceDescriptor(() => {})
        );
      })
    );
    const errors = await scope.dispose();
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeReentrantOwn);
  });
});

describe('L-T19 GC fallback', () => {
  it('explicit release() unregisters so the finalizer never runs afterward', async () => {
    if (typeof FinalizationRegistry === 'undefined') return; // environment without GC hooks
    const force = vi.fn();
    const scope = createLifecycleScope();
    const resource = scope.own({}, { force, gcFallback: true });
    scope.release(resource);
    await scope.dispose();
    expect(force).not.toHaveBeenCalled();
  });

  it('normal dispose() also unregisters the GC fallback before releasing, so it never double-fires', async () => {
    if (typeof FinalizationRegistry === 'undefined') return;
    let callCount = 0;
    const scope = createLifecycleScope();
    scope.own(
      {},
      {
        force: () => {
          callCount++;
        },
        gcFallback: true
      }
    );
    await scope.dispose();
    expect(callCount).toBe(1);
  });

  it('the held value passed to the registry does not reference the target resource directly', () => {
    if (typeof FinalizationRegistry === 'undefined') return;
    const registerSpy = vi.spyOn(FinalizationRegistry.prototype, 'register');
    const scope = createLifecycleScope();
    const resource: Record<string, unknown> = {};
    scope.own(resource, { force: () => {}, gcFallback: true });
    expect(registerSpy).toHaveBeenCalled();
    const [target, heldValue] = registerSpy.mock.calls.at(-1)!;
    expect(target).toBe(resource);
    expect(heldValue).not.toBe(resource);
    expect(typeof heldValue).toBe('function');
    registerSpy.mockRestore();
  });
});

describe('L-T27 close() never calls user code', () => {
  it('close() does not invoke any disposer, graceful, force, or custom callback', () => {
    const force = vi.fn();
    const graceful = vi.fn();
    const custom = vi.fn();
    const scope = createLifecycleScope();
    scope.own('a', { force });
    scope.own('b', { graceful, force: vi.fn() });
    scope.own('c', { force: vi.fn(), custom });
    scope.close();
    expect(force).not.toHaveBeenCalled();
    expect(graceful).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
  });

  it('close() only changes container state and is synchronous', () => {
    const scope = createLifecycleScope();
    expect(scope.lifecycle).toBe('open');
    const result = scope.close();
    expect(result).toBeUndefined();
    expect(scope.lifecycle).toBe('closing');
  });

  it('close() cascades: after close(), the scope no longer accepts new own()', () => {
    const scope = createLifecycleScope();
    scope.close();
    expect(() =>
      scope.own(
        'x',
        forceDescriptor(() => {})
      )
    ).toThrow();
  });
});

describe('L-T28 dispose() implies close() first', () => {
  it('dispose() moves through closing before any user code runs, never open -> terminal directly', async () => {
    const observedStates: string[] = [];
    const scope = createLifecycleScope();
    scope.own(
      'x',
      forceDescriptor(() => {
        observedStates.push(scope.lifecycle);
      })
    );
    expect(scope.lifecycle).toBe('open');
    const disposePromise = scope.dispose();
    // Synchronously after calling dispose(), close() has already run.
    expect(scope.lifecycle).toBe('closing');
    await disposePromise;
    expect(observedStates).toEqual(['closing']);
    expect(scope.lifecycle).toBe('terminal');
  });
});

describe('L-T29 dispose() promise identity', () => {
  it('concurrent, non-reentrant dispose() calls on an idle (empty) scope reuse the same promise', () => {
    // With nothing owned, the teardown loop never runs, so `currentlyReleasing` never becomes
    // true — this is the unambiguous case where two calls are provably not reentrant with respect
    // to any disposer, and both must observe the exact same promise.
    const scope = createLifecycleScope();
    const p1 = scope.dispose();
    const p2 = scope.dispose();
    expect(p1).toBe(p2);
  });

  it('a caller that only learns about an in-flight dispose() after it has fully settled reuses the resolved outcome', async () => {
    let callCount = 0;
    const scope = createLifecycleScope();
    scope.own(
      'x',
      forceDescriptor(async () => {
        callCount++;
        await Promise.resolve();
      })
    );
    const first = await scope.dispose();
    const second = await scope.dispose();
    expect(callCount).toBe(1);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it('user release code for one resource runs exactly once even under a synchronous double dispose() attempt', async () => {
    // The second, synchronous call lands while the first item's release is actively in flight —
    // by design this is treated as (indistinguishable from) reentrancy and rejected rather than
    // silently joining, so release code can never run twice no matter which branch is taken.
    let callCount = 0;
    const scope = createLifecycleScope();
    scope.own(
      'x',
      forceDescriptor(async () => {
        callCount++;
        await Promise.resolve();
      })
    );
    const p1 = scope.dispose();
    expect(() => scope.dispose()).toThrow();
    await p1;
    expect(callCount).toBe(1);
  });

  it('dispose() after terminal resolves to an empty array', async () => {
    const scope = createLifecycleScope();
    await scope.dispose();
    const after = await scope.dispose();
    expect(after).toEqual([]);
  });
});

describe('L-T33 LifecycleScope: atomic splice-then-reverse teardown', () => {
  it('every registered resource is released exactly once, in LIFO order', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope();
    for (const label of ['a', 'b', 'c', 'd']) {
      scope.own(
        label,
        forceDescriptor(() => {
          calls.push(label);
        })
      );
    }
    await scope.dispose();
    expect(calls).toEqual(['d', 'c', 'b', 'a']);
  });

  it('own() during the release loop (reentrant) does not corrupt the in-progress snapshot for other items', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'mid',
      forceDescriptor(() => {
        calls.push('mid');
        try {
          scope.own(
            'late',
            forceDescriptor(() => {})
          );
        } catch {
          // rejected — expected, does not disturb the ongoing snapshot iteration
        }
      })
    );
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c');
      })
    );
    await scope.dispose();
    expect(calls).toEqual(['c', 'mid', 'a']);
  });
});

describe('L-T34 (LifecycleScope aspect): failed release does not stop remaining resources', () => {
  it('a force() throw for one resource does not prevent the rest from releasing', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'failing',
      forceDescriptor(() => {
        calls.push('failing');
        throw new Error('boom');
      })
    );
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c');
      })
    );
    const errors = await scope.dispose();
    expect(calls).toEqual(['c', 'failing', 'a']);
    expect(errors).toHaveLength(1);
  });
});

describe('L-T36 dispose() calling close() has no effect and does not throw', () => {
  it('close() invoked from within a disposer during dispose() is a harmless no-op', async () => {
    const scope = createLifecycleScope();
    let closeThrew = false;
    scope.own(
      'x',
      forceDescriptor(() => {
        try {
          scope.close();
        } catch {
          closeThrew = true;
        }
      })
    );
    await scope.dispose();
    expect(closeThrew).toBe(false);
    expect(scope.lifecycle).toBe('terminal');
  });

  it('the original shutdown/dispose transaction continues normally after an internal close() call', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope();
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'closer',
      forceDescriptor(() => {
        scope.close();
        calls.push('closer');
      })
    );
    await scope.dispose();
    expect(calls).toEqual(['closer', 'a']);
  });
});

describe('L-T37 own() inside a disposer throws immediately, rest still releases', () => {
  it('the own()-caller’s error is attributed to that disposer under collect policy', async () => {
    const calls: string[] = [];
    const scope = createLifecycleScope({ errorPolicy: 'collect' });
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a');
      })
    );
    scope.own(
      'owner',
      forceDescriptor(() => {
        calls.push('owner');
        scope.own(
          'too-late',
          forceDescriptor(() => {})
        );
      })
    );
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c');
      })
    );
    const errors = await scope.dispose();
    expect(calls).toEqual(['c', 'owner', 'a']);
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeReentrantOwn);
  });
});
