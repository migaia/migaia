import { describe, expect, it } from 'vitest';
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  adaptSyncStageToAsync,
  adaptSyncStageToGenerator,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware
} from '../src/index.js';

describe('runSyncMiddleware', () => {
  it('uses stage snapshot and completes value flow', () => {
    const values: number[] = [];
    runSyncMiddleware(
      [(value, next) => next(value + 1), (value, next) => next(value * 2)],
      2,
      (value) => values.push(value),
      () => {
        throw new Error('unexpected violation');
      }
    );
    expect(values).toEqual([6]);
  });

  it('short-circuits when a stage does not call next', () => {
    const values: number[] = [];
    runSyncMiddleware(
      [(value) => value],
      1,
      (value) => values.push(value),
      () => undefined
    );
    expect(values).toEqual([]);
  });

  it('reports duplicate and late next without changing the first value', () => {
    const violations: string[] = [];
    let lateNext!: (value: number) => void;
    const values: number[] = [];
    runSyncMiddleware(
      [
        (_value, next) => {
          next(2);
          next(3);
          lateNext = next;
        }
      ],
      1,
      (value) => values.push(value),
      (kind) => violations.push(kind)
    );
    lateNext(4);
    expect(values).toEqual([2]);
    expect(violations).toEqual(['duplicate', 'late']);
  });
});

describe('runAsyncMiddleware', () => {
  it('handles long next chains without overflowing the call stack', async () => {
    const stages = Array.from(
      { length: 20000 },
      () => (value: number, next: (nextValue: number) => Promise<void>) => next(value + 1)
    );
    let result = 0;
    await runAsyncMiddleware(
      stages,
      0,
      (value) => {
        result = value;
      },
      { onViolation: () => undefined }
    );
    expect(result).toBe(20000);
  });

  it('combines upstream and downstream failures through the injected policy', async () => {
    const combinations: unknown[][] = [];
    await expect(
      runAsyncMiddleware(
        [
          async (_value, next) => {
            void next(2);
            throw new Error('upstream');
          },
          async () => {
            throw new Error('downstream');
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError]);
            return new Error('combined');
          }
        }
      )
    ).rejects.toThrow('combined');
    expect(combinations).toHaveLength(1);
    expect(combinations[0]).toEqual([
      expect.objectContaining({ message: 'upstream' }),
      expect.objectContaining({ message: 'downstream' })
    ]);
  });

  it('codes the default aggregate while preserving both original failures', async () => {
    const stageError = new Error('default upstream');
    const downstreamError = new Error('default downstream');
    const rejected = runAsyncMiddleware(
      [
        async (_value, next) => {
          void next(2);
          throw stageError;
        },
        async () => {
          throw downstreamError;
        }
      ],
      1,
      () => undefined,
      { onViolation: () => undefined }
    );
    await expect(rejected).rejects.toMatchObject({
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.executionFailed,
      message: 'middleware stage and downstream failed',
      errors: [stageError, downstreamError]
    });
  });

  it('preserves undefined throws and rejections as failures', async () => {
    await expect(
      runAsyncMiddleware(
        [
          async () => {
            throw undefined;
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined
        }
      )
    ).rejects.toBeUndefined();
    await expect(
      runAsyncMiddleware(
        [
          async (_value, next) => {
            void next(2);
          },
          async () => Promise.reject(undefined)
        ],
        1,
        () => undefined,
        { onViolation: () => undefined }
      )
    ).rejects.toBeUndefined();
  });

  it('supports active checks after downstream completion', async () => {
    let active = true;
    await expect(
      runAsyncMiddleware(
        [
          async (_value) => {
            active = false;
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw new Error('inactive');
          }
        }
      )
    ).rejects.toThrow('inactive');
  });

  it('runs the completion callback for an empty stage list', async () => {
    const values: number[] = [];
    await runAsyncMiddleware(
      [],
      3,
      (value) => {
        values.push(value);
      },
      { onViolation: () => undefined }
    );
    expect(values).toEqual([3]);
  });
});

