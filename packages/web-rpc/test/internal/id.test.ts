import { afterEach, describe, expect, it, vi } from 'vitest';
import { allocateRpcId } from '../../src/internal/id.js';
import type { IWebRpcUuidConfig } from '../../src/typing.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateRpcId', () => {
  it('uses fallback when generator is absent', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fallback' });

    expect(allocateRpcId({}, 'message', 'sender', 'target', () => false)).toBe(
      'MESSAGE:sender:fallback'
    );
  });

  it('reads a changing generator getter once before invoking the first value', () => {
    let reads = 0;
    const config = {
      get generate() {
        reads += 1;
        if (reads === 1) return () => 'first';
        throw new Error('second getter read');
      }
    } as unknown as IWebRpcUuidConfig;

    expect(allocateRpcId(config, 'message', 'sender', 'target', () => false)).toBe(
      'MESSAGE:sender:first'
    );
    expect(reads).toBe(1);
  });

  it('codes a generator getter failure and preserves its cause', () => {
    const cause = new Error('generator getter');
    const config = {
      get generate() {
        throw cause;
      }
    } as unknown as IWebRpcUuidConfig;

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        cause
      })
    );
  });

  it('codes a revoked generator descriptor instead of leaking its TypeError', () => {
    const revoked = Proxy.revocable({ generate: () => 'revoked' }, {});
    revoked.revoke();

    expect(() => allocateRpcId(revoked.proxy, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
  });

  it('rejects a configured non-callable generator before invoking it', () => {
    const config = { generate: 42 } as unknown as IWebRpcUuidConfig;

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: 'UUID generator must be a function'
      })
    );
  });

  it('codes a generator invocation failure and preserves an Error cause', () => {
    const cause = new Error('generator invocation');
    const config: IWebRpcUuidConfig = {
      generate: () => {
        throw cause;
      }
    };

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: 'UUID generator invocation failed',
        cause
      })
    );
  });

  it('codes a non-Error generator invocation failure and preserves the thrown value', () => {
    const cause = Object.freeze({ reason: 'hostile generator failure' });
    const config: IWebRpcUuidConfig = {
      generate: () => {
        throw cause;
      }
    };

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG', cause })
    );
  });

  it.each([null, undefined, '', 42, {}, true])(
    'rejects configured generator result %s',
    (result) => {
      const config = {
        generate: () => result
      } as IWebRpcUuidConfig;

      expect(() => allocateRpcId(config, 'task', 'sender', 'target', () => false)).toThrow(
        expect.objectContaining({
          code: 'INVALID_CONFIG',
          message: 'UUID generator must return a non-empty string'
        })
      );
    }
  );

  it('rejects a Promise returned by a synchronous generator as an invalid result', () => {
    const config = {
      generate: () => Promise.resolve('async-id')
    } as unknown as IWebRpcUuidConfig;

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => false)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: 'UUID generator must return a non-empty string'
      })
    );
  });

  it('rejects a generated identifier collision', () => {
    const config: IWebRpcUuidConfig = { generate: () => 'collision' };

    expect(() => allocateRpcId(config, 'message', 'sender', 'target', () => true)).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: 'UUID conflict: MESSAGE:sender:collision'
      })
    );
  });
});
