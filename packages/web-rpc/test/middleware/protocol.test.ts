import { describe, expect, it } from 'vitest';
import { protocol } from '../../src/middleware/protocol';

describe('protocol middleware', () => {
  it('installs normalized encode/decode capability', () => {
    const values = new Map<string, unknown>();
    protocol({
      encode: (value: unknown) => JSON.stringify(value),
      decode: (value: unknown) => JSON.parse(String(value))
    }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('protocolCapability') as {
      encode(value: unknown): unknown;
      decode(value: unknown): unknown;
    };
    expect(capability.decode(capability.encode({ ok: true }))).toEqual({ ok: true });
  });
});
