import { describe, expect, it, vi } from 'vitest'
import { createStringFramer, createBinaryFramer } from '../src/contract/framing/index.js'
import {
  createRpcHandshakeFrameReceiver,
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../src/contract/framing/stream-index.js'
import { createRpcUnknownFieldWarner } from '../src/contract/index.js'
import { readRuntimeCarrier, normalizeRuntimeSteps } from '../src/contract/runtime-api/index.js'
import * as v1 from '../src/contract/v1/index.js'
import * as framing from '../src/contract/framing/index.js'

/** A real source/message pair exercises the public fragmentation and admission boundary. */
const context = { source: 'audit', messageId: 'one' }

describe('audited RPC contract framing', () => {
  it('publishes named V1 operations and canonical guarded framing only', () => {
    expect('default' in v1).toBe(false)
    expect('createReassembler' in framing).toBe(false)
    expect('processStringFramer' in framing).toBe(false)
    expect(typeof v1.normalizeRpcEnvelope).toBe('function')
    expect(typeof framing.remoteProcessStringFramer.accept).toBe('function')
  })
  it.each(['carrier', 'steps'] as const)(
    'classifies %s reflection failure and retains its cause',
    (kind) => {
      /** The hostile descriptor trap fails before any business field can be read. */
      const original = new Error('reflection failed')
      /** Descriptor introspection is a supported untrusted-input boundary. */
      const value =
        kind === 'carrier'
          ? new Proxy(
              {},
              {
                getOwnPropertyDescriptor: () => {
                  throw original
                }
              }
            )
          : new Proxy([], {
              ownKeys: () => {
                throw original
              }
            })
      try {
        if (kind === 'carrier') readRuntimeCarrier(value)
        else normalizeRuntimeSteps(value)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError)
        expect(error).toMatchObject({
          source: 'rpc.contract',
          code: 'INVALID_ENVELOPE',
          cause: original
        })
      }
    }
  )

  it.each(['warning', 'schedule'] as const)(
    'annotates an unclassified native %s callback error in place',
    (kind) => {
      /** Semantic identity must not replace this supported native callback failure. */
      const original = new RangeError('callback failed')
      /** The native callsite stack remains unchanged at the boundary. */
      const stack = original.stack
      /** Only the schedule branch owns a framer to close after its failed admission. */
      const framer = createStringFramer({
        chunkBytes: 1,
        schedule: () => {
          throw original
        }
      })
      try {
        expect(() => {
          if (kind === 'warning')
            createRpcUnknownFieldWarner({
              warn: () => {
                throw original
              }
            }).note('one', 'request', '', 'extra')
          else framer.accept(framer.frame('ab', context)[0], context)
        }).toThrow(original)
        expect(original).toMatchObject({ source: 'rpc.contract', code: 'CALLBACK_FAILED' })
        expect(original.stack).toBe(stack)
      } finally {
        framer.close()
      }
    }
  )

  it('sends cleanup failure to the existing host queue when reportError is absent', () => {
    /** The exact cleanup callback failure is retained at the terminal host observation. */
    const original = new Error('cancel failed')
    /** Capture the host queue without running an uncaught exception through the test runner. */
    const pending: Array<() => void> = []
    /** Host scheduling is the shared utils error boundary, not another contract reporter API. */
    const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      pending.push(task)
    })
    /** A partial assembly owns the timer whose cleanup fails. */
    const framer = createStringFramer({
      chunkBytes: 1,
      schedule: () => 1,
      cancel: () => {
        throw original
      }
    })
    vi.stubGlobal('reportError', undefined)
    try {
      framer.accept(framer.frame('ab', context)[0], context)
      expect(() => framer.close()).not.toThrow()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toThrow(original)
    } finally {
      queue.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('preserves the real fatal UTF-8 decoder error through handshake failure cause', () => {
    /** Native decode semantics remain unchanged while recording the actual original exception. */
    const NativeDecoder = globalThis.TextDecoder
    /** Only the real decoding failure, not a manufactured fixture error, can satisfy this assertion. */
    let original: unknown
    /** The subclass delegates the actual native byte validation before retaining a thrown value. */
    class ObservedDecoder extends NativeDecoder {
      override decode(...args: Parameters<TextDecoder['decode']>): string {
        try {
          return super.decode(...args)
        } catch (error) {
          original = error
          throw error
        }
      }
    }
    vi.stubGlobal('TextDecoder', ObservedDecoder)
    /** Receiver construction captures its own fatal decoder just as production does. */
    const receiver = createRpcHandshakeFrameReceiver({ role: 'initiator' })
    vi.unstubAllGlobals()
    /** This is malformed UTF-8, independent of handshake JSON grammar. */
    const failure = receiver.accept(new Uint8Array([255]))
    expect(original).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({ code: 'HANDSHAKE_INVALID', cause: original })
    receiver.close(failure)
  })

  it.each(['string', 'binary'] as const)('bounds a complete %s carrier before delivery', (kind) => {
    /** Both profiles use the same admitted message budget. */
    const framer =
      kind === 'string'
        ? createStringFramer({ chunkBytes: 2, maxMessageBytes: 4, maxBufferedBytes: 4 })
        : createBinaryFramer({ chunkBytes: 2, maxMessageBytes: 4, maxBufferedBytes: 4 })
    try {
      expect(framer.accept(kind === 'string' ? '12345' : new Uint8Array(5), context)).toMatchObject(
        {
          status: 'rejected',
          error: { source: 'rpc.contract', code: 'FRAME_LIMIT_EXCEEDED' }
        }
      )
      expect(framer.accept(kind === 'string' ? '1234' : new Uint8Array(4), context).status).toBe(
        'complete'
      )
    } finally {
      framer.close()
    }
  })

  it('stops the current chunk when its first delivery closes the decoder', () => {
    /** Deliveries are recorded independently from frame parsing. */
    const delivered: number[] = []
    /** Intentional close is terminal without reporting a malformed frame. */
    const errors: Error[] = []
    /** The first callback uses the public close operation synchronously. */
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (frame) => {
        delivered.push(frame[0]!)
        decoder.close()
      },
      onError: (error) => {
        errors.push(error)
      }
    })
    /** Two valid frames share exactly one pushed chunk. */
    const first = encodeRpcStreamFrame(new Uint8Array([1]))
    /** The second frame must never cross the terminal delivery boundary. */
    const second = encodeRpcStreamFrame(new Uint8Array([2]))
    /** A coalesced transport chunk reaches the canonical public decoder. */
    const chunk = new Uint8Array(first.length + second.length)
    chunk.set(first)
    chunk.set(second, first.length)
    decoder.push(chunk)
    expect(delivered).toEqual([1])
    expect(errors).toEqual([])
  })

  it('unlinks one assembly before cancel can reenter close', () => {
    /** Counts actual invocations on the one scheduler-owned timer handle. */
    let cancellations = 0
    /** One synchronous reentry reproduces the supported cleanup callback race. */
    let nested = false
    /** An incomplete fragmented message owns one active timer. */
    const framer = createStringFramer({
      chunkBytes: 2,
      maxMessageBytes: 4,
      maxBufferedBytes: 4,
      schedule: () => 1,
      cancel: () => {
        cancellations++
        if (!nested) {
          nested = true
          framer.close()
        }
      }
    })
    expect(framer.accept(framer.frame('1234', context)[0]!, context).status).toBe('pending')
    framer.close()
    framer.close()
    expect(cancellations).toBe(1)
  })
})
