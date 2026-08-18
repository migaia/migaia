import { describe, expect, it } from 'vitest';
import { runAsyncMiddleware } from '../src/index.js';

describe('Round30 active-control policy', () => {
  it('keeps caught-and-rethrown active control exact and uncombined', async () => {
    /** Exact runner-owned error shared by downstream active control and upstream rethrow. */
    const activeError = new Error('host is closing');
    /** Counts host combiner calls to prove control failure is not treated as dual failure. */
    let combinations = 0;
    /** Controls when the downstream post-stage active guard starts failing. */
    let active = true;

    // `await next()` propagation and catch/rethrow of the same value are observationally
    // equivalent to the runner; preserve exact active control instead of guessing provenance.
    const run = runAsyncMiddleware(
      [
        async (_value: number, next: (value: number) => Promise<void>) => {
          try {
            await next(2);
          } catch (error) {
            expect(error).toBe(activeError);
          }
          throw activeError;
        },
        async () => {
          active = false;
        }
      ],
      1,
      () => undefined,
      {
        onViolation: () => undefined,
        assertActive: () => {
          if (!active) throw activeError;
        },
        combineStageAndDownstreamError: () => {
          combinations += 1;
          return new Error('unexpected active-control combination');
        }
      }
    );

    await expect(run).rejects.toBe(activeError);
    expect(combinations).toBe(0);
  });
});
