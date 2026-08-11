import { describe, expect, it } from 'vitest';
import { abort } from '../../src/middleware/abort';
import { ping } from '../../src/middleware/ping';

describe('feature middleware', () => {
  it('publishes explicit abort and ping capabilities', () => {
    const values = new Map<string, unknown>();
    const context = {
      id: 'a',
      transport: { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (n: string, v: unknown) => values.set(n, v),
        get: <T>(n: string) => values.get(n) as T | undefined
      }
    };
    abort().install(context);
    ping().install(context);
    expect(values.get('abortCapability')).toEqual({ enabled: true });
    expect(values.get('pingCapability')).toEqual({ enabled: true });
  });
});
