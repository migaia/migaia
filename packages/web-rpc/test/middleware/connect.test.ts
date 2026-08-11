import { describe, expect, it } from 'vitest';
import { connect } from '../../src/middleware/connect';

describe('connect middleware', () => {
  it('installs peer verification capability', async () => {
    const values = new Map<string, unknown>();
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    };
    connect({ transport }).install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>;
    };
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true);
    await expect(capability.verify({ senderId: 'other', targetId: 'a' })).resolves.toBe(false);
    await expect(capability.verify({ senderId: 'trusted', targetId: 'other' })).resolves.toBe(
      false
    );
  });
  it('uses base verification by default and only invokes identifier when explicitly enabled', async () => {
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    };
    let calls = 0;
    const base = connect({
      transport,
      identifier: () => {
        calls += 1;
        return false;
      }
    });
    const values = new Map<string, unknown>();
    base.install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>;
    };
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true);
    expect(calls).toBe(0);
    expect(() =>
      connect({ transport, useBaseIdVerifyOnly: false }).install({
        id: 'a',
        transport,
        hooks: () => undefined,
        capabilities: {
          set() {},
          get: () => undefined
        }
      })
    ).toThrow('identifier is required');
  });
  it('rejects source-only base identity without a configured peer or origin', async () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined };
    const values = new Map<string, unknown>();
    connect({ transport }).install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('connectCapability') as {
      verify(context: {
        senderId: string;
        targetId: string;
        source?: unknown;
      }): boolean | Promise<boolean>;
    };
    await expect(capability.verify({ senderId: 'peer', targetId: 'a', source: {} })).resolves.toBe(
      false
    );
  });
  it('rejects a non-boolean base verification option during installation', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined };
    expect(() =>
      connect({ transport, useBaseIdVerifyOnly: 'yes' as never }).install({
        id: 'a',
        transport,
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('useBaseIdVerifyOnly must be a boolean');
  });
  it('ignores logical target uniqueness unless verified identifier mode is active', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined };
    const values = new Map<string, unknown>();
    connect({ transport, uniqueTargetId: 'tab-a' }).install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: { set: (name, value) => values.set(name, value), get: () => undefined }
    });
    expect((values.get('connectCapability') as { uniqueTargetId?: string }).uniqueTargetId).toBe(
      undefined
    );
  });
  it('rejects a primitive transport during installation', () => {
    expect(() =>
      connect({ transport: 'not-a-transport' as never }).install({
        id: 'a',
        transport: 'not-a-transport' as never,
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('connect transport is required');
  });
  it('rejects an incomplete transport during installation', () => {
    expect(() =>
      connect({ transport: {} as never }).install({
        id: 'a',
        transport: {} as never,
        hooks: () => undefined,
        capabilities: { set() {}, get: () => undefined }
      })
    ).toThrow('connect transport must provide send and subscribe functions');
  });
  it('does not read mutable verification policy after installation', async () => {
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    };
    const config: { transport: typeof transport; useBaseIdVerifyOnly?: boolean } = { transport };
    const values = new Map<string, unknown>();
    connect(config).install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    config.useBaseIdVerifyOnly = false;
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>;
    };
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true);
  });
  it('snapshots discovery mode before installation', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined };
    const config: { transport: typeof transport; discoveryMode?: 'automatic' | 'manual' } = {
      transport,
      discoveryMode: 'manual'
    };
    const values = new Map<string, unknown>();
    connect(config).install({
      id: 'a',
      transport,
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    config.discoveryMode = 'automatic';
    expect((values.get('connectCapability') as { discoveryMode?: string }).discoveryMode).toBe(
      'manual'
    );
  });
});
