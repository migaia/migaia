import { describe, expect, it, vi } from 'vitest';
import { boundedWait } from '../src/bounded-wait.js';
import { createDisposeTransaction, executeReleaseDescriptor } from '../src/dispose-transaction.js';
import { createGenerationController } from '../src/generation-controller.js';
import { createLifecycleScope } from '../src/lifecycle-scope.js';
import { createMutationQueue } from '../src/mutation-queue.js';
import { LifecycleErrorCode } from '../src/error-code.js';
import { LIFECYCLE_SOURCE } from '../src/errors.js';
import { DisposeTransactionKind } from '../src/state-constants.js';
import type { ILifecycleScheduler } from '../src/scheduler.js';

type ISchedulerOption = { readonly scheduler?: ILifecycleScheduler };

const capture = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

const assertSchedulerAccessorFailure = (value: unknown, cause: Error): void => {
  expect(value).toBeInstanceOf(TypeError);
  expect(value).toMatchObject({ source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption });
  expect((value as { readonly cause?: unknown }).cause).toBe(cause);
  expect((value as Error).stack).toBeTruthy();
  expect(cause.stack).toBeTruthy();
};

describe('Round30 scheduler option admission', () => {
  it('wraps one hostile scheduler option read across every public lifecycle factory', () => {
    const scheduler = {
      now: vi.fn(() => 0),
      schedule: vi.fn(() => ({ cancel: vi.fn() }))
    } satisfies ILifecycleScheduler;
    const factories: readonly [string, (options: ISchedulerOption) => unknown][] = [
      ['generation controller', (options) => createGenerationController(options)],
      ['lifecycle scope', (options) => createLifecycleScope(options)],
      ['mutation queue', (options) => createMutationQueue(options)],
      [
        'dispose transaction',
        (options) => createDisposeTransaction({ kind: DisposeTransactionKind.plan }, options)
      ]
    ];

    for (const [label, factory] of factories) {
      const cause = new Error(`${label} scheduler getter failed`);
      let reads = 0;
      const options = {
        get scheduler(): ILifecycleScheduler {
          reads++;
          throw cause;
        }
      };

      const error = capture(() => factory(options));

      assertSchedulerAccessorFailure(error, cause);
      expect(reads).toBe(1);
      expect(scheduler.now).not.toHaveBeenCalled();
      expect(scheduler.schedule).not.toHaveBeenCalled();
    }
  });

  it('wraps one hostile scheduler option read in boundedWait without scheduling', async () => {
    const cause = new Error('bounded wait scheduler getter failed');
    const scheduler = {
      now: vi.fn(() => 0),
      schedule: vi.fn(() => ({ cancel: vi.fn() }))
    } satisfies ILifecycleScheduler;
    let taskReads = 0;
    const task = new Proxy(
      {},
      {
        get(_target, property: PropertyKey): unknown {
          if (property !== 'then') return undefined;
          taskReads++;
          throw new Error('task must not be touched');
        }
      }
    );
    let reads = 0;
    const options = {
      get scheduler(): ILifecycleScheduler {
        reads++;
        throw cause;
      }
    };

    let error: unknown;
    try {
      await boundedWait(task as PromiseLike<unknown>, 1, options);
    } catch (caught) {
      error = caught;
    }

    assertSchedulerAccessorFailure(error, cause);
    expect(reads).toBe(1);
    expect(taskReads).toBe(0);
    expect(scheduler.now).not.toHaveBeenCalled();
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('wraps one hostile context scheduler read before release callbacks run', async () => {
    const cause = new Error('release context scheduler getter failed');
    const graceful = vi.fn();
    const force = vi.fn();
    let reads = 0;
    const context = {
      signal: new AbortController().signal,
      deadlineAt: undefined,
      get scheduler(): ILifecycleScheduler {
        reads++;
        throw cause;
      },
      report: vi.fn()
    };

    let error: unknown;
    try {
      await executeReleaseDescriptor({ graceful, force }, context);
    } catch (caught) {
      error = caught;
    }

    assertSchedulerAccessorFailure(error, cause);
    expect(reads).toBe(1);
    expect(graceful).not.toHaveBeenCalled();
    expect(force).not.toHaveBeenCalled();
  });

  it('wraps a hostile scheduler method accessor as native TypeError with exact cause', () => {
    const cause = new Error('scheduler now getter failed');
    let reads = 0;
    const scheduler = {
      get now(): () => number {
        reads++;
        throw cause;
      },
      schedule: vi.fn(() => ({ cancel: vi.fn() }))
    };

    const error = capture(() => createMutationQueue({ scheduler }));

    assertSchedulerAccessorFailure(error, cause);
    expect(reads).toBe(1);
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });
});
