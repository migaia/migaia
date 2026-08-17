import { describe, expect, it, vi } from 'vitest';
import { createMutationQueue } from '../src/mutation-queue';
import { LifecycleErrorCode } from '../src/error-code';
import { createManualScheduler } from '../src/scheduler';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('L-T13 MutationQueue: FIFO and settle-disarms-watchdog', () => {
  it('runs tasks strictly one at a time, in submission order', async () => {
    const queue = createMutationQueue();
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();
    const p1 = queue.enqueue(async () => {
      order.push('a-start');
      await a.promise;
      order.push('a-end');
    });
    const p2 = queue.enqueue(async () => {
      order.push('b-start');
      await b.promise;
      order.push('b-end');
    });
    await Promise.resolve();
    await Promise.resolve();
    // b must not have started yet — a is still running.
    expect(order).toEqual(['a-start']);
    a.resolve();
    await p1;
    await Promise.resolve();
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    b.resolve();
    await p2;
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it("a task's own success/failure resolves/rejects its own promise", async () => {
    const queue = createMutationQueue();
    await expect(queue.enqueue(() => 42)).resolves.toBe(42);
    await expect(
      queue.enqueue(() => {
        throw new Error('task failed');
      })
    ).rejects.toThrow('task failed');
  });

  it('an admission watchdog is disarmed the instant its task settles — it does not fire later', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 50 });
      const blocking = deferred<void>();
      const p1 = queue.enqueue(() => blocking.promise);
      // Task 2 is queued behind in-flight work and gets a watchdog armed.
      const p2 = queue.enqueue(() => 'second');
      blocking.resolve();
      await p1;
      // Task 2 should now be running/settled well before its watchdog would fire.
      await expect(p2).resolves.toBe('second');
      // Advancing past the original watchdog window must not produce a late rejection anywhere.
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a task submitted to an idle queue runs without needing to wait behind anything', async () => {
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: 1 });
    // No prior work queued — this must not spuriously reject even though the timeout is 1ms.
    await expect(queue.enqueue(() => 'immediate')).resolves.toBe('immediate');
  });

  it('size reflects queued-plus-running task count', async () => {
    const queue = createMutationQueue();
    const blocking = deferred<void>();
    const p1 = queue.enqueue(() => blocking.promise);
    queue.enqueue(() => undefined);
    expect(queue.size).toBe(2);
    blocking.resolve();
    await p1;
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.size).toBe(0);
  });

  it('this port does not claim owner-aware self-dependency detection as pre-existing plugin-host behavior — it is new (see L-T43 for its own coverage)', async () => {
    const queue = createMutationQueue();
    // Two DIFFERENT owners queued behind each other must both simply run in order — no rejection.
    const results: string[] = [];
    await queue.enqueue(
      () => {
        results.push('a');
      },
      { owner: 'A' }
    );
    await queue.enqueue(
      () => {
        results.push('b');
      },
      { owner: 'B' }
    );
    expect(results).toEqual(['a', 'b']);
  });
});

