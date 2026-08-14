import { describe, expect, it, vi } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import { WebRpcErrorCode, WebRpcLifecycleError, WebRpcSchemaValidationError } from '../src/errors';
import { createMemoryTransportPair } from '../src/adapters/memory';
import { createBroadcastChannelTransport } from '../src/adapters/broadcast-channel';
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../src/transport';

type IWebRpcReceiverAnnouncement = {
  readonly kind: 'register' | 'unregister';
  readonly targetId: string;
  readonly receiverId: string;
  readonly platform: 'Memory' | 'BroadcastChannel';
  readonly origin?: string;
  readonly uniqueTargetId?: string;
  readonly registeredAt: number;
};

type ILegacyAnnouncementTransport = IWebRpcTransport & {
  announceReceiver?: (announcement: IWebRpcReceiverAnnouncement) => void;
  onReceiverAnnouncement?: (
    listener: (announcement: IWebRpcReceiverAnnouncement) => void
  ) => () => void;
  verifyReceiverAnnouncement?: (announcement: IWebRpcReceiverAnnouncement) => boolean;
};

function pair(): readonly [IWebRpcTransport, IWebRpcTransport] {
  const left = new Set<(message: IWebRpcInboundMessage<unknown>) => void>();
  const right = new Set<(message: IWebRpcInboundMessage<unknown>) => void>();
  let closed = false;
  const make = (
    senders: Set<(message: IWebRpcInboundMessage<unknown>) => void>,
    receivers: Set<(message: IWebRpcInboundMessage<unknown>) => void>,
    peerId: string
  ): IWebRpcTransport => ({
    platform: 'Memory',
    send(message) {
      if (closed) throw new Error('closed');
      queueMicrotask(() => {
        for (const listener of Array.from(senders))
          listener(message as IWebRpcInboundMessage<unknown>);
      });
    },
    subscribe(listener) {
      receivers.add(listener);
      return () => receivers.delete(listener);
    },
    close() {
      closed = true;
    },
    peerId
  });
  return [make(right, left, 'b'), make(left, right, 'a')];
}

