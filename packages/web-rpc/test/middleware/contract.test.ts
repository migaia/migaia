import { describe, expect, it } from 'vitest';
import { WebRpcErrorCode } from '../../src/errors';
import { contract } from '../../src/middleware/contract';
import type { IWebRpcContractConfig } from '../../src/typing';

describe('contract middleware', () => {
  it('preserves a __proto__ schema method as an own key', () => {
    const values = new Map<string, unknown>();
    const schema = { parse: (value: unknown) => value };
    contract({ schemas: { ['__proto__']: { params: schema, result: schema } } }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('contractCapability') as {
      validateData: (method: string, side: 'params' | 'result', data: unknown) => void;
    };
    expect(() => capability.validateData('__proto__', 'params', 'ok')).not.toThrow();
  });
  it('exposes schema validation as a capability', () => {
    const values = new Map<string, unknown>();
    contract({
      schemas: {
        add: {
          params: {
            parse: (v) => {
              if (typeof v !== 'number') throw new Error('number');
              return v;
            }
          },
          result: { parse: (v) => v }
        }
      }
    }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (n, v) => values.set(n, v),
        get: <T>(n: string) => values.get(n) as T | undefined
      }
    });
    const validate = (
      values.get('contractCapability') as {
        validateData: (m: string, s: 'params' | 'result', v: unknown) => void;
      }
    ).validateData;
    expect(() => validate('add', 'params', 'bad')).toThrow();
  });
  it('owns schema descriptor containers after installation', () => {
    const values = new Map<string, unknown>();
    const schema = { parse: (value: unknown) => value };
    const config = {
      schemas: { add: { params: schema, result: schema } }
    };
    contract(config).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const validate = (
      values.get('contractCapability') as {
        validateData: (method: string, side: 'params' | 'result', value: unknown) => void;
      }
    ).validateData;
    config.schemas.add.params = {
      parse: () => {
        throw new Error('replacement');
      }
    };
    expect(() => validate('add', 'params', 'still accepted')).not.toThrow();
  });
  it('rejects malformed schema and version descriptors during installation', () => {
    const install = (config: unknown): void => {
      contract(config as IWebRpcContractConfig).install({
        id: 'a',
        transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      });
    };
    expect(() => install({ schemas: { add: { params: {}, result: {} } } })).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install({ acceptVersions: [1] })).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install({ acceptVersions: 1 })).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(null)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install('invalid')).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable contract descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('contract getter');
        }
      }
    );
    expect(() =>
      contract(unreadable as never).install({
        id: 'a',
        transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
  });
  it('rejects a revoked acceptVersions container during installation', () => {
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() =>
      contract({ acceptVersions: revoked.proxy as never }).install({
        id: 'a',
        transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('contract.acceptVersions is unreadable');
  });
});
