import { describe, expect, it } from 'vitest';
import { runAsyncPipeline, adaptSyncStageToAsync } from '../../src/pipeline.js';
import ERROR_TEXT, { PluginHostError } from '../../src/error-text.js';

describe('runAsyncPipeline', () => {
  it('handles long next chains without overflowing the call stack', async () => {
    const stages = Array.from(
      { length: 20000 },
      () => (value: number, next: (nextValue: number) => Promise<void>) => next(value + 1)
    );
    let result = 0;
    await runAsyncPipeline(
      stages,
      0,
      (value) => {
        result = value;
      },
      () => undefined
    );
    expect(result).toBe(20000);
  });

  it('observes downstream failure when upstream throws after next()', async () => {
    const errors: unknown[] = [];
    await expect(
      runAsyncPipeline(
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
        () => undefined
      )
    ).rejects.toMatchObject({
      code: 'PIPELINE_FAILED',
      source: '@migaia/plugin-host',
      errors: [
        expect.objectContaining({ message: 'upstream' }),
        expect.objectContaining({ message: 'downstream' })
      ]
    });
    expect(errors).toHaveLength(0);
  });

  it('preserves exact stage rejection when host turns closing', async () => {
    const stageError = new Error('stage failed while host closes');
    const activeError = new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
    let closing = false;
    await expect(
      runAsyncPipeline(
        [
          async () => {
            closing = true;
            throw stageError;
          }
        ],
        1,
        () => undefined,
        () => undefined,
        () => {
          if (closing) throw activeError;
        }
      )
    ).rejects.toBe(stageError);
  });

  it('preserves exact downstream rejection when host turns closing', async () => {
    const downstreamError = new Error('downstream failed while host closes');
    const activeError = new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
    let closing = false;
    let activeChecks = 0;
    await expect(
      runAsyncPipeline(
        [
          async (_value, next) => {
            closing = true;
            void next(2);
          },
          async () => {
            throw downstreamError;
          }
        ],
        1,
        () => undefined,
        () => undefined,
        () => {
          activeChecks += 1;
          if (activeChecks > 2 && closing) throw activeError;
        }
      )
    ).rejects.toBe(downstreamError);
  });

  it('combines dual failures before HOST_DISPOSING in exact stage-first order', async () => {
    const stageError = new Error('stage failed while host closes');
    const downstreamError = new Error('downstream failed while host closes');
    const activeError = new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
    let closing = false;
    let activeChecks = 0;
    let caught: unknown;
    try {
      await runAsyncPipeline(
        [
          async (_value, next) => {
            closing = true;
            void next(2);
            throw stageError;
          },
          async () => {
            throw downstreamError;
          }
        ],
        1,
        () => undefined,
        () => undefined,
        () => {
          activeChecks += 1;
          if (activeChecks > 2 && closing) throw activeError;
        }
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      source: '@migaia/plugin-host',
      code: 'PIPELINE_FAILED'
    });
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([stageError, downstreamError]);
    expect(caught).not.toBe(activeError);
  });

  it('throws HOST_DISPOSING after successful incomplete dispatch', async () => {
    const activeError = new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
    let closing = false;
    await expect(
      runAsyncPipeline(
        [
          async () => {
            closing = true;
          }
        ],
        1,
        () => undefined,
        () => undefined,
        () => {
          if (closing) throw activeError;
        }
      )
    ).rejects.toBe(activeError);
  });

  it('does not assert HOST_DISPOSING after done completes dispatch', async () => {
    const activeError = new PluginHostError('HOST_DISPOSING', ERROR_TEXT.HOST_DISPOSING);
    let closing = false;
    await expect(
      runAsyncPipeline(
        [async (value, next) => next(value + 1)],
        1,
        () => {
          closing = true;
        },
        () => undefined,
        () => {
          if (closing) throw activeError;
        }
      )
    ).resolves.toBeUndefined();
  });

  it.each(['await', 'return'] as const)(
    'keeps two error slots when %s next() and downstream reject with the same Error',
    async (style) => {
      const sharedError = new Error(`same ${style} error`);
      const stage = async (_value: number, next: (value: number) => Promise<void>) => {
        const result = next(2);
        if (style === 'await') {
          await result;
        } else {
          return result;
        }
      };
      await expect(
        runAsyncPipeline(
          [stage, async () => Promise.reject(sharedError)],
          1,
          () => undefined,
          () => undefined
        )
      ).rejects.toMatchObject({
        code: 'PIPELINE_FAILED',
        errors: [sharedError, sharedError]
      });
    }
  );

  it('AF-T24: throw undefined and reject(undefined) are not swallowed as success', async () => {
    await expect(
      runAsyncPipeline(
        [
          async () => {
            throw undefined;
          }
        ],
        1,
        () => undefined,
        () => undefined
      )
    ).rejects.toBeUndefined();

    await expect(
      runAsyncPipeline(
        [
          async (_value, next) => {
            void next(2);
            return undefined;
          },
          async () => Promise.reject(undefined)
        ],
        1,
        () => undefined,
        () => undefined
      )
    ).rejects.toBeUndefined();
  });

  it('AF-T24: double undefined failures produce a tagged AggregateError with two undefined slots', async () => {
    let caught: unknown;
    try {
      await runAsyncPipeline(
        [
          async (_value, next) => {
            void next(2);
            throw undefined;
          },
          async () => Promise.reject(undefined)
        ],
        1,
        () => undefined,
        () => undefined
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('PIPELINE_FAILED');
    const errors = (caught as { errors?: unknown[] }).errors;
    expect(errors).toHaveLength(2);
    expect(errors?.[0]).toBeUndefined();
    expect(errors?.[1]).toBeUndefined();
  });
});

describe('AF-T29 sync→async bridge duplicate/late guard', () => {
  it('duplicate next() reports violation and does not start a second downstream', async () => {
    const violations: Array<'late' | 'duplicate'> = [];
    let downstreamRuns = 0;
    const stage = (_value: number, next: (v: number) => void) => {
      next(2);
      next(3); // duplicate
    };
    const adapted = adaptSyncStageToAsync(stage, (kind) => violations.push(kind));
    await adapted(1, () => {
      downstreamRuns += 1;
      return Promise.resolve();
    });
    expect(violations).toEqual(['duplicate']);
    expect(downstreamRuns).toBe(1);
  });

  it('late next() after return reports violation and does not start a second downstream', async () => {
    const violations: Array<'late' | 'duplicate'> = [];
    let storedNext!: (v: number) => void;
    let downstreamRuns = 0;
    const stage = (_value: number, next: (v: number) => void) => {
      storedNext = next;
    };
    const adapted = adaptSyncStageToAsync(stage, (kind) => violations.push(kind));
    const pending = adapted(1, () => {
      downstreamRuns += 1;
      return Promise.resolve();
    });
    storedNext(2); // late — after stage returned
    await pending;
    expect(violations).toEqual(['late']);
    expect(downstreamRuns).toBe(0);
  });

  it('the first legitimate downstream rejection is still observed', async () => {
    const stage = (_value: number, next: (v: number) => void) => {
      next(2);
      next(3); // duplicate — must not overwrite the first downstream
    };
    const adapted = adaptSyncStageToAsync(stage, () => undefined);
    await expect(adapted(1, () => Promise.reject(new Error('downstream boom')))).rejects.toThrow(
      'downstream boom'
    );
  });

  it('AF-T30: onViolation is optional for backward compatibility (default no-op)', async () => {
    let downstreamRuns = 0;
    const stage = (_value: number, next: (v: number) => void) => {
      next(2);
      next(3); // duplicate — with default no-op handler this is silently ignored
    };
    const adapted = adaptSyncStageToAsync(stage); // 旧调用形态：不传 onViolation
    await adapted(1, () => {
      downstreamRuns += 1;
      return Promise.resolve();
    });
    expect(downstreamRuns).toBe(1);
  });
});
