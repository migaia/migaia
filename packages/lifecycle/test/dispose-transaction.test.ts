import { describe, expect, it, vi } from 'vitest';
import { createDisposeTransaction, executeReleaseDescriptor } from '../src/dispose-transaction';
import { systemScheduler } from '../src/scheduler.js';
import type { IReleaseContext, IReleaseDescriptor } from '../src/types';

const baseContext = (overrides: Partial<IReleaseContext> = {}): IReleaseContext => ({
  signal: new AbortController().signal,
  deadlineAt: undefined,
  report: vi.fn(),
  ...overrides
});

describe('L-T21 custom escape hatch', () => {
  it('skips graceful and force entirely when custom is present', async () => {
    const graceful = vi.fn();
    const force = vi.fn();
    const custom = vi.fn();
    const descriptor: IReleaseDescriptor = { graceful, force, custom };
    await executeReleaseDescriptor(descriptor, baseContext());
    expect(custom).toHaveBeenCalledTimes(1);
    expect(graceful).not.toHaveBeenCalled();
    expect(force).not.toHaveBeenCalled();
  });

  it("custom's error is returned and attributed to this item", async () => {
    const error = new Error('custom failed');
    const descriptor: IReleaseDescriptor = {
      force: vi.fn(),
      custom: () => {
        throw error;
      }
    };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(errors).toEqual([error]);
  });

  it('an async custom() is awaited', async () => {
    let resolved = false;
    const descriptor: IReleaseDescriptor = {
      force: vi.fn(),
      custom: async () => {
        await Promise.resolve();
        resolved = true;
      }
    };
    await executeReleaseDescriptor(descriptor, baseContext());
    expect(resolved).toBe(true);
  });
});

describe('L-T22 graceful success stops the chain', () => {
  it('does not call force after graceful succeeds', async () => {
    const force = vi.fn();
    const descriptor: IReleaseDescriptor = { graceful: async () => undefined, force };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(errors).toEqual([]);
    expect(force).not.toHaveBeenCalled();
  });

  it('a synchronous (non-thenable) graceful return also counts as success', async () => {
    const force = vi.fn();
    const descriptor: IReleaseDescriptor = { graceful: () => undefined, force };
    await executeReleaseDescriptor(descriptor, baseContext());
    expect(force).not.toHaveBeenCalled();
  });

  it('graceful and force share the same context object (deadline/signal/report)', async () => {
    let gracefulContext: IReleaseContext | undefined;
    const context = baseContext();
    const descriptor: IReleaseDescriptor = {
      graceful: async (c) => {
        gracefulContext = c;
      },
      force: vi.fn()
    };
    await executeReleaseDescriptor(descriptor, context);
    expect(gracefulContext).toBe(context);
  });
});

describe('L-T23 graceful timeout abandons waiting without cancelling it, then runs force', () => {
  it('proceeds to force once the deadline passes, without recording a graceful error', async () => {
    vi.useFakeTimers();
    try {
      let gracefulSettled = false;
      const graceful = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            gracefulSettled = true;
            resolve();
          }, 10_000);
        });
      const force = vi.fn();
      const descriptor: IReleaseDescriptor = { graceful, gracefulTimeoutMs: 100, force };
      const promise = executeReleaseDescriptor(descriptor, baseContext());
      await vi.advanceTimersByTimeAsync(101);
      const errors = await promise;
      expect(errors).toEqual([]); // timeout is silent, not recorded as an item error
      expect(force).toHaveBeenCalledTimes(1);
      expect(gracefulSettled).toBe(false); // graceful was not cancelled, just abandoned
    } finally {
      vi.useRealTimers();
    }
  });

  it('the graceful call keeps running in the background after abandonment (not cancelled)', async () => {
    vi.useFakeTimers();
    try {
      let gracefulResolved = false;
      const graceful = () =>
        new Promise<void>((resolve) => setTimeout(() => resolve(), 5000)).then(() => {
          gracefulResolved = true;
        });
      const descriptor: IReleaseDescriptor = { graceful, gracefulTimeoutMs: 100, force: vi.fn() };
      const promise = executeReleaseDescriptor(descriptor, baseContext());
      await vi.advanceTimersByTimeAsync(101);
      await promise;
      expect(gracefulResolved).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(gracefulResolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('L-T24 graceful throwing still runs force', () => {
  it('records the graceful error and still calls force', async () => {
    const gracefulError = new Error('graceful failed');
    const force = vi.fn();
    const descriptor: IReleaseDescriptor = {
      graceful: () => {
        throw gracefulError;
      },
      force
    };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(force).toHaveBeenCalledTimes(1);
    expect(errors).toContain(gracefulError);
  });

  it('an async graceful rejection also still runs force and is recorded', async () => {
    const gracefulError = new Error('async graceful failed');
    const force = vi.fn();
    const descriptor: IReleaseDescriptor = {
      graceful: async () => {
        throw gracefulError;
      },
      force
    };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(force).toHaveBeenCalledTimes(1);
    expect(errors).toContain(gracefulError);
  });
});

describe('L-T25 force errors flow to the policy outcome without dangling rejections', () => {
  it("force's error is returned for the caller to fold into the policy sink", async () => {
    const forceError = new Error('force failed');
    const descriptor: IReleaseDescriptor = {
      force: () => {
        throw forceError;
      }
    };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(errors).toEqual([forceError]);
  });

  it('an async force rejection is caught, not left as an unhandled rejection', async () => {
    const descriptor: IReleaseDescriptor = {
      force: async () => Promise.reject(new Error('async force failed'))
    };
    const errors = await executeReleaseDescriptor(descriptor, baseContext());
    expect(errors).toHaveLength(1);
  });

  it('a transaction still reaches its finalize step (terminal) even when force fails, under collect policy', async () => {
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'collect' });
    const result = await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: () => {
            throw new Error('force failed');
          }
        }
      }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('a');
  });
});

