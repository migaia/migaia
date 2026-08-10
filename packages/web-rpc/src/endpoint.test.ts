import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from './endpoint';
import type { IWebRpcTransport } from './transport';
import { contract } from './middleware/contract';

function pair(): readonly [IWebRpcTransport, IWebRpcTransport] {
  const left = new Set<(message: unknown) => void>();
  const right = new Set<(message: unknown) => void>();
  let closed = false;
  const make = (
    senders: Set<(message: unknown) => void>,
    receivers: Set<(message: unknown) => void>
  ): IWebRpcTransport => ({
    send(message) {
      if (closed) throw new Error('closed');
      queueMicrotask(() => {
        for (const listener of [...senders]) listener(message);
      });
    },
    subscribe(listener) {
      receivers.add(listener);
      return () => receivers.delete(listener);
    },
    close() {
      closed = true;
    }
  });
  return [make(right, left), make(left, right)];
}

describe('WebRpcEndpoint', () => {
  it('supports bidirectional request/response and dispatch event', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      add: (ctx) => ctx.success((ctx.data as number) + 1)
    });
    const events: unknown[] = [];
    b.on('notify', (ctx) => {
      events.push(ctx.data);
    });
    expect(await a.send<number>('b', 'add', 2)).toBe(3);
    a.dispatch('b', 'notify', { ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([{ ok: true }]);
    await a.dispose();
    await b.dispose();
  });
  it('rejects duplicate providers and aborts pending send', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>('b', bTransport);
    b.provide('slow', async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ctx.success('late');
    });
    b.provide('dup', () => ({ ok: true }));
    expect(() => b.provide('dup', () => ({ ok: true }))).toThrow('already registered');
    const controller = new AbortController();
    const pending = a.send('b', 'slow', null, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await a.dispose();
    await b.dispose();
  });
  it('validates contract data through the independent schema error', async () => {
    const [aTransport, bTransport] = pair();
    const schema = {
      parse(value: unknown): number {
        if (typeof value !== 'number') throw new Error('number expected');
        return value;
      }
    };
    const config = contract({ schemas: { add: { params: schema, result: schema } } });
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, config.contract);
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { add: (ctx) => ctx.success((ctx.data as number) + 1) },
      config.contract
    );
    await expect(a.send('b', 'add', 'bad' as unknown as number)).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
      name: 'WebRpcSchemaValidationError'
    });
    await expect(a.send('b', 'add', 1)).resolves.toBe(2);
    await a.dispose();
    await b.dispose();
  });
  it('pings a peer without entering provider routing', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>('b', bTransport);
    await expect(a.ping('b')).resolves.toBe(true);
    await a.dispose();
    await b.dispose();
  });
  it('uses injected protocol encode/decode for contract messages', async () => {
    const [aTransport, bTransport] = pair();
    const encode = (value: unknown): unknown => ({ encoded: value });
    const decode = (value: unknown): unknown => (value as { encoded: unknown }).encoded;
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {}, { encode, decode });
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { add: (ctx) => ctx.success((ctx.data as number) + 1) },
      {},
      { encode, decode }
    );
    await expect(a.send('b', 'add', 1)).resolves.toBe(2);
    await a.dispose();
    await b.dispose();
  });
  it('aborts an active remote provider', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    let aborted = false;
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      slow: async (ctx) => {
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          )
        );
        return ctx.success();
      }
    });
    const controller = new AbortController();
    const pending = a.send('b', 'slow', null, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
    await a.dispose();
    await b.dispose();
  });
  it('reassembles chunk frames before decoding', async () => {
    const [aTransport, bTransport] = pair();
    const encode = (value: unknown): string => JSON.stringify(value);
    const decode = (value: unknown): unknown => JSON.parse(String(value));
    const chunk = { chunkSize: 8 };
    const a = new WebRpcEndpoint<'b'>(
      'a',
      aTransport,
      undefined,
      {},
      {},
      { encode, decode },
      {},
      {},
      chunk
    );
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { echo: (ctx) => ctx.success(ctx.data) },
      {},
      {},
      { encode, decode },
      {},
      {},
      chunk
    );
    await expect(a.send('b', 'echo', { value: 'chunked payload' })).resolves.toEqual({
      value: 'chunked payload'
    });
    await a.dispose();
    await b.dispose();
  });
  it('uses initial targetIds for fan-out and ping snapshots', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {}, {}, {}, {}, {}, [], ['b']);
    const b = new WebRpcEndpoint<'a'>('b', bTransport, { echo: (ctx) => ctx.success(ctx.data) });
    await expect(a.pingAll()).resolves.toEqual({ b: true });
    await expect(a.sendAll('echo', 'ok')).resolves.toEqual({ b: 'ok' });
    await a.dispose();
    await b.dispose();
  });
});
