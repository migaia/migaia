import { describe, expect, it, vi } from 'vitest';
import { createProvisionalScope } from '../src/provisional-scope';
import { createLifecycleScope } from '../src/lifecycle-scope';
import { LifecycleErrorCode } from '../src/error-code';
import type { ILifecycleOwner } from '../src/types';

describe('L-T11 ProvisionalScope: commit', () => {
  it('transfers every resource to the parent, in registration order', async () => {
    const provisional = createProvisionalScope();
    const a = provisional.own('a', { force: vi.fn() });
    const b = provisional.own('b', { force: vi.fn() });
    const transferred: unknown[] = [];
    const parent: ILifecycleOwner = {
      own(resource) {
        transferred.push(resource);
        return resource;
      }
    };
    await provisional.commitTo(parent);
    expect(transferred).toEqual([a, b]);
  });

  it('the provisional scope does not itself release anything after a successful commit', async () => {
    const provisional = createProvisionalScope();
    const force = vi.fn();
    provisional.own('a', { force });
    const parent: ILifecycleOwner = { own: (resource) => resource };
    await provisional.commitTo(parent);
    expect(force).not.toHaveBeenCalled();
  });

  it('own() after commit throws PROVISIONAL_SETTLED', async () => {
    const provisional = createProvisionalScope();
    const parent: ILifecycleOwner = { own: (resource) => resource };
    await provisional.commitTo(parent);
    expect(() => provisional.own('late', { force: vi.fn() })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    );
  });

  it('commit works end-to-end against a real LifecycleScope parent', async () => {
    const parentScope = createLifecycleScope();
    const provisional = createProvisionalScope();
    const force = vi.fn();
    provisional.own({}, { force });
    await provisional.commitTo(parentScope);
    await parentScope.dispose();
    expect(force).toHaveBeenCalledTimes(1);
  });

  it('when the parent rejects partway, everything already transferred stays with the parent and the remainder is released by this scope, then the original error rethrows', async () => {
    const transferredToParent: string[] = [];
    const releasedByProvisional: string[] = [];
    let callCount = 0;
    const parent: ILifecycleOwner = {
      own(resource) {
        callCount++;
        if (callCount > 1) throw new Error('parent rejected');
        transferredToParent.push(resource as string);
        return resource;
      }
    };
    const provisional = createProvisionalScope();
    provisional.own('a', {
      force: () => {
        /* would go to parent */
      }
    });
    provisional.own('b', {
      force: () => {
        releasedByProvisional.push('b');
      }
    });
    provisional.own('c', {
      force: () => {
        releasedByProvisional.push('c');
      }
    });
    await expect(provisional.commitTo(parent)).rejects.toThrow('parent rejected');
    expect(transferredToParent).toEqual(['a']);
    // Cleanup is awaited before the returned Promise settles, so no extra tick is required.
    expect(releasedByProvisional.sort()).toEqual(['b', 'c']);
  });
});

describe('L-T12 ProvisionalScope: rollback/abort/expiry', () => {
  it('releases every owned resource in reverse order', async () => {
    const calls: string[] = [];
    const provisional = createProvisionalScope();
    provisional.own('a', {
      force: () => {
        calls.push('a');
      }
    });
    provisional.own('b', {
      force: () => {
        calls.push('b');
      }
    });
    await provisional.rollback();
    expect(calls).toEqual(['b', 'a']);
  });

  it('late (post-rollback) commitTo() throws and cannot own anything', async () => {
    const provisional = createProvisionalScope();
    await provisional.rollback();
    expect(() => provisional.own('x', { force: vi.fn() })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    );
    const parent: ILifecycleOwner = { own: (resource) => resource };
    expect(() => provisional.commitTo(parent)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    );
  });

  it('rollback() is idempotent', async () => {
    const force = vi.fn();
    const provisional = createProvisionalScope();
    provisional.own('a', { force });
    await provisional.rollback();
    await provisional.rollback();
    expect(force).toHaveBeenCalledTimes(1);
  });

  it('rollback() after a successful commit throws PROVISIONAL_SETTLED', async () => {
    const provisional = createProvisionalScope();
    const parent: ILifecycleOwner = { own: (resource) => resource };
    await provisional.commitTo(parent);
    await expect(provisional.rollback()).rejects.toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    );
  });

  it('cleanup errors during one rollback are all collected into a single AggregateError', async () => {
    const provisional = createProvisionalScope();
    provisional.own('a', {
      force: () => {
        throw new Error('a failed');
      }
    });
    provisional.own('b', {
      force: () => {
        throw new Error('b failed');
      }
    });
    let thrown: unknown;
    try {
      await provisional.rollback();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(2);
  });

  it('one resource failing to release does not stop the rest from being released', async () => {
    const released: string[] = [];
    const provisional = createProvisionalScope();
    provisional.own('a', {
      force: () => {
        released.push('a');
      }
    });
    provisional.own('failing', {
      force: () => {
        throw new Error('boom');
      }
    });
    provisional.own('c', {
      force: () => {
        released.push('c');
      }
    });
    try {
      await provisional.rollback();
    } catch {
      // expected
    }
    expect(released).toEqual(['c', 'a']);
  });

  it('signal aborts once rollback is triggered', async () => {
    const provisional = createProvisionalScope();
    expect(provisional.signal.aborted).toBe(false);
    await provisional.rollback();
    expect(provisional.signal.aborted).toBe(true);
  });
});

describe('L-T39 ProvisionalScope: construction-failure rollback', () => {
  it('releases part-way-allocated resources in strict reverse-of-registration order', async () => {
    const order: string[] = [];
    const provisional = createProvisionalScope();
    provisional.own('first-allocated', {
      force: () => {
        order.push('first-allocated');
      }
    });
    provisional.own('second-allocated', {
      force: () => {
        order.push('second-allocated');
      }
    });
    provisional.own('third-allocated', {
      force: () => {
        order.push('third-allocated');
      }
    });
    // Simulates: construction failed after allocating three resources; roll them all back.
    await provisional.rollback();
    expect(order).toEqual(['third-allocated', 'second-allocated', 'first-allocated']);
  });

  it("the original construction error, kept by the caller outside this scope, remains reachable and unreplaced when the caller attaches rollback's cleanup failure as a secondary cause", async () => {
    const provisional = createProvisionalScope();
    provisional.own('x', {
      force: () => {
        throw new Error('cleanup also failed');
      }
    });
    const constructionError = new Error('construction failed');
    let finalError: unknown;
    try {
      throw constructionError;
    } catch (caught) {
      try {
        await provisional.rollback();
        finalError = caught;
      } catch (cleanupError) {
        // The recommended pattern: keep the original error primary, attach cleanup failure as cause.
        finalError = new Error('construction failed; cleanup also failed', {
          cause: { primary: caught, cleanup: cleanupError }
        });
      }
    }
    expect(
      (finalError as Error & { cause: { primary: unknown; cleanup: unknown } }).cause.primary
    ).toBe(constructionError);
  });

  it('a descriptor with graceful still degrades to force during rollback, same as normal teardown', async () => {
    const force = vi.fn();
    const provisional = createProvisionalScope();
    provisional.own('x', {
      graceful: () => {
        throw new Error('graceful failed during rollback');
      },
      force
    });
    await expect(provisional.rollback()).rejects.toThrow();
    expect(force).toHaveBeenCalledTimes(1);
  });
});
