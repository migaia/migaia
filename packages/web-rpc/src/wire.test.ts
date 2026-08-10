import { describe, expect, it } from 'vitest';
import { assertMethod, isWebRpcEnvelope } from './wire';

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
      isWebRpcEnvelope({ kind: 'variation', variation: 'ping', senderId: 'a', targetId: 'b' })
    ).toBe(true);
    expect(isWebRpcEnvelope({ kind: 'request' })).toBe(false);
    expect(isWebRpcEnvelope({ kind: 'unknown' })).toBe(false);
    expect(isWebRpcEnvelope(null)).toBe(false);
  });
  it('rejects empty method names at entry', () => {
    expect(() => assertMethod('')).toThrow('non-empty');
    expect(assertMethod('notes.save')).toBe('notes.save');
  });
});
