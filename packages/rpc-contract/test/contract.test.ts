import { describe, expect, it } from 'vitest'
import {
  createDescriptor,
  deserializeRpcError,
  normalizePortable,
  normalizeRpcEnvelope,
  rpcProtocolV1,
  serializeRpcError
} from '../src/index.js'
import { createBinaryFramer, createStringFramer, messageFramerV1 } from '../src/framing/index.js'
import { normalizeRpcEnvelope as normalizeV1Envelope, rpcProtocol } from '../src/v1/index.js'
import rpcV1 from '../src/v1/index.js'
import { messageFramer } from '../src/framing/v1.js'

describe('rpc-contract', () => {
  it('preserves root V1 object and normalizer identity through the additive V1 export', () => {
    expect(rpcProtocolV1).toBe(rpcProtocol)
    expect(normalizeRpcEnvelope).toBe(normalizeV1Envelope)
  })

  it('freezes descriptors and preserves literal identity', () => {
    const descriptor = createDescriptor('test.protocol', 7)
    expect(descriptor).toEqual({ id: 'test.protocol', version: 7 })
    expect(Object.isFrozen(descriptor)).toBe(true)
  })

  it('snapshots hostile envelope fields and rejects unsupported shapes', () => {
    let reads = 0
    const input = {
      get kind() {
        reads += 1
        return 'request'
      },
      id: '1',
      method: 'ping',
      data: null
    }
    expect(normalizeRpcEnvelope(input)).toEqual({
      kind: 'request',
      id: '1',
      method: 'ping',
      data: null
    })
    expect(reads).toBe(1)
    expect(() => normalizeRpcEnvelope({ kind: 'response', ok: true, id: '1' })).toThrow()
    expect(() => normalizePortable(new Date())).toThrow()
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => normalizePortable(cycle)).toThrow()
    expect(normalizePortable({ __proto__: 'safe' })).toEqual({})
  })

  it('round-trips a bounded serialized error graph without replacing native types', () => {
    const cause = new RangeError('root cause')
    Object.defineProperty(cause, 'source', { value: '@test', enumerable: true })
    Object.defineProperty(cause, 'code', { value: 'CAUSE', enumerable: true })
    const root = new TypeError('root')
    Object.defineProperty(root, 'source', { value: '@test', enumerable: true })
    Object.defineProperty(root, 'code', { value: 'ROOT', enumerable: true })
    Object.defineProperty(root, 'cause', { value: cause })
    const restored = deserializeRpcError(serializeRpcError(root))
    expect(restored).toBeInstanceOf(TypeError)
    expect(restored.stack).toBe(root.stack)
    expect((restored as Error & { cause: Error }).cause).toBeInstanceOf(RangeError)
    const aggregate = new AggregateError([cause], 'aggregate')
    const restoredAggregate = deserializeRpcError(serializeRpcError(aggregate))
    expect(restoredAggregate).toBeInstanceOf(AggregateError)
    expect((restoredAggregate as AggregateError).errors[0]).toBeInstanceOf(RangeError)
  })

  it('reassembles ordered strings and isolates source keys', () => {
    const framer = createStringFramer({ chunkBytes: 2, assemblyTimeoutMs: 10_000 })
    const context = { source: 'peer-a', messageId: 'message-a' } as const
    const frames = framer.frame('abcd', context)
    expect(frames).toHaveLength(2)
    expect(framer.accept(frames[0]!, context)).toEqual({ status: 'pending' })
    expect(framer.accept(frames[1]!, context)).toEqual({ status: 'complete', value: 'abcd' })
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')
  })

  it('rejects out-of-order and over-limit binary fragments before semantic decoding', () => {
    const framer = createBinaryFramer({ chunkBytes: 2, maxMessageBytes: 4 })
    const context = { source: 'peer-a', messageId: 'message-b' } as const
    const frames = framer.frame(new Uint8Array([1, 2, 3, 4]), context)
    expect(framer.accept(frames[1]!, context).status).toBe('rejected')
    expect(framer.accept(frames[0]!, context).status).toBe('pending')
  })

  it('reports expiration and bounds terminal history after an assembly timeout', () => {
    let scheduled: (() => void) | undefined
    const framer = createStringFramer({
      chunkBytes: 2,
      maxConcurrentMessages: 1,
      schedule: (callback) => {
        scheduled = callback
        return 1
      },
      cancel: () => undefined
    })
    const context = { source: 'peer-a', messageId: 'message-timeout' } as const
    const frames = framer.frame('abcd', context)
    expect(framer.accept(frames[0]!, context)).toEqual({ status: 'pending' })
    scheduled?.()
    const late = framer.accept(frames[1]!, context)
    expect(late.status).toBe('rejected')
    expect((late as { status: 'rejected'; error: Error }).error).toMatchObject({
      code: 'FRAME_ASSEMBLY_EXPIRED'
    })
  })

  it('keeps the identity framer codec-independent', () => {
    const value = new Uint8Array([1, 2])
    const semantic = { kind: 'request' as const, id: 'identity' }
    expect(messageFramerV1.frame(value, { source: 'x', messageId: 'y' })).toEqual([value])
    expect(messageFramerV1.accept(semantic)).toEqual({
      status: 'complete',
      value: semantic
    })
    expect(rpcProtocolV1.id).toBe('migaia.rpc')
    expect(rpcV1.rpcProtocol).toBe(rpcProtocol)
    expect(messageFramer).toBe(messageFramerV1)
  })

  it('rejects a complete carrier from the wrong fixed framer profile', () => {
    const context = { source: 'x', messageId: 'fixed' }
    expect(createBinaryFramer().accept('not bytes', context).status).toBe('rejected')
    expect(createStringFramer().accept(new Uint8Array([1]), context).status).toBe('rejected')
    expect(createBinaryFramer().accept(new Uint8Array([1]), context)).toMatchObject({
      status: 'complete'
    })
    expect(createStringFramer().accept('text', context)).toMatchObject({ status: 'complete' })
  })
})
