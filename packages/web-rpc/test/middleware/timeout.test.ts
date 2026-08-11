import { describe, expect, it } from 'vitest';
import { timeout } from '../../src/middleware/timeout';

describe('timeout middleware', () => {
  it('resolves per-call override before middleware default', () => {
    const values = new Map<string, unknown>();
    timeout({ timeoutMs: 10 }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('timeoutCapability') as {
      resolveTimeout(override?: number | false): number | false | undefined;
    };
    expect(capability.resolveTimeout()).toBe(10);
    expect(capability.resolveTimeout(25)).toBe(25);
  });
  it('rejects a revoked retry descriptor during installation', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() =>
      timeout({ retry: revoked.proxy as never }).install({
        id: 'a',
        transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('timeout.retry descriptor is unreadable');
  });
});
