import { describe, expect, it } from 'vitest';
import {
  abort,
  chunk,
  connect,
  contract,
  hooks,
  ping,
  protocol,
  timeout,
  uuid
} from '../../src/middleware/index';
import type { IWebRpcMiddlewareContext } from '../../src/typing';
import { WebRpcErrorCode } from '../../src/errors';

function context(): { context: IWebRpcMiddlewareContext; values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  const transport = {
    platform: 'Memory' as const,
    send: () => undefined,
    subscribe: () => () => undefined
  };
  return {
    values,
    context: {
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    }
  };
}

describe('middleware capabilities', () => {
  it('installs concrete capability values for every built-in middleware', async () => {
    const transport = {
      platform: 'Memory' as const,
      send: () => undefined,
      subscribe: () => () => undefined
    };
    const middlewares = [
      connect({ transport }),
      contract({ version: '1' }),
      uuid(),
      protocol(),
      timeout({ timeoutMs: 10 }),
      chunk({ chunkSize: 8 }),
      hooks(),
      abort(),
      ping()
    ];
    const values = new Map<string, unknown>();
    const base = context().context;
    const installContext = {
      ...base,
      transport,
      capabilities: {
        set: (name: string, value: unknown) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    } satisfies IWebRpcMiddlewareContext;
    for (const middleware of middlewares) await middleware.install(installContext);
    expect(values.has('connect')).toBe(true);
    expect(values.has('contract')).toBe(true);
    expect(values.has('protocol')).toBe(true);
    expect(values.has('timeout')).toBe(true);
    expect(values.has('chunk')).toBe(true);
    expect(values.get('abortCapability')).toEqual({ enabled: true });
    expect(values.get('pingCapability')).toEqual({ enabled: true });
  });

  it('rejects invalid middleware configuration during installation', async () => {
    const invalid = [
      timeout({ timeoutMs: -1 }),
      chunk({ chunkSize: 0 }),
      chunk({ chunkSize: 3 }),
      contract({ version: '' })
    ];
    for (const middleware of invalid) {
      await expect(
        Promise.resolve().then(() => middleware.install(context().context))
      ).rejects.toThrow();
    }
  });
  it('rejects null built-in middleware descriptors with INVALID_CONFIG', () => {
    const install = (middleware: {
      install: (input: IWebRpcMiddlewareContext) => unknown;
    }): void => {
      middleware.install(context().context);
    };
    expect(() => install(protocol(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(hooks(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(timeout(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(chunk(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(uuid(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => install(connect(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable protocol descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('protocol getter');
        }
      }
    );
    expect(() => protocol(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable hooks descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('hooks getter');
        }
      }
    );
    expect(() => hooks(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable timeout descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('timeout getter');
        }
      }
    );
    expect(() => timeout(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
    expect(() => timeout({ retry: 1 } as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable chunk descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('chunk keys');
        }
      }
    );
    expect(() => chunk(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable uuid descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('uuid getter');
        }
      }
    );
    expect(() => uuid(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
  it('rejects unreadable connect descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('connect getter');
        }
      }
    );
    expect(() => connect(unreadable as never).install(context().context)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    );
  });
});
