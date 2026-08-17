import { describe, expect, it, vi } from 'vitest';
import { boundedWait } from '../src/bounded-wait.js';
import { systemScheduler } from '../src/scheduler.js';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('L-T16 boundedWait: task winning vs timeout winning', () => {
  it('returns true when the task resolves before the deadline', async () => {
    const { promise, resolve } = deferred<void>();
    const p = boundedWait(promise, systemScheduler.now() + 5000);
    resolve();
    await expect(p).resolves.toBe(true);
  });

  it('returns false without cancelling the task when the deadline is already past', async () => {
    const { promise, resolve } = deferred<void>();
    const won = await boundedWait(promise, systemScheduler.now() - 1);
    expect(won).toBe(false);
    // the task is not cancelled — it can still resolve later and must be observed, not swallowed.
    resolve();
    await promise;
  });

  it('propagates the task rejection when it rejects before the deadline', async () => {
    const { promise, reject } = deferred<void>();
    const p = boundedWait(promise, systemScheduler.now() + 5000);
    reject(new Error('task failed'));
    await expect(p).rejects.toThrow('task failed');
  });

  it('a late rejection after the deadline already elapsed does not produce an unhandled rejection', async () => {
    const { promise, reject } = deferred<void>();
    const won = await boundedWait(promise, systemScheduler.now() - 1);
    expect(won).toBe(false);
    reject(new Error('late failure, must be observed'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Reaching here without a process-level unhandledRejection proves LG-R5-3 held.
    expect(true).toBe(true);
  });

  it('clears its own timer once the task wins the race (no dangling timer)', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { promise, resolve } = deferred<void>();
    resolve();
    await boundedWait(promise, systemScheduler.now() + 5000);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    clearTimeoutSpy.mockRestore();
  });
});
