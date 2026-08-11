import { describe, expect, it } from 'vitest';
import { abort } from '../../src/middleware/abort';

describe('abort middleware', () => {
  it('publishes an enabled abort capability', () => {
    const values = new Map<string, unknown>();
    abort().install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (key, value) => values.set(key, value),
        get: <T>(key: string) => values.get(key) as T | undefined
      }
    });
    expect(values.get('abortCapability')).toEqual({ enabled: true });
  });
});
