import { describe, expect, it } from 'vitest';
import { runAsyncPipeline } from '../../src/pipeline';

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
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'upstream' }),
        expect.objectContaining({ message: 'downstream' })
      ])
    });
    expect(errors).toHaveLength(0);
  });
});
