import { describe, expect, it } from 'vitest';
import { createWorkerHandler } from '../src/index';

describe('store-worker exports', () => {
  it('creates a managed worker handler', () => {
    const handler = createWorkerHandler<number, number>(
      (value) => value + 1,
      () => {}
    );

    expect(handler.disposed).toBe(false);
    handler.dispose();
    expect(handler.disposed).toBe(true);
  });
});