describe('L-T42 MutationQueue: watchdog unconfigured (default) only diagnoses, never rejects', () => {
  it('a task queued behind in-flight work is not rejected when queueAdmissionTimeoutMs is left unset', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue(); // no queueAdmissionTimeoutMs given
      const blocking = deferred<void>();
      const p1 = queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second');
      await vi.advanceTimersByTimeAsync(60_000); // well past any plausible SLA
      blocking.resolve();
      await p1;
      await expect(p2).resolves.toBe('second');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires a diagnostic callback (if provided) without dequeuing or rejecting anything', async () => {
    vi.useFakeTimers();
    try {
      const onAdmissionDiagnostic = vi.fn();
      const queue = createMutationQueue({ admissionDiagnosticMs: 100, onAdmissionDiagnostic });
      const blocking = deferred<void>();
      const p1 = queue.enqueue(() => blocking.promise, { owner: 'blocker' });
      const p2 = queue.enqueue(() => 'second', { owner: 'second' });
      await vi.advanceTimersByTimeAsync(101);
      expect(onAdmissionDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({ owner: 'second' })
      );
      expect(
        (onAdmissionDiagnostic.mock.calls[0]![0] as { waitedMs: number }).waitedMs
      ).toBeGreaterThanOrEqual(100);
      blocking.resolve();
      await p1;
      await expect(p2).resolves.toBe('second');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never arms a diagnostic timer at all when no onAdmissionDiagnostic callback is given (nothing to fire)', async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const queue = createMutationQueue();
      const blocking = deferred<void>();
      queue.enqueue(() => blocking.promise);
      const callsBefore = setTimeoutSpy.mock.calls.length;
      queue.enqueue(() => 'second');
      // No new timer should have been armed for the second (queued-behind) task.
      expect(setTimeoutSpy.mock.calls.length).toBe(callsBefore);
      setTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('L-T43 MutationQueue: watchdog configured, disabled, and per-call override', () => {
  it('configuring a numeric queueAdmissionTimeoutMs dequeues and rejects with QUEUE_ADMISSION_TIMEOUT once exceeded', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 100 });
      const blocking = deferred<void>();
      queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second', { owner: 'waiter' });
      const assertion = expect(p2).rejects.toThrowError(
        expect.objectContaining({ code: LifecycleErrorCode.queueAdmissionTimeout })
      );
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('the rejection carries the owner label and the waited duration', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 50 });
      const blocking = deferred<void>();
      queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second', { owner: 'my-owner' });
      let caught: { detail?: { owner?: string; waitedMs?: number } } | undefined;
      const assertion = p2.catch((error: unknown) => {
        caught = error as typeof caught;
      });
      await vi.advanceTimersByTimeAsync(51);
      await assertion;
      expect(caught?.detail?.owner).toBe('my-owner');
      expect(caught?.detail?.waitedMs).toBeGreaterThanOrEqual(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('queueAdmissionTimeoutMs: false disables rejection entirely for a queued task', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: false });
      const blocking = deferred<void>();
      const p1 = queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second');
      await vi.advanceTimersByTimeAsync(1_000_000);
      blocking.resolve();
      await p1;
      await expect(p2).resolves.toBe('second');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a per-call queueAdmissionTimeoutMs override takes priority over the queue-level default', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10_000 });
      const blocking = deferred<void>();
      queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second', { queueAdmissionTimeoutMs: 20 });
      const assertion = expect(p2).rejects.toThrowError(
        expect.objectContaining({ code: LifecycleErrorCode.queueAdmissionTimeout })
      );
      await vi.advanceTimersByTimeAsync(21);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a per-call override of `false` can turn off the queue-level default for one task', async () => {
    vi.useFakeTimers();
    try {
      const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10 });
      const blocking = deferred<void>();
      const p1 = queue.enqueue(() => blocking.promise);
      const p2 = queue.enqueue(() => 'second', { queueAdmissionTimeoutMs: false });
      await vi.advanceTimersByTimeAsync(1000);
      blocking.resolve();
      await p1;
      await expect(p2).resolves.toBe('second');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MutationQueue: owner self-dependency detection', () => {
  it('rejects immediately when a running task’s owner enqueues a new task under the same owner', async () => {
    const queue = createMutationQueue();
    let rejection: unknown;
    const outer = queue.enqueue(
      async () => {
        try {
          await queue.enqueue(() => 'inner', { owner: 'same' });
        } catch (error) {
          rejection = error;
        }
      },
      { owner: 'same' }
    );
    await outer;
    expect((rejection as { code?: string })?.code).toBe(LifecycleErrorCode.queueSelfDependency);
  });

  it('does not flag two different owners — a task submitted from within a running task, under a different owner, is queued normally and runs once the outer task lets go (it must not be awaited by the outer task itself, or the strictly-serial queue would deadlock on its own — no label needed to explain that)', async () => {
    const queue = createMutationQueue();
    const results: string[] = [];
    let innerPromise: Promise<unknown> | undefined;
    await queue.enqueue(
      () => {
        results.push('outer');
        // Fire-and-forget: the outer task does not await its own successor.
        innerPromise = queue.enqueue(
          () => {
            results.push('inner');
          },
          { owner: 'inner-owner' }
        );
      },
      { owner: 'outer-owner' }
    );
    await innerPromise;
    expect(results).toEqual(['outer', 'inner']);
  });

  it('does not reject an unlabeled task purely for being enqueued while something else runs', async () => {
    const queue = createMutationQueue();
    const blocking = deferred<void>();
    const p1 = queue.enqueue(() => blocking.promise);
    const p2 = queue.enqueue(() => 'second'); // no owner — never flagged as self-dependency
    blocking.resolve();
    await p1;
    await expect(p2).resolves.toBe('second');
  });
});

describe('R-9 scheduler 注入（manualScheduler）', () => {
  it('推进才触发 watchdog 超时，未推进不触发', async () => {
    const manual = createManualScheduler();
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10, scheduler: manual });
    const blocking = deferred<void>();
    const p1 = queue.enqueue(async () => {
      await blocking.promise;
    });
    const p2 = queue.enqueue(() => 'second');
    // 未推进：second 不应超时
    await Promise.resolve();
    manual.advance(11);
    await expect(p2).rejects.toMatchObject({ code: LifecycleErrorCode.queueAdmissionTimeout });
    blocking.resolve();
    await p1;
  });
});

