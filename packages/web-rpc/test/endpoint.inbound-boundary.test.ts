import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../src/transport';

type IInjectableTransport = IWebRpcTransport & {
  emit(message: unknown): void;
  emitInbound(message: IWebRpcInboundMessage<unknown>): void;
};

/** Creates an exclusive transport whose inbound boundary is controlled by the test. */
const injectableTransport = (): IInjectableTransport => {
  let listener: ((message: IWebRpcInboundMessage<unknown>) => void) | undefined;
  return {
    platform: 'Memory',
    topology: 'exclusive',
    send() {},
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    emit(message) {
      listener?.({ data: message });
    },
    emitInbound(message) {
      listener?.(message);
    }
  };
};

/** Releases async receive continuations without relying on wall-clock sleeps. */
const drainReceives = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('endpoint inbound boundary', () => {
  it('verifies configured origin and identifier through inbound discovery', async () => {
    const source = {};
    const cases = [
      {
        origin: 'https://trusted.test',
        connect: { transport: undefined },
        accepted: true
      },
      {
        origin: 'https://spoof.test',
        connect: { transport: undefined },
        accepted: false
      },
      {
        origin: undefined,
        connect: {
          transport: undefined,
          useBaseIdVerifyOnly: false,
          identifier: () => true
        },
        accepted: true
      },
      {
        origin: undefined,
        connect: {
          transport: undefined,
          useBaseIdVerifyOnly: false
        },
        accepted: false
      },
      {
        origin: undefined,
        connect: { transport: undefined },
        platform: 'BroadcastChannel',
        topology: 'broadcast',
        anonymous: true,
        accepted: true
      }
    ] as const;

    for (const scenario of cases) {
      const transport = injectableTransport();
      const sent: unknown[] = [];
      transport.send = (message) => {
        sent.push(message);
      };
      Object.assign(transport, {
        platform: 'platform' in scenario ? scenario.platform : 'Iframe',
        topology: 'topology' in scenario ? scenario.topology : 'multiplexed',
        ...(scenario.origin === undefined ? {} : { origin: 'https://trusted.test' })
      });
      const endpoint = new WebRpcEndpoint('host', transport, undefined, {
        connect: {
          ...scenario.connect,
          transport
        } as never
      });
      transport.emitInbound({
        data: {
          kind: 'discovery-query',
          taskId: `query-${scenario.origin ?? 'identifier'}`,
          senderId: 'peer',
          targetId: 'host',
          sentAt: Date.now()
        },
        source: 'anonymous' in scenario && scenario.anonymous ? undefined : source,
        ...(scenario.origin === undefined ? {} : { origin: scenario.origin })
      });
      await drainReceives();
      await drainReceives();
      expect(sent.length > 0, JSON.stringify(scenario)).toBe(scenario.accepted);
      await endpoint.dispose();
    }
  });

  it('drops stale control traffic, wrong targets, and unknown receiver routes', async () => {
    const transport = injectableTransport();
    const events: string[] = [];
    const endpoint = new WebRpcEndpoint('host', transport, undefined, {
      hooks: {
        listeners: (event) => {
          events.push(event.code ?? event.name);
        }
      }
    });
    const stale = Date.now() - 10 * 60_000;
    transport.emit({
      kind: 'discovery-query',
      taskId: 'query',
      senderId: 'peer',
      targetId: 'host',
      sentAt: stale
    });
    transport.emit({
      kind: 'discovery-response',
      taskId: 'query',
      senderId: 'peer',
      targetId: 'host',
      resolvedTargetId: 'peer',
      sentAt: stale
    });
    transport.emit({
      kind: 'variation',
      variation: 'ping',
      taskId: 'ping',
      senderId: 'peer',
      targetId: 'host',
      sentAt: stale
    });
    transport.emit({
      kind: 'request',
      version: '1.0',
      taskId: 'wrong-target',
      senderId: 'peer',
      targetId: 'other',
      method: 'method',
      data: null,
      sentAt: Date.now()
    });
    transport.emit({
      kind: 'request',
      version: '1.0',
      taskId: 'unknown-receiver',
      senderId: 'peer',
      targetId: 'host',
      receiverId: 'missing',
      method: 'method',
      data: null,
      sentAt: Date.now()
    });
    transport.emit({
      kind: 'chunk',
      messageId: 'chunk',
      index: 0,
      total: 1,
      data: 'payload',
      senderId: 'peer',
      targetId: 'other'
    });
    await drainReceives();
    expect(events.filter((event) => event === 'DISCOVERY_STALE')).toHaveLength(2);
    expect(events).toContain('VARIATION_STALE');
    await endpoint.dispose();
  });

  it('reports contract mismatch, invalid identifiers, and unmatched responses', async () => {
    const transport = injectableTransport();
    const events: string[] = [];
    const endpoint = new WebRpcEndpoint('host', transport, undefined, {
      hooks: {
        listeners: (event) => {
          events.push(event.code ?? event.name);
        }
      }
    });
    transport.emit({
      kind: 'request',
      version: '2.0',
      taskId: 'contract',
      senderId: 'peer',
      targetId: 'host',
      method: 'method',
      data: null,
      sentAt: Date.now()
    });
    transport.emit({
      kind: 'variation',
      variation: 'pong',
      taskId: '',
      senderId: 'peer',
      targetId: 'host',
      sentAt: Date.now()
    });
    transport.emit({
      kind: 'response',
      version: '1.0',
      taskId: 'unmatched',
      senderId: 'peer',
      targetId: 'host',
      method: 'method',
      ok: true,
      sentAt: Date.now()
    });
    await drainReceives();
    expect(events).toContain('CONTRACT_INVALID');
    await endpoint.dispose();
  });

  it('contains protocol decoding failures and hostile inbound wrappers', async () => {
    const transport = injectableTransport();
    const events: string[] = [];
    const endpoint = new WebRpcEndpoint('host', transport, undefined, {
      hooks: {
        listeners: (event) => {
          events.push(event.code ?? event.name);
        }
      }
    });
    const decoderTransport = injectableTransport();
    const decoderEndpoint = new WebRpcEndpoint('decoder', decoderTransport, undefined, {
      protocol: {
        decode: () => {
          throw new Error('decode failed');
        }
      },
      hooks: {
        listeners: (event) => {
          events.push(event.code ?? event.name);
        }
      }
    });
    decoderTransport.emit('invalid');
    transport.emitInbound({
      get data() {
        throw new Error('hostile wrapper');
      },
      peerId: 'peer'
    } as IWebRpcInboundMessage<unknown>);
    await drainReceives();
    expect(events).toContain('PAYLOAD_INVALID');
    expect(events).not.toContain('receive.failure');
    await endpoint.dispose();
    await decoderEndpoint.dispose();
  });

  it('rejects every bounded contract identifier and clock-skew edge', async () => {
    const transport = injectableTransport();
    const events: string[] = [];
    const endpoint = new WebRpcEndpoint('host', transport, undefined, {
      contract: { maxIdentifierLength: 8 },
      hooks: {
        listeners: (event) => {
          events.push(event.code ?? event.name);
        }
      }
    });
    const base = {
      kind: 'request',
      version: '1.0',
      taskId: 'task',
      senderId: 'peer',
      targetId: 'host',
      method: 'method',
      data: null,
      sentAt: Date.now()
    } as const;
    const invalidRequests = [
      { ...base, sentAt: Date.now() - 10 * 60_000 },
      { ...base, sentAt: Date.now() + 10 * 60_000 },
      { ...base, senderId: '' },
      { ...base, senderId: 'sender-too-long' },
      { ...base, targetId: '' },
      { ...base, targetId: 'target-too-long' },
      { ...base, taskId: '' },
      { ...base, taskId: 'task-too-long' },
      { ...base, method: '' },
      { ...base, method: 'method-too-long' },
      { ...base, receiverId: '' },
      { ...base, receiverId: 'receiver-too-long' }
    ];
    for (const request of invalidRequests) transport.emit(request);
    transport.emit({
      kind: 'variation',
      variation: 'ping',
      taskId: 'task-too-long',
      senderId: 'peer',
      targetId: 'host',
      sentAt: Date.now()
    });
    transport.emit({
      kind: 'chunk',
      messageId: '',
      index: 0,
      total: 1,
      data: 'payload',
      senderId: 'peer',
      targetId: 'host'
    });
    transport.emit({
      kind: 'chunk',
      messageId: 'message-too-long',
      index: 0,
      total: 1,
      data: 'payload',
      senderId: 'peer',
      targetId: 'host'
    });
    await drainReceives();
    expect(events.filter((event) => event === 'CONTRACT_INVALID').length).toBeGreaterThanOrEqual(
      invalidRequests.length
    );
    await endpoint.dispose();
  });
});
