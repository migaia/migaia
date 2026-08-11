import { describe, expect, it } from 'vitest';
import { uuid } from '../../src/middleware/uuid';

describe('uuid middleware', () => {
  it('publishes the injected generator', () => {
    const generate = () => 'id';
    const values = new Map<string, unknown>();
    uuid({ generate }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (n, v) => values.set(n, v),
        get: <T>(n: string) => values.get(n) as T | undefined
      }
    });
    expect((values.get('uuid') as { generate: typeof generate }).generate()).toBe('id');
  });
});
