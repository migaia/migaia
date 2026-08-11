import { describe, expect, it, vi } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import type { IWebRpcTransport } from '../src/transport';

/** Creates a quiescent exclusive transport for public preflight tests. */
const transport = (): IWebRpcTransport => ({
  platform: 'Memory',
  topology: 'exclusive',
  send() {},
  subscribe: () => () => undefined
});

describe('endpoint public boundary', () => {
  it('rejects malformed and duplicate callback registration', async () => {
    const endpoint = new WebRpcEndpoint('host', transport());
    expect(() => endpoint.hooks.on(true as never)).toThrow('hook listener');
    expect(() => endpoint.provide('', () => ({ ok: true }))).toThrow('method');
    expect(() => endpoint.provide('method', true as never)).toThrow('provider');
    endpoint.provide('method', () => ({ ok: true }));
    expect(() => endpoint.provide('method', () => ({ ok: true }))).toThrow(
      'Provider already registered'
    );
    expect(() => endpoint.on('', () => undefined)).toThrow('method');
    expect(() => endpoint.on('event', true as never)).toThrow('event listener');
    const stop = endpoint.on('event', () => undefined);
    stop();
    stop();
    await endpoint.dispose();
  });

  it('runs synchronous validation before send and dispatch allocate work', async () => {
    const validateData = vi.fn((method: string, _side: string, data: unknown) => {
      if (data === 'invalid') throw new Error(`${method} invalid`);
    });
    const endpoint = new WebRpcEndpoint('host', transport(), undefined, {
      targetIds: ['peer'],
      contract: { maxIdentifierLength: 8, validateData },
      features: { abort: true, ping: false }
    } as never);
    await expect(endpoint.send('too-long-id' as never, 'method', null)).rejects.toThrow('targetId');
    await expect(endpoint.send('peer', '', null)).rejects.toThrow('method');
    await expect(endpoint.send('peer', 'too-long-method', null)).rejects.toThrow('method');
    await expect(endpoint.send('peer', 'method', 'invalid')).rejects.toThrow('method invalid');
    expect(() => endpoint.dispatch('too-long-id' as never, 'method', null)).toThrow('targetId');
    expect(() => endpoint.dispatch('peer', '', null)).toThrow('method');
    expect(() => endpoint.dispatchAll('', null)).toThrow('method');
    expect(() => endpoint.ping('peer')).toThrow('ping middleware');
    await endpoint.dispose();
    expect(validateData).toHaveBeenCalled();
  });

  it('validates pinning controls and memoizes control facades', async () => {
    const endpoint = new WebRpcEndpoint('host', transport());
    expect(endpoint.connect).toBe(endpoint.connect);
    expect(endpoint.discovery).toBe(endpoint.discovery);
    expect(Object.isFrozen(endpoint.connect.getServerList())).toBe(true);
    expect(() => endpoint.connect.pinReceiver('peer', 'missing')).toThrow('Unknown receiver');
    expect(() => endpoint.connect.unpinReceiver('')).toThrow('targetId');
    await endpoint.dispose();
  });

  it('keeps optional manual ping absent when ping capability is disabled', async () => {
    const endpoint = new WebRpcEndpoint('host', transport(), undefined, {
      connect: { transport: transport(), discoveryMode: 'manual' },
      features: { ping: false }
    } as never);
    expect(endpoint.connect.ping).toBeUndefined();
    await endpoint.dispose();
  });

  it('makes disposal idempotent and rejects every later public mutation', async () => {
    const endpoint = new WebRpcEndpoint('host', transport());
    const first = endpoint.dispose();
    const second = endpoint.dispose();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(() => endpoint.hooks.on(() => undefined)).toThrow('disposed');
    expect(() => endpoint.provide('method', () => ({ ok: true }))).toThrow('disposed');
    expect(() => endpoint.on('event', () => undefined)).toThrow('disposed');
    expect(() => endpoint.dispatch('peer', 'event', null)).toThrow('disposed');
    expect(() => endpoint.dispatchAll('event', null)).toThrow('disposed');
    expect(() => endpoint.discovery.getServerList()).toThrow('disposed');
    await expect(endpoint.send('peer', 'method', null)).rejects.toThrow('disposed');
    await expect(endpoint.pingAll()).rejects.toThrow('disposed');
  });
});
