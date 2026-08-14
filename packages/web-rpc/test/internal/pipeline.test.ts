import { describe, expect, it } from 'vitest';
import { WebRpcOutboundPipeline } from '../../src/internal/pipeline';

describe('outbound pipeline encoded type boundary', () => {
  it('rejects a custom byteLength that undercounts canonical UTF-8 bytes', () => {
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string' as const,
        send: () => undefined,
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => '😀', decode: (value) => value },
      { maxMessageBytes: 100, byteLength: () => 1, split: (value) => [value] },
      () => undefined
    );
    expect(() => pipeline.send({ targetId: 'b' }, () => 'message')).toThrow('unsafe measurement');
  });

  it('uses transport descriptor snapshots after construction', async () => {
    let sendReads = 0;
    const transport = {
      platform: 'Memory' as const,
      encodedType: 'any' as const,
      get send() {
        sendReads += 1;
        if (sendReads > 1) throw new Error('send descriptor reread');
        return () => undefined;
      },
      subscribe: () => () => undefined
    };
    const pipeline = new WebRpcOutboundPipeline(
      transport,
      'a',
      { encodedType: 'any', encode: (value) => value, decode: (value) => value },
      { byteLength: (value) => value.length, split: (value) => [value] },
      () => undefined
    );
    await pipeline.send({ targetId: 'b' }, () => 'message');
    expect(sendReads).toBe(1);
  });

  it('encodes chunk metadata through the protocol boundary', async () => {
    const encoded: unknown[] = [];
    const sends: unknown[] = [];
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value) {
          sends.push(value);
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => {
          encoded.push(value);
          return JSON.stringify(value);
        },
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: (value) => {
          const parts: string[] = [];
          for (let index = 0; index < value.length; index += 4)
            parts.push(value.slice(index, index + 4));
          return parts;
        }
      },
      () => undefined
    );
    await pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message');
    const frames = encoded.slice(1) as Array<Record<string, unknown>>;
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.kind === 'chunk')).toBe(true);
    expect(frames.every((frame) => frame.messageId === 'message')).toBe(true);
    expect(frames.every((frame) => frame.total === frames.length)).toBe(true);
    expect(sends).toHaveLength(frames.length);
  });

  it('rejects codec output that violates the transport type before send', () => {
    let sends = 0;
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          sends += 1;
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: () => ({ invalid: true }),
        decode: (value) => value
      },
      {
        chunkSize: undefined,
        byteLength: (value) => value.length,
        split: (value) => [value]
      },
      () => undefined
    );
    expect(() => pipeline.send({ targetId: 'b' }, () => 'message')).toThrow(
      'Protocol encode failed'
    );
    expect(sends).toBe(0);
  });
  it('normalizes a synchronous transport throw into a rejected promise', async () => {
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          throw new Error('sync transport failure');
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'any',
        encode: (value) => value,
        decode: (value) => value
      },
      {
        byteLength: (value) => value.length,
        split: (value) => [value]
      },
      () => undefined
    );
    await expect(pipeline.send({ targetId: 'b' }, () => 'message')).rejects.toMatchObject({
      code: 'TRANSPORT'
    });
  });
  it('releases a chunk message id when any frame send fails', async () => {
    let released: string | undefined;
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => Promise.reject(new Error('frame send failed')),
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => JSON.stringify(value),
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: (value) => {
          const parts: string[] = [];
          for (let index = 0; index < value.length; index += 4)
            parts.push(value.slice(index, index + 4));
          return parts;
        }
      },
      () => undefined,
      undefined,
      undefined,
      (messageId) => {
        released = messageId;
      }
    );
    await expect(
      pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')
    ).rejects.toMatchObject({ code: 'TRANSPORT' });
    expect(released).toBe('message');
  });

  it('rejects a splitter result above the configured frame budget', () => {
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {},
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => JSON.stringify(value),
        decode: (value) => value
      },
      {
        chunkSize: 8,
        maxChunksPerMessage: 1,
        byteLength: (value) => new TextEncoder().encode(value).byteLength,
        split: () => ['part', 'more']
      },
      () => undefined
    );
    expect(() => pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')).toThrow(
      'Chunk splitter returned invalid frames'
    );
  });
  it('rejects parts above the receiver single-frame byte budget', () => {
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {},
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => JSON.stringify(value),
        decode: (value) => value
      },
      {
        chunkSize: 4,
        maxChunkBytes: 3,
        byteLength: (value) => value.length,
        split: (value) => [value.slice(0, 4), value.slice(4)]
      },
      () => undefined
    );
    expect(() => pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')).toThrow(
      'Chunk splitter returned invalid frames'
    );
  });
  it.each([
    ['empty output', () => [] as string[]],
    ['non-joining output', () => ['not', 'the', 'payload']],
    ['empty part', () => ['payload', '']],
    ['non-string part', () => ['payload', 1] as never]
  ])('rejects splitter %s before allocating a message id or sending', (_name, split) => {
    let sends = 0;
    let ids = 0;
    const pipeline = new WebRpcOutboundPipeline(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1;
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => JSON.stringify(value),
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split
      },
      () => undefined
    );
    expect(() =>
      pipeline.send({ targetId: 'b', data: 'payload' }, () => {
        ids += 1;
        return 'message';
      })
    ).toThrow('Chunk splitter returned invalid frames');
    expect(ids).toBe(0);
    expect(sends).toBe(0);
  });
});
