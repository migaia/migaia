import { describe, expect, it } from 'vitest';
import { ResourceScope } from '../../src/internal/resource-scope';

describe('ResourceScope', () => {
  it('releases reverse order and aggregates failures', async () => {
    const order: string[] = [];
    const scope = new ResourceScope();
    scope.add('a', () => {
      order.push('a');
    });
    scope.add('b', () => {
      order.push('b');
      throw new Error('b');
    });
    const errors = await scope.releaseAll();
    expect(order).toEqual(['b', 'a']);
    expect(errors).toHaveLength(1);
  });
  it('shares the release promise across concurrent callers', async () => {
    let released = 0;
    const scope = new ResourceScope();
    scope.add('resource', async () => {
      await Promise.resolve();
      released += 1;
    });
    const first = scope.releaseAll();
    const second = scope.releaseAll();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(released).toBe(1);
  });
  it('releases critical transport resources before application disposers', async () => {
    const order: string[] = [];
    const scope = new ResourceScope();
    scope.add('middleware', () => {
      order.push('middleware');
    });
    scope.add(
      'transport',
      () => {
        order.push('transport');
      },
      'critical'
    );
    await scope.releaseAll();
    expect(order).toEqual(['transport', 'middleware']);
  });
});
