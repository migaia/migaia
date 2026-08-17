import { describe, expect, it } from 'vitest';
import { runAsyncPipeline, adaptSyncStageToAsync } from '../../src/pipeline';

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
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'upstream' }),
        expect.objectContaining({ message: 'downstream' })
      ])
    });
    expect(errors).toHaveLength(0);
  });

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
