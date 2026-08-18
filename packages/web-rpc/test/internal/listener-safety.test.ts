import { describe, expect, it } from 'vitest';
import {
  observeListener,
  registerListeners,
  releaseListeners
} from '../../src/internal/listener-safety.js';

describe('listener safety', () => {
  it('reports synchronous listener failures without throwing', () => {
    const errors: unknown[] = [];
    expect(() =>
      observeListener(
        () => {
          throw new Error('sync');
        },
        (error) => errors.push(error)
      )
    ).not.toThrow();
    expect(errors[0]).toMatchObject({ message: 'sync' });
  });

  it('observes promise and thenable rejection asynchronously', async () => {
    const errors: unknown[] = [];
    observeListener(
      () => Promise.reject('promise'),
      (error) => errors.push(error)
    );
    observeListener(
      () =>
        ({
          // oxlint-disable-next-line unicorn/no-thenable
          then: (_resolve: () => void, reject: (error: unknown) => void) => reject('thenable')
        }) as never,
      (error) => errors.push(error)
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['promise', 'thenable']);
  });

  it('contains diagnostic failures at the terminal boundary', async () => {
    expect(() =>
      observeListener(
        () => Promise.reject('failure'),
        () => {
          throw new Error('diagnostic');
        }
      )
    ).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it('rolls back earlier registrations when a later registration fails', () => {
    const active: string[] = [];
    expect(() =>
      registerListeners([
        {
          add: () => active.push('first'),
          remove: () => active.splice(active.indexOf('first'), 1)
        },
        {
          add: () => {
            throw new Error('second registration failed');
          },
          remove: () => undefined
        }
      ])
    ).toThrow('second registration failed');
    expect(active).toEqual([]);
  });

  it('keeps rollback going when an earlier removal fails', () => {
    const active: string[] = [];
    expect(() =>
      registerListeners([
        {
          add: () => active.push('first'),
          remove: () => {
            throw new Error('first removal failed');
          }
        },
        {
          add: () => active.push('second'),
          remove: () => active.splice(active.indexOf('second'), 1)
        },
        {
          add: () => {
            throw new Error('third registration failed');
          },
          remove: () => undefined
        }
      ])
    ).toThrow('third registration failed');
    expect(active).toEqual(['first']);
  });

  it('runs every removal and aggregates cleanup failures', () => {
    const removed: string[] = [];
    let failure: unknown;
    try {
      releaseListeners([
        () => {
          removed.push('first');
          throw new Error('first failed');
        },
        () => {
          removed.push('second');
          throw new Error('second failed');
        },
        () => removed.push('third')
      ]);
    } catch (error) {
      failure = error;
    }
    expect(removed).toEqual(['third', 'second', 'first']);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
  });
});