describe('L-T26 IReleaseContext: report and signal', () => {
  it('report is invoked and a reporter throw is contained', async () => {
    const reportSpy = vi.fn(() => {
      throw new Error('reporter exploded');
    });
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', report: reportSpy }
    );
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (context) => {
            context.report('diagnostic, non-fatal');
          }
        }
      }
    ]);
    expect(reportSpy).toHaveBeenCalledWith('diagnostic, non-fatal');
  });

  it('the closing signal reflects an already-aborted external signal for every item', async () => {
    const external = new AbortController();
    external.abort('closing');
    const seenAborted: boolean[] = [];
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', signal: external.signal }
    );
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted);
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted);
          }
        }
      }
    ]);
    expect(seenAborted).toEqual([true, true]);
  });

  it('a signal that aborts mid-run is observable by later items', async () => {
    const external = new AbortController();
    const seenAborted: boolean[] = [];
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', signal: external.signal }
    );
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted);
            external.abort('mid-run');
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted);
          }
        }
      }
    ]);
    expect(seenAborted).toEqual([false, true]);
  });
});

describe('L-T14 DisposeTransaction: order mode', () => {
  it('groups by descending order, releasing higher-order items first', async () => {
    const calls: string[] = [];
    const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy: 'throw' });
    await transaction.run([
      {
        source: 'low',
        descriptor: {
          order: 0,
          force: () => {
            calls.push('low');
          }
        }
      },
      {
        source: 'high',
        descriptor: {
          order: 10,
          force: () => {
            calls.push('high');
          }
        }
      },
      {
        source: 'mid',
        descriptor: {
          order: 5,
          force: () => {
            calls.push('mid');
          }
        }
      }
    ]);
    expect(calls).toEqual(['high', 'mid', 'low']);
  });

  it('items with equal (or omitted) order keep the caller-supplied relative sequence (LIFO input)', async () => {
    const calls: string[] = [];
    const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy: 'throw' });
    await transaction.run([
      {
        source: 'first-given',
        descriptor: {
          force: () => {
            calls.push('first-given');
          }
        }
      },
      {
        source: 'second-given',
        descriptor: {
          force: () => {
            calls.push('second-given');
          }
        }
      }
    ]);
    expect(calls).toEqual(['first-given', 'second-given']);
  });

  it('a transaction created for order mode shares one absolute deadline across items', async () => {
    const deadlineAt = systemScheduler.now() + 100_000;
    const seenDeadlines: (number | undefined)[] = [];
    const transaction = createDisposeTransaction(
      { kind: 'order' },
      { errorPolicy: 'throw', deadlineAt }
    );
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenDeadlines.push(c.deadlineAt);
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenDeadlines.push(c.deadlineAt);
          }
        }
      }
    ]);
    expect(seenDeadlines).toEqual([deadlineAt, deadlineAt]);
  });
});

describe('L-T15 DisposeTransaction: ordered-plan mode', () => {
  it('executes items strictly in the given sequence', async () => {
    const calls: string[] = [];
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'throw' });
    await transaction.run([
      {
        source: 'first',
        descriptor: {
          order: -100,
          force: () => {
            calls.push('first');
          }
        }
      },
      {
        source: 'second',
        descriptor: {
          order: 100,
          force: () => {
            calls.push('second');
          }
        }
      },
      {
        source: 'third',
        descriptor: {
          order: 0,
          force: () => {
            calls.push('third');
          }
        }
      }
    ]);
    // `order` values would reorder this in `order` mode; `plan` mode must ignore them entirely.
    expect(calls).toEqual(['first', 'second', 'third']);
  });
});

describe('L-T32 DisposeTransaction: shared deadline across steps, not reset per step', () => {
  it('the same absolute deadlineAt value is handed to every item, unchanged', async () => {
    const deadlineAt = systemScheduler.now() + 50_000;
    const observed: (number | undefined)[] = [];
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'throw', deadlineAt }
    );
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: async (c) => {
            observed.push(c.deadlineAt);
            await Promise.resolve();
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            observed.push(c.deadlineAt);
          }
        }
      },
      {
        source: 'c',
        descriptor: {
          force: (c) => {
            observed.push(c.deadlineAt);
          }
        }
      }
    ]);
    expect(observed).toEqual([deadlineAt, deadlineAt, deadlineAt]);
  });

  it("a graceful phase's own timeout is capped by whatever remains of the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const start = systemScheduler.now();
      const deadlineAt = start + 50; // very little budget remains
      const force = vi.fn();
      const graceful = () => new Promise<void>(() => {}); // never settles on its own
      const transaction = createDisposeTransaction(
        { kind: 'plan' },
        { errorPolicy: 'collect', deadlineAt }
      );
      const promise = transaction.run([
        { source: 'a', descriptor: { graceful, gracefulTimeoutMs: 10_000, force } }
      ]);
      // Even though gracefulTimeoutMs asked for 10s, the shared deadline (50ms out) governs.
      await vi.advanceTimersByTimeAsync(60);
      await promise;
      expect(force).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