describe('adaptSyncStageToAsync', () => {
  it('reports duplicate next and starts only the first downstream', async () => {
    const violations: string[] = [];
    let downstreamRuns = 0;
    const adapted = adaptSyncStageToAsync(
      (_, next: (value: number) => void) => {
        next(2);
        next(3);
      },
      (kind) => violations.push(kind)
    );
    await adapted(1, () => {
      downstreamRuns += 1;
      return Promise.resolve();
    });
    expect(violations).toEqual(['duplicate']);
    expect(downstreamRuns).toBe(1);
  });

  it('reports late next after the stage returns', async () => {
    const violations: string[] = [];
    let storedNext!: (value: number) => void;
    let downstreamRuns = 0;
    const adapted = adaptSyncStageToAsync(
      (_value, next: (value: number) => void) => {
        storedNext = next;
      },
      (kind) => violations.push(kind)
    );
    const pending = adapted(1, () => {
      downstreamRuns += 1;
      return Promise.resolve();
    });
    storedNext(2);
    await pending;
    expect(violations).toEqual(['late']);
    expect(downstreamRuns).toBe(0);
  });

  it('observes the first downstream rejection', async () => {
    const adapted = adaptSyncStageToAsync((_value, next: (value: number) => void) => {
      next(2);
      next(3);
    });
    await expect(adapted(1, () => Promise.reject(new Error('downstream boom')))).rejects.toThrow(
      'downstream boom'
    );
  });
});

describe('adaptSyncStageToGenerator', () => {
  it('converts next into a yielded value and reports duplicate/late calls', () => {
    const violations: string[] = [];
    let lateNext!: (value: number) => void;
    const adapted = adaptSyncStageToGenerator(
      (_value, next) => {
        lateNext = next;
        next(2);
        next(3);
      },
      (kind) => violations.push(kind)
    );
    const iterator = adapted(1);
    expect(iterator.next()).toEqual({ value: 2, done: false });
    expect(iterator.next()).toEqual({ value: GENERATOR_CONTINUE, done: true });
    lateNext(4);
    expect(violations).toEqual(['duplicate', 'late']);
  });
});

describe('runGeneratorMiddleware', () => {
  it('uses final return value and last yield fallback', () => {
    const values: number[] = [];
    runGeneratorMiddleware<number>(
      [
        function* (value) {
          yield value + 1;
          return value + 2;
        },
        function* (value) {
          yield value * 2;
          return GENERATOR_CONTINUE;
        }
      ],
      1,
      (value) => values.push(value)
    );
    expect(values).toEqual([6]);
  });

  it('supports explicit undefined and halt after yielding', () => {
    const undefinedValues: unknown[] = [];
    runGeneratorMiddleware<string | undefined>(
      [
        function* () {
          return GENERATOR_UNDEFINED;
        }
      ],
      'input',
      (value) => undefinedValues.push(value)
    );
    expect(undefinedValues).toEqual([undefined]);
    const halted: number[] = [];
    runGeneratorMiddleware(
      [
        function* () {
          yield 2;
          return GENERATOR_HALT;
        }
      ],
      1,
      (value) => halted.push(value)
    );
    expect(halted).toEqual([]);
  });

  it('accepts host-owned sentinel identities for compatibility wrappers', () => {
    const hostContinue = Symbol('host.continue');
    const values: number[] = [];
    runGeneratorMiddleware(
      [
        function* (value) {
          yield value + 1;
          return hostContinue as unknown as typeof GENERATOR_CONTINUE;
        }
      ],
      1,
      (value) => values.push(value),
      {
        undefined: Symbol('host.undefined'),
        halt: Symbol('host.halt'),
        continue: hostContinue
      }
    );
    expect(values).toEqual([2]);
  });
});
