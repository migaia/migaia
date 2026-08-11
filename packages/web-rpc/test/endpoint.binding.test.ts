import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../src/transport';

describe('WebRpcEndpoint verified remote bindings', () => {
  it('does not settle a request from another source reusing the sender id', async () => {
    const sourceA = {};
    const sourceB = {};
    let listener: ((message: IWebRpcInboundMessage<unknown>) => void) | undefined;
    let queryTaskId: string | undefined;
    let requestTaskId: string | undefined;
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      topology: 'multiplexed',
      peerId: 'shared-peer',
      sourceProof: (source) => source === sourceA || source === sourceB,
      send(message) {
        const envelope = message as { kind?: string; taskId?: string };
        if (envelope.kind === 'discovery-query') {
          queryTaskId = envelope.taskId;
          queueMicrotask(() =>
            listener?.({
              data: {
                kind: 'discovery-response',
                taskId: queryTaskId,
                senderId: 'server',
                targetId: 'client',
                resolvedTargetId: 'server',
                receiverId: 'server-receiver',
                sentAt: Date.now(),
                platform: 'Memory'
              },
              peerId: 'shared-peer',
              source: sourceA
            })
          );
        } else if (envelope.kind === 'request') {
          requestTaskId = envelope.taskId;
          queueMicrotask(() =>
            listener?.({
              data: {
                kind: 'response',
                taskId: requestTaskId,
                senderId: 'server',
                targetId: 'client',
                receiverId: 'server-receiver',
                method: 'echo',
                ok: true,
                data: 'spoofed',
                sentAt: Date.now()
              },
              peerId: 'shared-peer',
              source: sourceB
            })
          );
        }
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      }
    };
    const endpoint = new WebRpcEndpoint('client', transport, undefined, {
      targetIds: ['server'],
      timeout: { timeoutMs: 20 }
    });

    try {
      await expect(endpoint.send('server', 'echo', 'request')).rejects.toMatchObject({
        code: 'DEADLINE_EXCEEDED'
      });
    } finally {
      await endpoint.dispose();
    }
  });
});
