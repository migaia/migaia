import { describe, expect, it } from 'vitest';
import { hooks } from '../../src/middleware/hooks';

describe('hooks middleware', () => {
  it('publishes hook configuration', () => {
    const values = new Map<string, unknown>();
    hooks().install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (n, v) => values.set(n, v),
        get: <T>(n: string) => values.get(n) as T | undefined
      }
    });
    expect(values.has('hooks')).toBe(true);
  });
  it('normalizes hostile listener containers into INVALID_CONFIG', () => {
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() =>
      hooks({ listeners: revoked.proxy as never }).install({
        id: 'a',
        transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('hooks descriptor is invalid');
  });
});
