import { describe, expect, it } from 'vitest';
import { assertMethod, isWebRpcEnvelope, normalizeWebRpcEnvelope } from '../src/wire';

describe('wire boundary', () => {
  it('accepts only request, response, variation envelopes', () => {
    expect(
      isWebRpcEnvelope({
        kind: 'request',
        version: '1.0',
        taskId: 't',
        senderId: 'a',
        targetId: 'b',
        method: 'm',
        data: null,
        sentAt: 0
      })
    ).toBe(true);
    expect(
      isWebRpcEnvelope({
        kind: 'response',
        version: '1.0',
        taskId: 't',
        senderId: 'b',
        targetId: 'a',
        method: 'm',
        ok: true,
        sentAt: 0
      })
    ).toBe(true);
    expect(
      isWebRpcEnvelope({
        kind: 'variation',
        variation: 'ping',
        taskId: 'p',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      })
    ).toBe(true);
    expect(isWebRpcEnvelope({ kind: 'request' })).toBe(false);
    expect(isWebRpcEnvelope({ kind: 'unknown' })).toBe(false);
    expect(isWebRpcEnvelope(null)).toBe(false);
  });
  it('rejects empty method names at entry', () => {
    expect(() => assertMethod('')).toThrow('non-empty');
    expect(assertMethod('notes.save')).toBe('notes.save');
  });
  it('freezes one canonical snapshot of hostile accessor fields', () => {
    let reads = 0;
    const input = new Proxy(
      {
        kind: 'response',
        version: '1.0',
        taskId: 'task-a',
        senderId: 'server',
        targetId: 'client',
        method: 'echo',
        ok: true,
        sentAt: 0,
        data: 'value'
      },
      {
        get(target, property, receiver) {
          if (property === 'senderId') {
            reads += 1;
            return reads === 1 ? 'server' : 'attacker';
          }
          return Reflect.get(target, property, receiver);
        }
      }
    );

    const snapshot = normalizeWebRpcEnvelope(input);
    expect(snapshot?.senderId).toBe('server');
    expect(snapshot).toBeDefined();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot?.senderId).toBe('server');
    expect(reads).toBe(1);
  });

  it.each([
    {
      kind: 'discovery-query',
      taskId: 'query',
      senderId: 'a',
      targetId: 'b',
      sentAt: 1,
      manual: true,
      data: { value: 1 }
    },
    {
      kind: 'discovery-response',
      taskId: 'query',
      senderId: 'b',
      targetId: 'a',
      resolvedTargetId: 'b',
      sentAt: 1,
      platform: 'Worker',
      receiverId: 'receiver',
      manual: true,
      accepted: true,
      message: 'accepted',
      operation: 'unregister',
      data: undefined
    },
    {
      kind: 'request',
      version: '1.0',
      taskId: 'task',
      senderId: 'a',
      targetId: 'b',
      receiverId: 'receiver',
      method: 'method',
      data: null,
      dispatchOnly: true,
      sentAt: 1
    },
    {
      kind: 'response',
      version: '1.0',
      taskId: 'task',
      senderId: 'b',
      targetId: 'a',
      receiverId: 'receiver',
      method: 'method',
      ok: false,
      data: undefined,
      message: 'failed',
      code: 'FAILED',
      sentAt: 1
    },
    {
      kind: 'variation',
      variation: 'pong',
      taskId: 'ping',
      senderId: 'b',
      targetId: 'a',
      receiverId: 'receiver',
      sentAt: 1
    },
    {
      kind: 'chunk',
      messageId: 'message',
      index: 0,
      total: 1,
      data: 'payload',
      senderId: 'a',
      targetId: 'b',
      receiverId: 'receiver'
    }
  ])('accepts and freezes complete $kind envelopes', (envelope) => {
    const normalized = normalizeWebRpcEnvelope(envelope);
    expect(normalized).toEqual(envelope);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(isWebRpcEnvelope(envelope)).toBe(true);
  });

  it('contains hostile kind getters in the public predicate', () => {
    const hostile = Object.defineProperty({}, 'kind', {
      get: () => {
        throw new Error('hostile kind');
      }
    });
    expect(isWebRpcEnvelope(hostile)).toBe(false);
  });

  it('rejects non-string and empty methods', () => {
    expect(() => assertMethod(1 as never)).toThrow('non-empty');
    expect(() => assertMethod('')).toThrow('non-empty');
  });

  it('rejects impossible chunk indexes at the wire boundary', () => {
    expect(
      normalizeWebRpcEnvelope({
        kind: 'chunk',
        messageId: 'message',
        index: 2,
        total: 2,
        data: 'payload',
        senderId: 'a',
        targetId: 'b'
      })
    ).toBeUndefined();
  });
});