describe('WebRpcEndpoint', () => {
  it('bootstraps default discovery over a real anonymous BroadcastChannel', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channelName = `web-rpc-${Math.random().toString(36).slice(2)}`;
    const serverChannel = new BroadcastChannel(channelName);
    const clientChannel = new BroadcastChannel(channelName);
    const server = new WebRpcEndpoint('server', createBroadcastChannelTransport(serverChannel), {
      echo: (context) => context.success(context.data)
    });
    const client = new WebRpcEndpoint(
      'client',
      createBroadcastChannelTransport(clientChannel),
      undefined,
      {
        targetIds: ['server']
      }
    );
    try {
      await expect(client.send('server', 'echo', 'broadcast')).resolves.toBe('broadcast');
    } finally {
      await client.dispose();
      await server.dispose();
      clientChannel.close();
      serverChannel.close();
    }
  });

  it('emits local receiver unregistration before discovery state is closed', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const events: string[] = [];
    const server = new WebRpcEndpoint<'client'>(
      'server',
      serverTransport,
      {
        echo: (context) => context.success(context.data)
      },
      {
        hooks: {
          listeners: (event) => {
            if (event.name === 'connect.server-unregistered') events.push(event.name);
          }
        }
      }
    );
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      targetIds: ['server']
    });
    await expect(client.send('server', 'echo', 'value')).resolves.toBe('value');
    await server.dispose();
    expect(events).toEqual(['connect.server-unregistered']);
    await client.dispose();
  });

  it('does not treat a multiplexed Worker-like transport as exclusive', async () => {
    const [baseClient, baseServer] = pair();
    const clientTransport = { ...baseClient, peerId: undefined, topology: 'multiplexed' as const };
    const serverTransport = { ...baseServer, peerId: undefined, topology: 'multiplexed' as const };
    let calls = 0;
    const server = new WebRpcEndpoint(
      'server',
      serverTransport,
      {
        echo: (context) => {
          calls += 1;
          return context.success(context.data);
        }
      },
      { connect: { transport: serverTransport } }
    );
    const client = new WebRpcEndpoint('client', clientTransport, undefined, {
      connect: { transport: clientTransport },
      timeout: { timeoutMs: 20 }
    });
    await expect(client.send('server', 'echo', 'spoof')).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED'
    });
    expect(calls).toBe(0);
    await client.dispose();
    await server.dispose();
  });

  it('does not trust an unclassified Worker-like transport as exclusive', async () => {
    const [baseClient, baseServer] = pair();
    const clientTransport = { ...baseClient, platform: 'Worker' as const, peerId: undefined };
    const serverTransport = { ...baseServer, platform: 'Worker' as const, peerId: undefined };
    let calls = 0;
    const server = new WebRpcEndpoint(
      'server',
      serverTransport,
      {
        echo: (context) => {
          calls += 1;
          return context.success(context.data);
        }
      },
      { connect: { transport: serverTransport } }
    );
    const client = new WebRpcEndpoint('client', clientTransport, undefined, {
      connect: { transport: clientTransport },
      timeout: { timeoutMs: 20 }
    });
    await expect(client.send('server', 'echo', 'unclassified')).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED'
    });
    expect(calls).toBe(0);
    await client.dispose();
    await server.dispose();
  });

  it('reuses verified BroadcastChannel identity for the business request', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channelName = `web-rpc-unique-${Math.random().toString(36).slice(2)}`;
    const serverChannel = new BroadcastChannel(channelName);
    const clientChannel = new BroadcastChannel(channelName);
    const serverTransport = createBroadcastChannelTransport(serverChannel);
    const clientTransport = createBroadcastChannelTransport(clientChannel);
    const server = new WebRpcEndpoint(
      'server',
      serverTransport,
      {
        echo: (context) => context.success(context.data)
      },
      {
        connect: {
          transport: serverTransport,
          useBaseIdVerifyOnly: false,
          uniqueTargetId: 'server-token',
          identifier: ({ data }) =>
            !!data &&
            typeof data === 'object' &&
            (data as { __unique_id__?: unknown }).__unique_id__ === 'client-token'
        }
      }
    );
    const client = new WebRpcEndpoint('client', clientTransport, undefined, {
      connect: {
        transport: clientTransport,
        useBaseIdVerifyOnly: false,
        uniqueTargetId: 'client-token',
        identifier: ({ data }) =>
          !!data &&
          typeof data === 'object' &&
          (data as { __unique_id__?: unknown }).__unique_id__ === 'server-token'
      }
    });
    try {
      await expect(client.send('server', 'echo', 'unique')).resolves.toBe('unique');
    } finally {
      await client.dispose();
      await server.dispose();
      clientChannel.close();
      serverChannel.close();
    }
  });

  it('omits its own id from configured fan-out targets', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'self' | 'remote'>('self', transport, undefined, {
      targetIds: ['self', 'remote', 'remote']
    });
    expect(endpoint.discovery.getServerList()).toEqual([]);
    await expect(endpoint.sendAll('missing', null, { timeoutMs: 0 })).resolves.toMatchObject({
      fulfilled: {},
      rejected: { '["target","remote"]': expect.anything() }
    });
    await endpoint.dispose();
  });

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
  it('WR-R3-3 fixed: dispatch-only ids are released after send settles, so repeated dispatch() never exhausts a small replay budget', async () => {
    const [aTransport, bTransport] = pair();
    const failures: unknown[] = [];
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      // Deliberately tiny: a request's taskId is intentionally NOT released on settlement (it
      // must survive for the replay TTL so a late/duplicate response can't be replayed against
      // a reused id) — only dispatch-only ids are released right after send. If that release
      // did not happen, the 6th of these dispatch() calls would exceed maxEntries and surface
      // as a 'dispatch.failure' hook event.
      replay: { maxEntries: 2, ttlMs: 60_000 },
      hooks: {
        listeners: (event) => {
          if (event.name === 'dispatch.failure') failures.push(event);
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport);
    const events: unknown[] = [];
    b.on('notify', (ctx) => {
      events.push(ctx.data);
    });

    // Spaced out rather than fired in one synchronous burst: release happens once #send's own
    // promise chain settles (a few microtasks in), not synchronously within dispatch() itself,
    // so back-to-back calls with no yield between them would still transiently exhaust a
    // 2-entry budget regardless of the fix. What this proves is that the budget recovers between
    // sends instead of being held forever like a regular request's taskId would be.
    for (let index = 0; index < 6; index += 1) {
      a.dispatch('b', 'notify', index);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(failures).toEqual([]);
    expect(events).toEqual([0, 1, 2, 3, 4, 5]);
    await a.dispose();
    await b.dispose();
  });
  it('releases chunk message ids after chunked dispatch settles', async () => {
    const [aTransport, bTransport] = pair();
    const failures: unknown[] = [];
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      chunk: { chunkSize: 4 },
      // One slot is occupied by the dispatch task while its chunk message is in flight.
      replay: { maxEntries: 2, ttlMs: 60_000 },
      hooks: {
        listeners: (event) => {
          if (event.name === 'dispatch.failure') failures.push(event);
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, undefined, {
      chunk: { chunkSize: 4 }
    });
    const events: unknown[] = [];
    b.on('notify', (context) => {
      events.push(context.data);
    });
    try {
      for (let index = 0; index < 4; index += 1) {
        a.dispatch('b', 'notify', `dispatch-${index}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(failures).toEqual([]);
      expect(events).toEqual(['dispatch-0', 'dispatch-1', 'dispatch-2', 'dispatch-3']);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
  it('discovers endpoint ids lazily before the first request', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    expect(a.connect.query).toBeUndefined();
    await expect(a.send('b', 'echo', 'discovered')).resolves.toBe('discovered');
    expect(a.discovery.getServerList('b')).toHaveLength(1);
    await a.dispose();
    await b.dispose();
  });
  it('bounds concurrent automatic discovery admissions', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'missing'>('client', transport);
    const results = await Promise.all(
      Array.from({ length: 130 }, () =>
        endpoint.send('missing', 'echo', null, { timeoutMs: 50 }).then(
          () => 'resolved',
          (error: { code?: string }) => error.code ?? 'error'
        )
      )
    );
    expect(results).toContain('OVERLOADED');
    await endpoint.dispose();
  });
  it('uses receiverSelector for single-target operations after discovery', async () => {
    const [aTransport, bTransport] = pair();
    let calls = 0;
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        receiverSelector: (serverList, context) => {
          calls += 1;
          expect(context).toMatchObject({ endpointId: 'a', targetId: 'b', operation: 'send' });
          return serverList[0]?.receiverId;
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(a.send('b', 'echo', 'selected')).resolves.toBe('selected');
    expect(calls).toBe(1);
    await a.dispose();
    await b.dispose();
  });
  it('does not commit a request when disposal wins a pending receiver selection', async () => {
    const [aTransport, bTransport] = pair();
    let selectStarted: (() => void) | undefined;
    let releaseSelection: (() => void) | undefined;
    let providerCalls = 0;
    const selectionStarted = new Promise<void>((resolve) => {
      selectStarted = resolve;
    });
    const selectionReleased = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        receiverSelector: async (serverList) => {
          selectStarted?.();
          await selectionReleased;
          return serverList[0]?.receiverId;
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => {
        providerCalls += 1;
        return ctx.success(ctx.data);
      }
    });
    const pending = a.send('b', 'echo', 'late');
    await selectionStarted;
    await a.dispose();
    releaseSelection?.();
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(providerCalls).toBe(0);
    await b.dispose();
  });
  it('does not commit dispatch when disposal wins a pending receiver selection', async () => {
    const [aTransport, bTransport] = pair();
    let selectStarted: (() => void) | undefined;
    let releaseSelection: (() => void) | undefined;
    let providerCalls = 0;
    const selectionStarted = new Promise<void>((resolve) => {
      selectStarted = resolve;
    });
    const selectionReleased = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        receiverSelector: async (serverList) => {
          selectStarted?.();
          await selectionReleased;
          return serverList[0]?.receiverId;
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      notify: (ctx) => {
        providerCalls += 1;
        return ctx.success(ctx.data);
      }
    });
    a.dispatch('b', 'notify', 'late');
    await selectionStarted;
    await a.dispose();
    releaseSelection?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(providerCalls).toBe(0);
    await b.dispose();
  });
  it('settles ping without sending when disposal wins a pending receiver selection', async () => {
    const [aTransport, bTransport] = pair();
    let selectStarted: (() => void) | undefined;
    let releaseSelection: (() => void) | undefined;
    const selectionStarted = new Promise<void>((resolve) => {
      selectStarted = resolve;
    });
    const selectionReleased = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        receiverSelector: async (serverList) => {
          selectStarted?.();
          await selectionReleased;
          return serverList[0]?.receiverId;
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport);
    const pending = a.ping('b');
    await selectionStarted;
    await a.dispose();
    releaseSelection?.();
    await expect(pending).resolves.toBe(false);
    await b.dispose();
  });
  it('falls back to the normal receiver when selector returns undefined', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: { transport: aTransport, receiverSelector: () => undefined }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(a.send('b', 'echo', 'fallback')).resolves.toBe('fallback');
    await a.dispose();
    await b.dispose();
  });
  it.each([null, 'missing-receiver'] as const)(
    'rejects selector result %s when it cannot identify an active receiver',
    async (selected) => {
      const [aTransport, bTransport] = pair();
      const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
        connect: {
          transport: aTransport,
          receiverSelector: () => selected as unknown as string
        }
      });
      const b = new WebRpcEndpoint<'a'>('b', bTransport, {
        echo: (ctx) => ctx.success(ctx.data)
      });
      const result = a.send('b', 'echo', 'invalid', { timeoutMs: 20 });
      await expect(result).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' });
      await a.dispose();
      await b.dispose();
    }
  );
  it('keeps a same-named remote receiver distinct from the local receiver', async () => {
    let onReceiverAnnouncement: ((announcement: IWebRpcReceiverAnnouncement) => void) | undefined;
    const transport: ILegacyAnnouncementTransport = {
      platform: 'Memory',
      send() {},
      subscribe() {
        return () => undefined;
      },
      onReceiverAnnouncement(listener) {
        onReceiverAnnouncement = listener;
        return () => undefined;
      }
    };
    const endpoint = new WebRpcEndpoint<'same'>('same', transport);
    const pending = endpoint.send('same', 'echo', null);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    onReceiverAnnouncement?.({
      kind: 'register',
      targetId: 'same',
      receiverId: 'same-remote',
      platform: 'Memory',
      registeredAt: 1
    });
    expect(endpoint.discovery.getServerList('same')).toEqual([]);
    await endpoint.dispose();
    await expect(pending).rejects.toBeInstanceOf(WebRpcLifecycleError);
  });
  it('contains automatic discovery response send failures', async () => {
    const [clientTransport, rawServerTransport] = createMemoryTransportPair();
    const serverTransport = {
      ...rawServerTransport,
      send() {
        throw new Error('discovery response failed');
      }
    };
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    const pending = client.send('server', 'echo', 'late');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await server.dispose();
    await client.dispose();
    await expect(pending).rejects.toBeDefined();
  });
  it('does not expose manual target registration controls', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('client', transport);
    expect('registerTarget' in endpoint.connect).toBe(false);
    expect('unregisterTarget' in endpoint.connect).toBe(false);
    await endpoint.dispose();
  });
  it('does not project local receiver announcements into remote DNS', async () => {
    let announceListener: ((announcement: IWebRpcReceiverAnnouncement) => void) | undefined;
    const transport: ILegacyAnnouncementTransport = {
      platform: 'Memory',
      send() {},
      subscribe() {
        return () => undefined;
      },
      onReceiverAnnouncement(listener) {
        announceListener = listener;
        return () => undefined;
      }
    };
    const endpoint = new WebRpcEndpoint<'client'>('client', transport);
    announceListener?.({
      kind: 'register',
      targetId: 'client',
      receiverId: 'client',
      platform: 'BroadcastChannel',
      registeredAt: 1
    });
    expect(endpoint.discovery.getServerList()).toEqual([]);
    await endpoint.dispose();
  });
  it('supports manual discovery query, acceptance, and explicit DNS registration', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      connect: {
        transport: clientTransport,
        discoveryMode: 'manual',
        verify: () => true
      }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: {
        transport: serverTransport,
        discoveryMode: 'manual',
        verify: () => true
      }
    });
    const manual = client.connect;
    const serverManual = server.connect;
    expect(manual.query).toBeTypeOf('function');
    expect(manual.onQuery).toBeTypeOf('function');
    expect(manual.register).toBeTypeOf('function');
    expect(manual.unregister).toBeTypeOf('function');
    expect(manual.ping).toBeTypeOf('function');
    expect(client.discovery.getServerList('server')).toEqual([]);
    const aborted = new AbortController();
    aborted.abort();
    await expect(manual.query?.('server', { signal: aborted.signal })).rejects.toThrow(
      'Discovery aborted'
    );
    expect(() => serverManual.onQuery?.(true as never)).toThrow(
      'query listener must be a function'
    );
    const querySeen = new Promise<void>((resolve) => {
      serverManual.onQuery?.((query) =>
        query.accept({ __unique_id__: 'attacker' }).then(() => resolve())
      );
    });
    expect(() => serverManual.onQuery?.(() => undefined)).toThrow('only one manual query listener');
    const candidatesPromise = manual.query?.('server', { timeoutMs: 50 });
    await querySeen;
    const candidates = await candidatesPromise!;
    expect(candidates).toHaveLength(1);
    expect(Object.isFrozen(candidates[0])).toBe(true);
    await expect(manual.ping?.(candidates[0]!)).resolves.toBe(true);
    expect(client.discovery.getServerList('server')).toEqual([]);
    expect((candidates[0]!.data as { __unique_id__?: string }).__unique_id__).toBeUndefined();
    expect(() => manual.register?.({ ...candidates[0]! })).toThrow(
      'not produced by a verified manual query'
    );
    manual.register?.(candidates[0]!);
    expect(client.discovery.getServerList('server')[0]?.uniqueTargetId).toBeUndefined();
    expect(() => manual.register?.(candidates[0]!)).toThrow(
      'not produced by a verified manual query'
    );
    manual.pinReceiver?.('server', candidates[0]!.receiverId!);
    expect(client.discovery.getServerList('server')).toMatchObject([{ pinned: true }]);
    await manual.unregister?.('server', candidates[0]!.receiverId);
    expect(client.discovery.getServerList('server')).toEqual([]);
    await client.dispose();
    await server.dispose();
  });
  it('supports manual discovery rejection with an explicit reason', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      connect: { transport: clientTransport, discoveryMode: 'manual', verify: () => true }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    const rejected = new Promise<void>((resolve) => {
      server.connect.onQuery?.((query) => {
        void query.reject('not available').then(() => resolve());
      });
    });
    await expect(client.connect.query?.('server', { timeoutMs: 50 })).resolves.toEqual([]);
    await rejected;
    await client.dispose();
    await server.dispose();
  });
  it('rejects a manual query reason with an invalid runtime type', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      connect: { transport: clientTransport, discoveryMode: 'manual', verify: () => true }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    const failure = new Promise<unknown>((resolve) => {
      server.connect.onQuery?.((query) => {
        void query.reject(123 as never).catch(resolve);
      });
    });
    const pending = client.connect.query?.('server', { timeoutMs: 20 });
    await expect(failure).resolves.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(pending).resolves.toEqual([]);
    await client.dispose();
    await server.dispose();
  });
  it('cancels manual discovery windows and releases their waiters', async () => {
    const [clientTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'missing'>('client', clientTransport, undefined, {
      connect: {
        transport: clientTransport,
        discoveryMode: 'manual',
        verify: () => true
      }
    });
    const controller = new AbortController();
    const pending = client.connect.query?.('missing', {
      timeoutMs: 1000,
      signal: controller.signal
    });
    controller.abort();
    await expect(pending).rejects.toThrow('Discovery aborted');
    await expect(client.connect.query?.('missing', { timeoutMs: 0 })).resolves.toEqual([]);
    await client.dispose();
  });
  it('rejects invalid manual discovery deadlines before allocating a waiter', async () => {
    const [transport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'missing'>('client', transport, undefined, {
      connect: { transport, discoveryMode: 'manual', verify: () => true }
    });
    await expect(
      client.connect.query?.('missing', { timeoutMs: Number.NaN })
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await expect(client.connect.query?.('missing', { timeoutMs: -1 })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await client.dispose();
  });
  it('does not send manual discovery when abort fires during listener registration', async () => {
    const [transport] = createMemoryTransportPair();
    let sends = 0;
    const sendingTransport: IWebRpcTransport = {
      ...transport,
      send(message, options) {
        sends += 1;
        return transport.send(message, options);
      }
    };
    const client = new WebRpcEndpoint<'missing'>('client', sendingTransport, undefined, {
      connect: {
        transport: sendingTransport,
        discoveryMode: 'manual',
        verify: () => true
      }
    });
    const signal = {
      aborted: false,
      addEventListener(_type: 'abort', listener: () => void) {
        listener();
      },
      removeEventListener() {}
    };
    await expect(client.connect.query?.('missing', { timeoutMs: 1000, signal })).rejects.toThrow(
      'Discovery aborted'
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sends).toBe(0);
    await client.dispose();
  });
  it('rolls back a manual discovery session when the query send fails synchronously', async () => {
    let sends = 0;
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      send() {
        sends += 1;
        if (sends === 1) throw new Error('manual query send failed');
      },
      subscribe() {
        return () => undefined;
      }
    };
    const endpoint = new WebRpcEndpoint('client', transport, undefined, {
      connect: { transport, discoveryMode: 'manual', verify: () => true }
    });
    await expect(endpoint.connect.query?.('missing', { timeoutMs: 50 })).rejects.toThrow(
      'Transport send failed'
    );
    await expect(endpoint.connect.query?.('missing', { timeoutMs: 0 })).resolves.toEqual([]);
    await endpoint.dispose();
  });
  it('does not overwrite an active inbound manual query session on id collision', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    let queries = 0;
    server.connect.onQuery?.(() => {
      queries += 1;
    });
    const query = {
      kind: 'discovery-query' as const,
      taskId: 'reused-query-id',
      senderId: 'client',
      targetId: 'server',
      sentAt: Date.now(),
      manual: true
    };
    clientTransport.send(query);
    clientTransport.send(query);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(queries).toBe(1);
    await server.dispose();
  });
  it('rejects replay of an accepted manual query session', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    let queries = 0;
    let accepted!: () => void;
    const acceptedPromise = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    server.connect.onQuery?.((query) => {
      queries += 1;
      void query.accept().then(accepted);
    });
    const query = {
      kind: 'discovery-query' as const,
      taskId: 'replayed-query-id',
      senderId: 'client',
      targetId: 'server',
      sentAt: Date.now(),
      manual: true
    };
    clientTransport.send(query);
    await acceptedPromise;
    clientTransport.send(query);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(queries).toBe(1);
    await server.dispose();
  });
  it('ignores malformed unique ids supplied by manual accept', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      connect: { transport: clientTransport, discoveryMode: 'manual', verify: () => true }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    server.connect.onQuery?.((query) => {
      void query.accept({ __unique_id__: 42 });
    });
    await expect(client.connect.query?.('server', { timeoutMs: 10 })).resolves.toMatchObject([
      { data: {} }
    ]);
    await client.dispose();
    await server.dispose();
  });
  it('ignores empty unique ids supplied by manual accept', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      connect: { transport: clientTransport, discoveryMode: 'manual', verify: () => true }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    server.connect.onQuery?.((query) => {
      void query.accept({ __unique_id__: '' });
    });
    await expect(client.connect.query?.('server', { timeoutMs: 10 })).resolves.toMatchObject([
      { data: {} }
    ]);
    await client.dispose();
    await server.dispose();
  });
  it('bounds inbound manual query sessions awaiting application decisions', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, undefined, {
      connect: { transport: serverTransport, discoveryMode: 'manual', verify: () => true }
    });
    let queries = 0;
    server.connect.onQuery?.(() => {
      queries += 1;
    });
    for (let index = 0; index < 129; index += 1)
      clientTransport.send({
        kind: 'discovery-query',
        taskId: `query-${index}`,
        senderId: 'client',
        targetId: 'server',
        sentAt: Date.now(),
        manual: true
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(queries).toBe(128);
    await server.dispose();
  });
  it('reports manual discovery abort-listener cleanup failures on dispose', async () => {
    const [transport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'missing'>('client', transport, undefined, {
      connect: { transport, discoveryMode: 'manual', verify: () => true }
    });
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        throw new Error('abort listener removal failed');
      }
    } as unknown as AbortSignal;
    const pending = client.connect.query?.('missing', { timeoutMs: 1000, signal });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const [queryResult, disposeResult] = await Promise.allSettled([pending, client.dispose()]);
    expect(queryResult.status).toBe('rejected');
    expect(disposeResult).toMatchObject({
      status: 'rejected',
      reason: {
        cleanupErrors: expect.arrayContaining([
          expect.objectContaining({ resource: 'manual discovery abort listener' })
        ])
      }
    });
  });
  it('requires application proof before reliable receiver unregister', async () => {
    const [rawClientTransport, serverTransport] = createMemoryTransportPair();
    let allowUnregister = false;
    const clientTransport = {
      ...rawClientTransport,
      verifyReceiverAnnouncement: () => allowUnregister
    };
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(client.send('server', 'echo', 'ok')).resolves.toBe('ok');
    const entry = client.discovery.getServerList('server')[0];
    expect(entry).toBeDefined();
    allowUnregister = true;
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'register',
      targetId: 'server',
      receiverId: entry?.receiverId ?? 'missing',
      platform: 'Memory',
      registeredAt: Date.now() + 600_001
    });
    expect(client.discovery.getServerList('server')[0]?.registeredAt).toBe(entry?.registeredAt);
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'register',
      targetId: 'server',
      receiverId: entry?.receiverId ?? 'missing',
      platform: 'Memory',
      registeredAt: Math.max(0, (entry?.registeredAt ?? 0) - 1)
    });
    expect(client.discovery.getServerList('server')[0]?.registeredAt).toBe(entry?.registeredAt);
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'unregister',
      targetId: 'server',
      receiverId: entry?.receiverId ?? 'missing',
      platform: 'Memory',
      registeredAt: Math.max(0, (entry?.registeredAt ?? 0) - 1)
    });
    expect(client.discovery.getServerList('server')).toHaveLength(1);
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'unregister',
      targetId: 'server',
      receiverId: entry?.receiverId ?? 'missing',
      platform: 'Memory',
      registeredAt: entry?.registeredAt ?? 0
    });
    expect(client.discovery.getServerList('server')).toHaveLength(1);
    await client.dispose();
    await server.dispose();
  });
  it('bounds discovered receivers per target', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint('client', {
      ...clientTransport,
      verifyReceiverAnnouncement: () => true
    } as ILegacyAnnouncementTransport);
    const server = new WebRpcEndpoint('server', serverTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(client.send('server', 'echo', null)).resolves.toBe(null);
    for (let index = 0; index < 65; index += 1)
      (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
        kind: 'register',
        targetId: 'server',
        receiverId: `receiver-${index}`,
        platform: 'Memory',
        registeredAt: index + 1
      });
    expect(client.discovery.getServerList('server')).toHaveLength(1);
    await client.dispose();
    await server.dispose();
  });
  it('ignores unsolicited receiver registration announcements', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint('client', {
      ...clientTransport,
      verifyReceiverAnnouncement: () => true
    } as ILegacyAnnouncementTransport);
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'register',
      targetId: 'ghost',
      receiverId: 'ghost-receiver',
      platform: 'Memory',
      registeredAt: 1
    });
    expect(client.discovery.getServerList('ghost')).toEqual([]);
    await client.dispose();
  });
  it('carries logical receiver identity in authenticated discovery data', async () => {
    const [aTransport, bTransport] = pair();
    const seen: unknown[] = [];
    const verify = ({ data }: { data?: unknown }): boolean => {
      if (data !== undefined) seen.push(data);
      return (
        data === undefined ||
        typeof data !== 'object' ||
        (data as { __unique_id__?: unknown }).__unique_id__ === undefined ||
        ['tab-a', 'tab-b'].includes((data as { __unique_id__?: unknown }).__unique_id__ as string)
      );
    };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        useBaseIdVerifyOnly: false,
        uniqueTargetId: 'tab-a',
        identifier: verify
      }
    });
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      {
        echo: (ctx) => ctx.success(ctx.data)
      },
      {
        connect: {
          transport: bTransport,
          useBaseIdVerifyOnly: false,
          uniqueTargetId: 'tab-b',
          identifier: verify
        }
      }
    );
    await expect(a.send('b', 'echo', 'unique')).resolves.toBe('unique');
    expect(seen).toContainEqual({ __unique_id__: 'tab-a' });
    expect(seen).toContainEqual({ __unique_id__: 'tab-b' });
    await a.dispose();
    await b.dispose();
  });
  it('collects multiple receivers answering one discovery query', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'service'>('client', clientTransport);
    const first = new WebRpcEndpoint<'service'>('service', serverTransport, {
      echo: (ctx) => ctx.success('first')
    });
    const second = new WebRpcEndpoint<'service'>('service', serverTransport, {
      echo: (ctx) => ctx.success('second')
    });
    await expect(client.send('service', 'echo', null)).resolves.toBe('first');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(client.discovery.getServerList('service')).toHaveLength(2);
    await client.dispose();
    await first.dispose();
    await second.dispose();
  });
  it('does not revive a lost pinned receiver through rediscovery', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(client.send('server', 'echo', 'before')).resolves.toBe('before');
    const receiverId = client.discovery.getServerList('server')[0]?.receiverId;
    expect(receiverId).toBeDefined();
    client.discovery.pinReceiver('server', receiverId as string);
    (serverTransport as unknown as ILegacyAnnouncementTransport).announceReceiver?.({
      kind: 'unregister',
      targetId: 'server',
      receiverId: receiverId as string,
      platform: 'Memory',
      registeredAt: client.discovery.getServerList('server')[0]?.registeredAt ?? 0
    });
    await expect(client.send('server', 'echo', 'blocked')).resolves.toBe('blocked');
    client.discovery.unpinReceiver('server');
    await expect(client.send('server', 'echo', 'after')).resolves.toBe('after');
    await client.dispose();
    await server.dispose();
  });
  it('retains a lost pinned receiver as a rejected fan-out delivery', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(client.send('server', 'echo', 'before')).resolves.toBe('before');
    const receiverId = client.discovery.getServerList('server')[0]?.receiverId;
    expect(receiverId).toBeDefined();
    client.discovery.pinReceiver('server', receiverId as string);
    await server.dispose();

    await expect(client.sendAll('echo', 'after')).resolves.toMatchObject({
      fulfilled: {},
      rejected: { [JSON.stringify(['receiver', 'server', receiverId])]: expect.anything() }
    });
    await client.dispose();
  });
  it('settles synchronous transport send failures without leaking public operations', async () => {
    const listeners = new Set<(message: IWebRpcInboundMessage<unknown>) => void>();
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      send() {
        throw new Error('synchronous send failure');
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
    const endpoint = new WebRpcEndpoint<'remote'>('local', transport, undefined, {
      timeout: { timeoutMs: false }
    });
    await expect(endpoint.send('remote', 'work', null)).rejects.toMatchObject({
      code: WebRpcErrorCode.transport
    });
    await expect(endpoint.ping('remote')).resolves.toBe(false);
    expect(() => endpoint.dispatch('remote', 'notify', null)).not.toThrow();
    await endpoint.dispose();
    expect(listeners.size).toBe(0);
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
    const config = { schemas: { add: { params: schema, result: schema } } };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, { contract: config });
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { add: (ctx) => ctx.success((ctx.data as number) + 1) },
      { contract: config }
    );
    expect(() => a.dispatch('b', 'add', 'bad' as unknown as number)).toThrow(
      WebRpcSchemaValidationError
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
  it('settles an unlimited ping when its caller aborts', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'missing'>('a', transport, undefined, {
      timeout: { timeoutMs: false }
    });
    const controller = new AbortController();
    const pending = endpoint.ping('missing', undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toBe(false);
    await endpoint.dispose();
  });
  it('rejects ping and abort when their middleware capabilities are absent', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      features: { ping: false, abort: false }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport);
    expect(() => a.ping('b')).toThrow('ping middleware is not installed');
    const controller = new AbortController();
    await expect(
      a.send('b', 'missing', undefined, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'MIDDLEWARE_MISSING' });
    expect(a.connect.ping).toBeUndefined();
    await a.dispose();
    await b.dispose();
  });
  it('rejects invalid ping timeout before creating a pending task', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'b'>('a', transport, undefined, {
      timeout: { timeoutMs: Number.NaN }
    });
    expect(() => endpoint.ping('b')).toThrow('timeoutMs must be false');
    await endpoint.dispose();
  });
  it('contains abort listener registration failures', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'b'>('a', transport);
    const registrationError = new Error('signal registration failed');
    const signal = {
      aborted: false,
      addEventListener() {
        throw registrationError;
      },
      removeEventListener() {}
    } as unknown as AbortSignal;
    await expect(endpoint.send('b', 'missing', null, { signal })).rejects.toBe(registrationError);
    await endpoint.dispose();
  });
  it('catches cancellation that races listener registration', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'b'>('a', transport);
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      addEventListener() {
        aborted = true;
      },
      removeEventListener() {}
    } as unknown as AbortSignal;
    await expect(endpoint.send('b', 'missing', null, { signal })).rejects.toMatchObject({
      code: 'CANCELLED'
    });
    await endpoint.dispose();
  });
  it('quiesces provider work after a terminal transport close', async () => {
    const [aTransport, bTransport] = createMemoryTransportPair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    let aborted = false;
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      slow: (context) =>
        new Promise((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve(context.success());
            },
            { once: true }
          );
        })
    });
    const pending = a.send('b', 'slow', null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    aTransport.close();
    await expect(pending).rejects.toMatchObject({ code: 'TRANSPORT' });
    expect(aborted).toBe(true);
    await a.dispose();
    await b.dispose();
  });
  it('keeps variation traffic usable with a JSON protocol', async () => {
    const [aTransport, bTransport] = pair();
    const protocol = {
      encode: (value: unknown): string => JSON.stringify(value),
      decode: (value: unknown): unknown => JSON.parse(String(value))
    };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, { protocol });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, undefined, { protocol });
    await expect(a.ping('b')).resolves.toBe(true);
    await a.dispose();
    await b.dispose();
  });
  it('encodes abort and pong variations through the configured protocol', async () => {
    const [aTransport, bTransport] = pair();
    const protocol = {
      encode: (value: unknown): string => JSON.stringify(value),
      decode: (value: unknown): unknown => JSON.parse(String(value))
    };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, { protocol });
    let aborted = false;
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      {
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
      },
      { protocol }
    );
    const controller = new AbortController();
    const pending = a.send('b', 'slow', null, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(false);
    await a.dispose();
    await b.dispose();
  });
  it('uses injected protocol encode/decode for contract messages', async () => {
    const [aTransport, bTransport] = pair();
    const encode = (value: unknown): unknown => ({ encoded: value });
    const decode = (value: unknown): unknown => (value as { encoded: unknown }).encoded;
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      protocol: { encode, decode }
    });
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { add: (ctx) => ctx.success((ctx.data as number) + 1) },
      { protocol: { encode, decode } }
    );
    await expect(a.send('b', 'add', 1)).resolves.toBe(2);
    await a.dispose();
    await b.dispose();
  });
  it('snapshots direct constructor connect policy', async () => {
    const [aTransport, bTransport] = pair();
    const connectConfig = { transport: aTransport, useBaseIdVerifyOnly: true };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: connectConfig
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    connectConfig.useBaseIdVerifyOnly = false;
    await expect(a.send('b', 'echo', 'value')).resolves.toBe('value');
    await a.dispose();
    await b.dispose();
  });

  it('uses a custom direct connect verifier for an explicit peer', async () => {
    const [aTransport, bTransport] = pair();
    const verifierCalls: unknown[] = [];
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      connect: {
        transport: aTransport,
        verify: async (context) => {
          verifierCalls.push(context.senderId);
          return context.senderId === 'b';
        }
      }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => ctx.success(ctx.data)
    });
    await expect(a.send('b', 'echo', 'verified')).resolves.toBe('verified');
    expect(verifierCalls).toContain('b');
    await a.dispose();
    await b.dispose();
  });
  it('snapshots direct constructor timeout policy', async () => {
    const [transport] = pair();
    const timeout = { timeoutMs: 0 as number | false };
    const endpoint = new WebRpcEndpoint<'b'>('a', transport, undefined, { timeout });
    timeout.timeoutMs = false;
    await expect(endpoint.ping('b')).resolves.toBe(false);
    await endpoint.dispose();
  });
  it('rejects invalid direct protocol and chunk capabilities at construction', () => {
    const [transport] = pair();
    expect(
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          protocol: { encode: 'bad' as never }
        })
    ).toThrowError(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
    expect(
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          chunk: { chunkSize: 1 }
        })
    ).toThrowError(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
  });
  it('accepts configurable replay limits and rejects invalid limits', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('a', transport, undefined, {
      replay: { maxEntries: 8, ttlMs: 1_000 }
    });
    await endpoint.dispose();
    const maxOnly = new WebRpcEndpoint('a', pair()[0], undefined, {
      replay: { maxEntries: 8 }
    });
    const ttlOnly = new WebRpcEndpoint('a', pair()[0], undefined, {
      replay: { ttlMs: 1_000 }
    });
    await maxOnly.dispose();
    await ttlOnly.dispose();
    expect(
      () => new WebRpcEndpoint('a', pair()[0], undefined, { replay: { maxEntries: 0 } })
    ).toThrowError(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
    expect(
      () => new WebRpcEndpoint('a', pair()[0], undefined, { replay: { ttlMs: 0 } })
    ).toThrowError(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
  });

  it('rejects every direct capability descriptor with an invalid callback shape', () => {
    const [transport] = pair();
    const invalidCases: readonly (() => void)[] = [
      () => new WebRpcEndpoint('a', transport, undefined, { protocol: { decode: 'bad' as never } }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          protocol: { encodedType: 'invalid' as never }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          authentication: {
            enabled: true,
            protect: 'bad' as never,
            unprotect: () => undefined,
            encodedType: 'any'
          }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          authentication: {
            enabled: false as never,
            protect: () => undefined,
            unprotect: () => undefined,
            encodedType: 'any'
          }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          authentication: {
            enabled: true,
            protect: () => undefined,
            unprotect: 'bad' as never,
            encodedType: 'any'
          }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          authentication: {
            enabled: true,
            protect: () => undefined,
            unprotect: () => undefined,
            encodedType: 'invalid' as never
          }
        }),
      () => new WebRpcEndpoint('a', transport, undefined, { targetIds: 'bad' as never }),
      () => new WebRpcEndpoint('a', transport, undefined, { connect: null as never }),
      () => new WebRpcEndpoint('a', transport, undefined, { connect: {} as never }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          connect: { transport, identifier: 'bad' as never }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          connect: { transport, verify: 'bad' as never }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          chunk: { byteLength: 'bad' as never }
        }),
      () =>
        new WebRpcEndpoint('a', transport, undefined, {
          chunk: { split: 'bad' as never }
        })
    ];

    for (const create of invalidCases)
      expect(create).toThrowError(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }));
  });
  it('renews healthy remote receivers during idle periods', async () => {
    vi.useFakeTimers();
    try {
      const [clientTransport, serverTransport] = createMemoryTransportPair();
      const client = new WebRpcEndpoint<'service'>('client', clientTransport);
      const server = new WebRpcEndpoint<'service'>('service', serverTransport, {
        echo: (context) => context.success('ok')
      });
      await expect(client.send('service', 'echo', null)).resolves.toBe('ok');
      expect(client.connect.getServerList('service')[0]?.status).toBe('active');
      vi.advanceTimersByTime(300_001);
      expect(client.connect.getServerList('service')[0]?.status).toBe('stale');
      await expect(client.sendAll('echo', null)).resolves.toEqual({
        fulfilled: {},
        rejected: {}
      });
      await client.dispose();
      await server.dispose();
    } finally {
      vi.useRealTimers();
    }
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
    expect(aborted).toBe(false);
    await a.dispose();
    await b.dispose();
  });
  it('reassembles chunk frames before decoding', async () => {
    const [aTransport, bTransport] = pair();
    const encode = (value: unknown): string => JSON.stringify(value);
    const decode = (value: unknown): unknown => JSON.parse(String(value));
    const chunk = { chunkSize: 8 };
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      protocol: { encode, decode },
      chunk,
      connect: { transport: aTransport }
    });
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      { echo: (ctx) => ctx.success(ctx.data) },
      { protocol: { encode, decode }, chunk, connect: { transport: bTransport } }
    );
    await expect(a.send('b', 'echo', { value: 'chunked payload' })).resolves.toEqual({
      value: 'chunked payload'
    });
    await a.dispose();
    await b.dispose();
  });
  it('uses initial targetIds for fan-out and ping snapshots', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, { targetIds: ['b'] });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, { echo: (ctx) => ctx.success(ctx.data) });
    await expect(a.pingAll()).resolves.toEqual({
      fulfilled: { '["target","b"]': true },
      rejected: {}
    });
    const receiverId = a.discovery.getServerList('b')[0]?.receiverId;
    await expect(a.sendAll('echo', 'ok')).resolves.toEqual({
      fulfilled: { [JSON.stringify(['receiver', 'b', receiverId])]: 'ok' },
      rejected: {}
    });
    await a.dispose();
    await b.dispose();
  });
  it('does not execute a completed request again when its wire frame is replayed', async () => {
    const [aTransport, bTransport] = pair();
    let calls = 0;
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      uuid: { generate: () => 'replayed' }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      once: (ctx) => {
        calls += 1;
        return ctx.success('done');
      }
    });
    await expect(a.send('b', 'once', null)).resolves.toBe('done');
    aTransport.send({
      kind: 'request',
      version: '1.0',
      taskId: 'TASK:a:replayed',
      senderId: 'a',
      targetId: 'b',
      method: 'once',
      data: null,
      sentAt: Date.now()
    });
    aTransport.send({
      kind: 'request',
      version: '1.0',
      taskId: 'TASK:a:replayed',
      senderId: 'a',
      targetId: 'b',
      method: 'once',
      data: null,
      sentAt: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    await a.dispose();
    await b.dispose();
  });
  it('does not immediately reuse a completed outbound task id', async () => {
    const [aTransport, bTransport] = pair();
    const a = new WebRpcEndpoint<'b'>('a', aTransport, undefined, {
      uuid: { generate: () => 'fixed' }
    });
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      once: (ctx) => ctx.success('ok')
    });
    await expect(a.send('b', 'once', null)).resolves.toBe('ok');
    await expect(a.send('b', 'once', null)).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig
    });
    await a.dispose();
    await b.dispose();
  });
  it('rejects stale and future request frames before provider routing', async () => {
    const [aTransport, bTransport] = pair();
    let calls = 0;
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>('b', bTransport, {
      echo: (ctx) => {
        calls += 1;
        return ctx.success(ctx.data);
      }
    });
    const sendFrame = (sentAt: number, taskId: string): void => {
      aTransport.send({
        kind: 'request',
        version: '1.0',
        taskId,
        senderId: 'a',
        targetId: 'b',
        method: 'echo',
        data: taskId,
        sentAt
      });
    };
    sendFrame(Date.now() - 600_000, 'TASK:a:old');
    sendFrame(Date.now() + 600_000, 'TASK:a:future');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(0);
    await a.dispose();
    await b.dispose();
  });
  it('does not revive inbound state when dispose wins an async verification', async () => {
    const [aTransport, bTransport] = pair();
    let releaseVerification!: () => void;
    let verificationStarted!: () => void;
    const verificationReady = new Promise<void>((resolve) => {
      verificationStarted = resolve;
    });
    const verification = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    let calls = 0;
    const a = new WebRpcEndpoint<'b'>('a', aTransport);
    const b = new WebRpcEndpoint<'a'>(
      'b',
      bTransport,
      {
        echo: (ctx) => {
          calls += 1;
          return ctx.success(ctx.data);
        }
      },
      {
        connect: {
          transport: bTransport,
          verify: async () => {
            verificationStarted();
            await verification;
            return true;
          }
        }
      }
    );
    const pending = a.send('b', 'echo', 'late', { timeoutMs: 50 });
    await verificationReady;
    const disposed = b.dispose();
    releaseVerification();
    await disposed;
    await expect(pending).rejects.toBeDefined();
    expect(calls).toBe(0);
    await a.dispose();
  });
  it('does not learn a peer from an unsolicited response', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'peer'>('a', transport);
    transport.send({
      kind: 'response',
      version: '1.0',
      taskId: 'unexpected',
      senderId: 'peer',
      targetId: 'a',
      method: 'echo',
      ok: true,
      data: 'ignored',
      sentAt: Date.now()
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await expect(endpoint.sendAll('echo', null)).resolves.toEqual({
      fulfilled: {},
      rejected: {}
    });
    await endpoint.dispose();
  });
  it('keeps attacker-controlled fan-out keys as own properties', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint<'__proto__'>('a', transport, undefined, {
      targetIds: ['__proto__'],
      timeout: { timeoutMs: 0 }
    });
    const result = await endpoint.sendAll('missing', null);
    expect(Object.hasOwn(result.rejected, '["target","__proto__"]')).toBe(true);
    await endpoint.dispose();
  });
  it('rejects every fan-out entry point consistently after disposal', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('a', transport);
    await endpoint.dispose();
    await expect(endpoint.sendAll('missing', null)).rejects.toBeInstanceOf(WebRpcLifecycleError);
    expect(() => endpoint.dispatchAll('missing', null)).toThrow();
    await expect(endpoint.pingAll()).rejects.toBeInstanceOf(WebRpcLifecycleError);
  });
  it('closes endpoint admission after terminal transport failure', async () => {
    let reportTransportError: ((error: unknown) => void) | undefined;
    const endpoint = new WebRpcEndpoint('a', {
      platform: 'Memory',
      send() {},
      subscribe() {
        return () => undefined;
      },
      onTransportError(listener) {
        reportTransportError = listener;
        return () => undefined;
      },
      get closed() {
        return true;
      },
      ownership: 'borrowed'
    });
    reportTransportError?.(new Error('closed'));
    expect(() => endpoint.ping('b')).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.endpointDisposed })
    );
    await endpoint.dispose();
  });
  it('does not close borrowed transport resources during endpoint disposal', async () => {
    let closed = 0;
    const endpoint = new WebRpcEndpoint('a', {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() {
        return () => undefined;
      },
      close() {
        closed += 1;
      }
    });
    await endpoint.dispose();
    expect(closed).toBe(0);
  });
  it('rejects hook registration after disposal and invalid listeners', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('a', transport);
    expect(() => endpoint.hooks.on(null as never)).toThrow('hook listener must be a function');
    await endpoint.dispose();
    expect(() => endpoint.hooks.on(() => undefined)).toThrow('Endpoint disposed');
  });
  it('rejects invalid event listeners during registration', () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('a', transport);
    expect(() => endpoint.on('event', null as never)).toThrow('event listener must be a function');
    return endpoint.dispose();
  });
  it('rejects event identifiers beyond the configured limit', async () => {
    const [transport] = pair();
    const endpoint = new WebRpcEndpoint('a', transport, undefined, {
      contract: { maxIdentifierLength: 3 }
    });
    expect(() => endpoint.on('long-event', () => undefined)).toThrow('event must be');
    await endpoint.dispose();
  });
  it('rolls back transport registrations when a later registration fails', () => {
    let unsubscribed = false;
    expect(
      () =>
        new WebRpcEndpoint('a', {
          platform: 'Memory',
          send() {},
          subscribe() {
            return () => {
              unsubscribed = true;
            };
          },
          onTransportError() {
            return () => undefined;
          },
          onListenerError() {
            throw new Error('registration failed');
          }
        })
    ).toThrow('registration failed');
    expect(unsubscribed).toBe(true);
  });
  it('keeps rollback when registration error message is hostile', () => {
    expect(
      () =>
        new WebRpcEndpoint('a', {
          platform: 'Memory',
          send() {},
          subscribe() {
            return () => undefined;
          },
          onListenerError() {
            throw {
              get message() {
                throw new Error('message getter leaked');
              }
            };
          }
        })
    ).toThrowError(expect.objectContaining({ name: 'WebRpcConstructionError' }));
  });
});
