import { describe, expect, it } from 'vitest';
import { authentication } from '../../src/middleware/authentication';
import type { IWebRpcMiddlewareContext } from '../../src/typing';

/** Installs middleware into an isolated capability map. */
const install = (middleware: ReturnType<typeof authentication>): Map<string, unknown> => {
  const values = new Map<string, unknown>();
  middleware.install({
    id: 'endpoint',
    transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
    hooks: () => undefined,
    capabilities: {
      set: (key, value) => values.set(key, value),
      get: <T>(key: string) => values.get(key) as T | undefined
    }
  } as IWebRpcMiddlewareContext);
  return values;
};

describe('authentication middleware', () => {
  it('encrypts before signing and verifies before decrypting', async () => {
    const calls: string[] = [];
    const values = install(
      authentication({
        encrypt: (value) => {
          calls.push('encrypt');
          return `encrypted:${String(value)}`;
        },
        decrypt: (value) => {
          calls.push('decrypt');
          return String(value).slice('encrypted:'.length);
        },
        sign: (value) => {
          calls.push('sign');
          return `signed:${String(value)}`;
        },
        verify: (value) => {
          calls.push('verify');
          return String(value).slice('signed:'.length);
        },
        encodedType: 'string'
      })
    );
    const capability = values.get('authenticationCapability') as {
      protect(value: unknown, context: unknown): Promise<unknown>;
      unprotect(value: unknown, context: unknown): Promise<unknown>;
    };
    const context = { direction: 'outbound', endpointId: 'endpoint', platform: 'Memory' };
    const protectedValue = await capability.protect('data', context);
    await expect(
      capability.unprotect(protectedValue, { ...context, direction: 'inbound' })
    ).resolves.toBe('data');
    expect(calls).toEqual(['encrypt', 'sign', 'verify', 'decrypt']);
  });

  it.each([
    [{ encrypt: () => undefined }, 'encrypt/decrypt'],
    [{ sign: () => undefined }, 'sign/verify'],
    [{}, 'requires encryption or signing']
  ])('rejects incomplete transform pairs', (config, message) => {
    expect(() => install(authentication(config as never))).toThrow(message);
  });

  it('maps custom verification failures to the dedicated error', async () => {
    const values = install(
      authentication({
        sign: (value) => value,
        verify: () => {
          throw new Error('bad signature');
        }
      })
    );
    const capability = values.get('authenticationCapability') as {
      unprotect(value: unknown, context: unknown): Promise<unknown>;
    };
    await expect(
      capability.unprotect('forged', {
        direction: 'inbound',
        endpointId: 'endpoint',
        platform: 'Memory'
      })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED', name: 'WebRpcAuthenticationError' });
  });
});