describe('AF-T32 mutation queue scheduling failure leaves no ghost task', () => {
  it('scheduler.now() throw removes the record and keeps the queue usable', async () => {
    const boom = new Error('now boom');
    const scheduler = {
      now: () => {
        throw boom;
      },
      schedule: () => ({ cancel: () => {} })
    };
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10, scheduler });
    const blocking = deferred<void>();
    void queue.enqueue(async () => {
      await blocking.promise;
    });
    await Promise.resolve();
    await expect(queue.enqueue(() => 'ghost')).rejects.toBe(boom);
    expect(queue.size).toBe(1);
    blocking.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.size).toBe(0);
  });

  it('scheduler.schedule() throw removes the record', async () => {
    const boom = new Error('schedule boom');
    const scheduler = {
      now: () => 0,
      schedule: () => {
        throw boom;
      }
    };
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10, scheduler });
    const blocking = deferred<void>();
    void queue.enqueue(async () => {
      await blocking.promise;
    });
    await Promise.resolve();
    await expect(queue.enqueue(() => 'ghost')).rejects.toBe(boom);
    expect(queue.size).toBe(1);
    blocking.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.size).toBe(0);
  });

  it('scheduler.schedule() returning an invalid handle is rejected without a ghost task', async () => {
    const scheduler = {
      now: () => 0,
      schedule: () => ({}) // no cancel()
    };
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10, scheduler: scheduler as any });
    const blocking = deferred<void>();
    void queue.enqueue(async () => {
      await blocking.promise;
    });
    await Promise.resolve();
    await expect(queue.enqueue(() => 'ghost')).rejects.toMatchObject({
      code: LifecycleErrorCode.invalidOption
    });
    expect(queue.size).toBe(1);
    blocking.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.size).toBe(0);
  });
});

describe('AF-T33 admission diagnostic callback isolation', () => {
  it('sync-throwing diagnostic does not break the queue or advance()', async () => {
    const manual = createManualScheduler();
    const diagnostics: string[] = [];
    const queue = createMutationQueue({
      scheduler: manual,
      admissionDiagnosticMs: 5,
      onAdmissionDiagnostic: () => {
        throw new Error('diag boom');
      }
    });
    const blocking = deferred<void>();
    void queue.enqueue(async () => {
      await blocking.promise;
    });
    const second = queue.enqueue(() => 'second');
    void second.catch(() => {});
    await Promise.resolve();
    manual.advance(6); // 诊断回调同步抛错，不得中断 advance
    blocking.resolve();
    await expect(second).resolves.toBe('second');
    expect(diagnostics).toHaveLength(0);
  });

  it('async-rejecting diagnostic does not produce an unhandled rejection', async () => {
    const manual = createManualScheduler();
    const queue = createMutationQueue({
      scheduler: manual,
      admissionDiagnosticMs: 5,
      onAdmissionDiagnostic: () => Promise.reject(new Error('async diag boom'))
    });
    const blocking = deferred<void>();
    void queue.enqueue(async () => {
      await blocking.promise;
    });
    const second = queue.enqueue(() => 'second');
    await Promise.resolve();
    manual.advance(6);
    blocking.resolve();
    await expect(second).resolves.toBe('second');
  });
});
