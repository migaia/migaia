import { describe, expect, it, vi } from 'vitest'
import {
  WebRpcAuthenticationError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcSerializationError
} from '../../src/errors.js'
import { WebRpcOutboundSender } from '../../src/internal/outbound-sender.js'
import { ReplayWindow } from '../../src/internal/replay.js'
import { WebRpcMessageKind } from '../../src/protocol-constants.js'
import type { IWebRpcAuthenticationTransform } from '../../src/typing.js'
import type { IWebRpcTransport } from '../../src/transport.js'

describe('outbound sender encoded type boundary', () => {
  it('preserves a non-transport ID admission error before allocating a chunk', () => {
    const admissionError = new WebRpcError(WebRpcErrorCode.overloaded, 'outbound capacity')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          throw new Error('send must not start')
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined
    )

    let thrown: unknown
    try {
      pipeline.send({ targetId: 'b' }, () => {
        throw admissionError
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(admissionError)
  })

  it('prepares every authenticated chunk before sending and releases once on failure', async () => {
    let sends = 0
    let releaseCount = 0
    let protectCalls = 0
    let rejectFirst: ((error: unknown) => void) | undefined
    let rejectSecond: ((error: unknown) => void) | undefined
    const firstAuthenticationError = new WebRpcAuthenticationError('first authentication failure')
    const secondAuthenticationError = new WebRpcAuthenticationError('second authentication failure')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect: () => {
          protectCalls += 1
          return new Promise<never>((_, reject) => {
            if (protectCalls === 1) rejectFirst = reject
            else rejectSecond = reject
          })
        },
        unprotect: (value) => value
      },
      undefined,
      () => {
        releaseCount += 1
      }
    )

    const pending = pipeline.send({ targetId: 'b' }, () => 'message')
    await vi.waitFor(() => expect(protectCalls).toBe(2))
    expect(sends).toBe(0)
    rejectFirst?.(firstAuthenticationError)
    rejectSecond?.(secondAuthenticationError)

    await expect(pending).rejects.toBe(firstAuthenticationError)
    expect(sends).toBe(0)
    expect(releaseCount).toBe(1)
  })

  it('keeps authentication failure primary when chunk ID cleanup also fails', async () => {
    const authenticationError = new WebRpcAuthenticationError('authentication failure')
    const cleanupError = new Error('message ID cleanup failure')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          throw new Error('send must not start')
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect: () => Promise.reject(authenticationError),
        unprotect: (value) => value
      },
      undefined,
      () => {
        throw cleanupError
      }
    )

    const thrown = await Promise.resolve(pipeline.send({ targetId: 'b' }, () => 'message')).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect((thrown as { cause?: AggregateError }).cause).toMatchObject({
      errors: [authenticationError, cleanupError]
    })
  })

  it.each([
    {
      label: 'throws synchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () => {
          throw cause
        }
    },
    {
      label: 'rejects asynchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () =>
          Promise.reject(cause)
    },
    {
      label: 'returns an invalid encoded value',
      createProtect: (): IWebRpcAuthenticationTransform => () => 42
    }
  ])(
    'H-T18 classifies unchunked authentication $label as AUTHENTICATION_FAILED',
    async ({ label, createProtect }) => {
      const cause = new Error(`authentication ${label}`)
      let sends = 0
      const pipeline = new WebRpcOutboundSender(
        {
          platform: 'Memory' as const,
          encodedType: 'string',
          send: () => {
            sends += 1
          },
          subscribe: () => () => undefined
        },
        'a',
        { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
        { byteLength: (value) => value.length, split: (value) => [value] },
        () => undefined,
        {
          enabled: true,
          encodedType: 'string',
          protect: createProtect(cause),
          unprotect: (value) => value
        }
      )

      const thrown = await Promise.resolve(pipeline.send({ targetId: 'b' }, () => 'message')).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      if (label !== 'returns an invalid encoded value')
        expect((thrown as { cause: unknown }).cause).toBe(cause)
      expect(sends).toBe(0)
    }
  )

  it.each([
    {
      label: 'throws synchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () => {
          throw cause
        }
    },
    {
      label: 'rejects asynchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () =>
          Promise.reject(cause)
    },
    {
      label: 'returns an invalid encoded value',
      createProtect: (): IWebRpcAuthenticationTransform => () => 42
    }
  ])('does not send chunks when authentication $label', async ({ label, createProtect }) => {
    const cause = new Error(`chunk authentication ${label}`)
    let sends = 0
    let releases = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect: createProtect(cause),
        unprotect: (value) => value
      },
      undefined,
      () => {
        releases += 1
      }
    )

    const thrown = await Promise.resolve(pipeline.send({ targetId: 'b' }, () => 'message')).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    if (label !== 'returns an invalid encoded value')
      expect((thrown as { cause: unknown }).cause).toBe(cause)
    expect(sends).toBe(0)
    expect(releases).toBe(1)
  })

  it('preserves a class transport receiver for ordinary and chunked sends', async () => {
    class PrivateTransport implements IWebRpcTransport {
      #sendCount = 0

      readonly platform = 'Memory' as const
      readonly encodedType = 'string' as const

      send(): void {
        this.#sendCount += 1
      }

      subscribe(): () => void {
        return () => undefined
      }

      get sendCount(): number {
        return this.#sendCount
      }
    }

    const transport = new PrivateTransport()
    const protocol = {
      encodedType: 'string' as const,
      encode(value: unknown): string {
        return typeof value === 'string' ? value : 'payload'
      },
      decode: (value: unknown) => value
    }
    const pipeline = new WebRpcOutboundSender(
      transport,
      'a',
      protocol,
      { byteLength: (value) => value.length, split: (value) => [value] },
      () => undefined
    )

    await pipeline.send({ targetId: 'b' }, () => 'message')

    const chunkedPipeline = new WebRpcOutboundSender(
      transport,
      'a',
      protocol,
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined
    )
    await chunkedPipeline.send({ targetId: 'b' }, () => 'chunk-message')

    expect(transport.sendCount).toBe(3)
  })

  it('snapshots transfer once and sends the owned list only on the unchunked frame', async () => {
    let transferReads = 0
    let transferLengthReads = 0
    const transfer = new Proxy([{}], {
      get(target, property, receiver) {
        if (property === 'length') transferLengthReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    const sent: Array<{ value: unknown; transfer?: readonly unknown[] }> = []
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value, options) {
          sent.push({ value, transfer: options?.transfer })
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      { byteLength: (value) => value.length, split: (value) => [value] },
      () => undefined
    )
    const options = {
      get transfer() {
        transferReads += 1
        if (transferReads > 1) throw new Error('transfer reread')
        return transfer
      }
    }
    await pipeline.send({ targetId: 'b' }, () => 'message', options)
    expect(transferReads).toBe(1)
    expect(transferLengthReads).toBe(1)
    expect(sent[0]?.transfer).not.toBe(transfer)
    expect(sent[0]?.transfer).toEqual([transfer[0]])
    expect(Object.isFrozen(sent[0]?.transfer)).toBe(true)
  })

  it('rejects a hostile transfer getter without sending', () => {
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'payload', decode: (value) => value },
      { byteLength: (value) => value.length, split: (value) => [value] },
      () => undefined
    )
    const options = Object.defineProperty({}, 'transfer', {
      get: () => {
        throw new Error('hostile transfer')
      }
    })
    expect(() => pipeline.send({ targetId: 'b' }, () => 'message', options)).toThrow(
      'Transfer list must be an array'
    )
    expect(sends).toBe(0)
  })

  it('encodes every chunk frame before starting transport and releases on encode failure', async () => {
    let sends = 0
    let releaseCount = 0
    let unhandled: unknown
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandledRejection)
    const encodeError = new Error('frame encode failed')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
          return Promise.reject(new Error('send must not start'))
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode(value) {
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as { kind?: string }).kind === WebRpcMessageKind.chunk &&
            (value as { index?: number }).index === 1
          )
            throw encodeError
          return typeof value === 'object' && value !== null
            ? (value as { kind?: string }).kind === WebRpcMessageKind.chunk
              ? 'frame'
              : 'payload'
            : value
        },
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      undefined,
      undefined,
      () => {
        releaseCount += 1
      }
    )

    try {
      let thrown: unknown
      try {
        pipeline.send({ targetId: 'b' }, () => 'message')
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(WebRpcSerializationError)
      expect(thrown).toMatchObject({ code: 'PAYLOAD_INVALID', cause: encodeError })
      expect(sends).toBe(0)
      expect(releaseCount).toBe(1)
      await Promise.resolve()
      expect(unhandled).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('protects variation frames through the authentication capability', async () => {
    let protectedValue: unknown
    let sentValue: unknown
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value) {
          sentValue = value
        },
        subscribe: () => () => undefined
      },
      'a',
      { encodedType: 'string', encode: () => 'variation', decode: (value) => value },
      { byteLength: (value) => value.length, split: (value) => [value] },
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect(value) {
          protectedValue = value
          return `${value}:protected`
        },
        unprotect: (value) => value
      }
    )

    await pipeline.sendVariation({})
    expect(protectedValue).toBe('variation')
    expect(sentValue).toBe('variation:protected')
  })

  it('rejects a custom byteLength that undercounts canonical UTF-8 bytes', () => {
    const pipeline = new WebRpcOutboundSender(
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
    )
    expect(() => pipeline.send({ targetId: 'b' }, () => 'message')).toThrow('unsafe measurement')
  })

  it('encodes chunk metadata through the protocol boundary', async () => {
    const encoded: unknown[] = []
    const sends: unknown[] = []
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value) {
          sends.push(value)
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) => {
          encoded.push(value)
          return JSON.stringify(value)
        },
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: (value) => {
          const parts: string[] = []
          for (let index = 0; index < value.length; index += 4)
            parts.push(value.slice(index, index + 4))
          return parts
        }
      },
      () => undefined
    )
    await pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')
    const frames = encoded.slice(1) as Array<Record<string, unknown>>
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every((frame) => frame.kind === 'chunk')).toBe(true)
    expect(frames.every((frame) => frame.messageId === 'message')).toBe(true)
    expect(frames.every((frame) => frame.total === frames.length)).toBe(true)
    expect(sends).toHaveLength(frames.length)
  })

  it('rejects codec output that violates the transport type before send', () => {
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          sends += 1
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
    )
    expect(() => pipeline.send({ targetId: 'b' }, () => 'message')).toThrow(
      'Protocol encode failed'
    )
    expect(sends).toBe(0)
  })
  it('normalizes a synchronous transport throw into a rejected promise', async () => {
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          throw new Error('sync transport failure')
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
    )
    await expect(pipeline.send({ targetId: 'b' }, () => 'message')).rejects.toMatchObject({
      code: 'TRANSPORT'
    })
  })
  it('releases a chunk message id when any frame send fails', async () => {
    let released: string | undefined
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => Promise.reject(new Error('frame send failed')),
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) =>
          typeof value === 'object' &&
          value !== null &&
          (value as { kind?: string }).kind === WebRpcMessageKind.chunk
            ? JSON.stringify(value)
            : 'payload',
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: (value) => {
          const parts: string[] = []
          for (let index = 0; index < value.length; index += 4)
            parts.push(value.slice(index, index + 4))
          return parts
        }
      },
      () => undefined,
      undefined,
      undefined,
      (messageId) => {
        released = messageId
      }
    )
    await expect(
      pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')
    ).rejects.toMatchObject({ code: 'TRANSPORT' })
    expect(released).toBe('message')
  })

  it('HR-T01 waits for every frame send to settle before releasing the message id', async () => {
    let sendCount = 0
    let releaseCount = 0
    let rejectFirst: ((error: unknown) => void) | undefined
    let resolveSecond: (() => void) | undefined
    const firstFailure = new Error('first frame failed')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => {
          sendCount += 1
          if (sendCount === 1)
            return new Promise<never>((_, reject) => {
              rejectFirst = reject
            })
          return new Promise<void>((resolve) => {
            resolveSecond = resolve
          })
        },
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode: (value) =>
          typeof value === 'object' &&
          value !== null &&
          (value as { kind?: string }).kind === WebRpcMessageKind.chunk
            ? JSON.stringify(value)
            : 'payload',
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      undefined,
      undefined,
      () => {
        releaseCount += 1
      }
    )

    const result = pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')
    const observed = Promise.resolve(result).catch((error: unknown) => error)
    await vi.waitFor(() => expect(sendCount).toBe(2))

    rejectFirst?.(firstFailure)
    await Promise.resolve()
    expect(releaseCount).toBe(0)

    resolveSecond?.()
    await expect(observed).resolves.toMatchObject({
      code: 'TRANSPORT',
      cause: firstFailure
    })
    expect(releaseCount).toBe(1)
  })

  it('keeps a pending chunk id active past TTL and tombstones it after all sends settle', async () => {
    vi.useFakeTimers()
    try {
      const replay = new ReplayWindow(1, 100)
      let resolveFirst: (() => void) | undefined
      let resolveSecond: (() => void) | undefined
      let sendCount = 0
      const pipeline = new WebRpcOutboundSender(
        {
          platform: 'Memory' as const,
          encodedType: 'string',
          send: () => {
            sendCount += 1
            return new Promise<void>((resolve) => {
              if (sendCount === 1) resolveFirst = resolve
              else resolveSecond = resolve
            })
          },
          subscribe: () => () => undefined
        },
        'a',
        {
          encodedType: 'string',
          encode: (value) =>
            typeof value === 'object' &&
            value !== null &&
            (value as { kind?: string }).kind === WebRpcMessageKind.chunk
              ? JSON.stringify(value)
              : 'payload',
          decode: (value) => value
        },
        {
          chunkSize: 4,
          byteLength: (value) => value.length,
          split: () => ['payl', 'oad']
        },
        () => undefined,
        undefined,
        undefined,
        (messageId) => replay.releaseId(messageId)
      )

      const pending = pipeline.send({ targetId: 'b', data: 'payload' }, (target) => {
        expect(target).toBe('b')
        expect(replay.reserveId('message')).toBe(true)
        return 'message'
      })
      await vi.waitFor(() => expect(sendCount).toBe(2))
      vi.advanceTimersByTime(100)
      expect(replay.hasReservedId('message')).toBe(true)
      expect(replay.reserveId('message')).toBe(false)

      resolveFirst?.()
      resolveSecond?.()
      await expect(pending).resolves.toBeUndefined()
      expect(replay.hasReservedId('message')).toBe(true)
      vi.advanceTimersByTime(100)
      expect(replay.hasReservedId('message')).toBe(false)
      expect(replay.reserveId('message')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('HR-T02 keeps the frame encoding error primary when message id cleanup also fails', () => {
    const encodeError = new Error('frame encode failed')
    const cleanupError = new Error('message id cleanup failed')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => undefined,
        subscribe: () => () => undefined
      },
      'a',
      {
        encodedType: 'string',
        encode(value) {
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as { kind?: string }).kind === WebRpcMessageKind.chunk &&
            (value as { index?: number }).index === 1
          )
            throw encodeError
          return typeof value === 'object' && value !== null
            ? (value as { kind?: string }).kind === WebRpcMessageKind.chunk
              ? 'frame'
              : 'payload'
            : value
        },
        decode: (value) => value
      },
      {
        chunkSize: 4,
        byteLength: (value) => value.length,
        split: () => ['payl', 'oad']
      },
      () => undefined,
      undefined,
      undefined,
      () => {
        throw cleanupError
      }
    )

    let thrown: unknown
    try {
      pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'PAYLOAD_INVALID' })
    expect((thrown as { cause?: AggregateError }).cause).toMatchObject({
      errors: [encodeError, cleanupError]
    })
  })

  it('rejects a splitter result above the configured frame budget', () => {
    const pipeline = new WebRpcOutboundSender(
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
    )
    expect(() => pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')).toThrow(
      'Chunk splitter returned invalid frames'
    )
  })
  it('rejects parts above the receiver single-frame byte budget', () => {
    const pipeline = new WebRpcOutboundSender(
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
    )
    expect(() => pipeline.send({ targetId: 'b', data: 'payload' }, () => 'message')).toThrow(
      'Chunk splitter returned invalid frames'
    )
  })
  it.each([
    ['empty output', () => [] as string[]],
    ['non-joining output', () => ['not', 'the', 'payload']],
    ['empty part', () => ['payload', '']],
    ['non-string part', () => ['payload', 1] as never]
  ])('rejects splitter %s before allocating a message id or sending', (_name, split) => {
    let sends = 0
    let ids = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
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
    )
    expect(() =>
      pipeline.send({ targetId: 'b', data: 'payload' }, () => {
        ids += 1
        return 'message'
      })
    ).toThrow('Chunk splitter returned invalid frames')
    expect(ids).toBe(0)
    expect(sends).toBe(0)
  })

  it('rejects oversized splitter arrays before reading any part', () => {
    let indexReads = 0
    let lengthReads = 0
    let sends = 0
    let ids = 0
    const split = (): readonly string[] =>
      new Proxy(
        Array.from({ length: 3 }, () => ''),
        {
          get(target, property, receiver) {
            if (property === 'length') lengthReads += 1
            if (property !== 'length' && property !== 'join') indexReads += 1
            return Reflect.get(target, property, receiver)
          }
        }
      )
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
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
        maxChunksPerMessage: 2,
        byteLength: (value) => value.length,
        split
      },
      () => undefined
    )
    expect(() =>
      pipeline.send({ targetId: 'b', data: 'payload' }, () => {
        ids += 1
        return 'message'
      })
    ).toThrow('Chunk splitter returned invalid frames')
    expect(lengthReads).toBe(1)
    expect(indexReads).toBe(0)
    expect(ids).toBe(0)
    expect(sends).toBe(0)
  })
})
