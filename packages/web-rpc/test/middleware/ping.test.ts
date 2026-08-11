import { describe, expect, it } from 'vitest';
import { ping } from '../../src/middleware/ping';

describe('ping middleware', () => {
  it('publishes an enabled ping capability', () => {
    const values = new Map<string, unknown>();
    ping().install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (key, value) => values.set(key, value),
        get: <T>(key: string) => values.get(key) as T | undefined
      }
    });
    expect(values.get('pingCapability')).toEqual({ enabled: true });
  });
});
