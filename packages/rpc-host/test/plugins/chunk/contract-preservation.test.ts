/** Original contract framing business assertions now reach the actual chunk owner. */
import { describe, expect, it, vi } from 'vitest'
import {
  createStringChunkAssembler,
  createBinaryChunkAssembler
} from '../../../dist/features/chunk/assembly.js'

/** Original native source and message fixture, without a second assembler. */
const context = { source: 'audit', messageId: 'one' }

describe('migrated chunk contract assertions', () => {
  it('covers empty, exact-boundary, fragmentation, order, duplicate, and limits', () => {
    const exact = createStringChunkAssembler({ chunkBytes: 2 })
    const exactContext = { source: 'source-a', messageId: 'exact' } as const
    expect(exact.frame('ab', exactContext)).toEqual(['ab'])
    expect(exact.accept('ab', exactContext)).toEqual({ status: 'complete', value: 'ab' })
    expect(exact.frame('', exactContext)).toEqual([''])

    const framer = createStringChunkAssembler({ chunkBytes: 2, maxMessageBytes: 4 })
    const context = { source: 'source-a', messageId: 'fragmented' } as const
    const frames = framer.frame('abcd', context)
    expect(framer.accept(frames[1]!, context).status).toBe('rejected')
    expect(framer.accept(frames[0]!, context).status).toBe('pending')
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')
    expect(framer.accept(frames[1]!, context)).toEqual({ status: 'complete', value: 'abcd' })
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')

    const binary = createBinaryChunkAssembler({ chunkBytes: 2, maxMessageBytes: 4 })
    const binaryContext = { source: 'source-a', messageId: 'binary' } as const
    const binaryFrames = binary.frame(new Uint8Array([1, 2, 3, 4]), binaryContext)
    expect(binary.accept({ ...binaryFrames[0]!, index: 9 }, binaryContext).status).toBe('rejected')
    expect(() => binary.frame(new Uint8Array([1, 2, 3, 4, 5]), binaryContext)).toThrow()
  })

  it('keeps NUL-delimited source/message pairs collision-free and drains resources', () => {
    const timers: Array<() => void> = []
    let cancelled = 0
    const framer = createStringChunkAssembler({
      chunkBytes: 2,
      schedule: (callback) => {
        timers.push(callback)
        return timers.length
      },
      cancel: () => {
        cancelled += 1
      }
    })
    const first = { source: 'left', messageId: 'right\u0000tail' } as const
    const second = { source: 'left\u0000right', messageId: 'tail' } as const
    const firstFrames = framer.frame('abcd', first)
    const secondFrames = framer.frame('efgh', second)
    expect(framer.accept(firstFrames[0]!, first)).toEqual({ status: 'pending' })
    expect(framer.accept(secondFrames[0]!, second)).toEqual({ status: 'pending' })
    expect(framer.accept(firstFrames[1]!, first)).toEqual({ status: 'complete', value: 'abcd' })
    expect(framer.accept(secondFrames[1]!, second)).toEqual({ status: 'complete', value: 'efgh' })
    expect(cancelled).toBe(2)
    for (const timer of timers) timer()
    expect(framer.accept(firstFrames[0]!, first).status).toBe('rejected')
    expect(framer.accept(secondFrames[0]!, second).status).toBe('rejected')
    framer.close()
    expect(cancelled).toBe(2)
  })

  it('isolates sources, bounds concurrency, and keeps cleanup failures secondary', () => {
    const pendingTimers: Array<() => void> = []
    const reported: unknown[] = []
    const previousReporter = (globalThis as unknown as { reportError?: (value: unknown) => void })
      .reportError
    ;(globalThis as unknown as { reportError?: (value: unknown) => void }).reportError = (
      error
    ) => {
      reported.push(error)
    }
    try {
      const framer = createStringChunkAssembler({
        chunkBytes: 2,
        maxConcurrentMessages: 1,
        schedule: (callback) => {
          pendingTimers.push(callback)
          return pendingTimers.length
        },
        cancel: () => {
          throw new Error('cleanup failed')
        }
      })
      const first = { source: 'source-a', messageId: 'same' } as const
      const second = { source: 'source-b', messageId: 'same' } as const
      const firstFrames = framer.frame('abcd', first)
      const secondFrames = framer.frame('efgh', second)
      expect(framer.accept(firstFrames[0]!, first)).toEqual({ status: 'pending' })
      expect(framer.accept(secondFrames[0]!, second).status).toBe('rejected')
      expect(framer.accept(firstFrames[1]!, first)).toEqual({ status: 'complete', value: 'abcd' })
      expect(reported).toHaveLength(1)
      pendingTimers[0]?.()
      expect(framer.accept(firstFrames[0]!, first).status).toBe('rejected')
      framer.close()
      expect(framer.accept(secondFrames[0]!, second).status).toBe('rejected')
      expect(reported).toHaveLength(1)
    } finally {
      ;(globalThis as unknown as { reportError?: (value: unknown) => void }).reportError =
        previousReporter
    }
  })

  it('expires missing fragments and rejects late completion without rebuilding state', () => {
    let expire: (() => void) | undefined
    const framer = createStringChunkAssembler({
      chunkBytes: 2,
      schedule: (callback) => {
        expire = callback
        return 1
      },
      cancel: () => undefined
    })
    const context = { source: 'source-a', messageId: 'deadline' } as const
    const frames = framer.frame('abcd', context)
    expect(framer.accept(frames[0]!, context)).toEqual({ status: 'pending' })
    expire?.()
    const late = framer.accept(frames[1]!, context)
    expect(late.status).toBe('rejected')
    expect((late as { status: 'rejected'; error: Error }).error).toMatchObject({
      code: 'FRAME_ASSEMBLY_EXPIRED'
    })
  })

  it('reassembles ordered strings and isolates source keys', () => {
    const framer = createStringChunkAssembler({ chunkBytes: 2, assemblyTimeoutMs: 10_000 })
    const context = { source: 'peer-a', messageId: 'message-a' } as const
    const frames = framer.frame('abcd', context)
    expect(frames).toHaveLength(2)
    expect(framer.accept(frames[0]!, context)).toEqual({ status: 'pending' })
    expect(framer.accept(frames[1]!, context)).toEqual({ status: 'complete', value: 'abcd' })
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')
  })

  it('reassembles ordered binary fragments into one contiguous byte array', () => {
    const framer = createBinaryChunkAssembler({ chunkBytes: 2, assemblyTimeoutMs: 10_000 })
    const context = { source: 'peer-a', messageId: 'message-bytes' } as const
    const frames = framer.frame(new Uint8Array([1, 2, 3, 4, 5]), context)
    expect(frames).toHaveLength(3)
    expect(framer.accept(frames[0]!, context)).toEqual({ status: 'pending' })
    expect(framer.accept(frames[1]!, context)).toEqual({ status: 'pending' })
    const complete = framer.accept(frames[2]!, context)
    expect(complete.status).toBe('complete')
    expect(complete.status === 'complete' && complete.value).toEqual(
      new Uint8Array([1, 2, 3, 4, 5])
    )
  })

  it('rejects out-of-order and over-limit binary fragments before semantic decoding', () => {
    const framer = createBinaryChunkAssembler({ chunkBytes: 2, maxMessageBytes: 4 })
    const context = { source: 'peer-a', messageId: 'message-b' } as const
    const frames = framer.frame(new Uint8Array([1, 2, 3, 4]), context)
    expect(framer.accept(frames[1]!, context).status).toBe('rejected')
    expect(framer.accept(frames[0]!, context).status).toBe('pending')
  })

  it('reports expiration and bounds terminal history after an assembly timeout', () => {
    let scheduled: (() => void) | undefined
    const framer = createStringChunkAssembler({
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

  it('rejects a complete carrier from the wrong fixed framer profile', () => {
    const context = { source: 'x', messageId: 'fixed' }
    expect(createBinaryChunkAssembler().accept('not bytes', context).status).toBe('rejected')
    expect(createStringChunkAssembler().accept(new Uint8Array([1]), context).status).toBe(
      'rejected'
    )
    expect(createBinaryChunkAssembler().accept(new Uint8Array([1]), context)).toMatchObject({
      status: 'complete'
    })
    expect(createStringChunkAssembler().accept('text', context)).toMatchObject({
      status: 'complete'
    })
  })

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
    const framer = createStringChunkAssembler({
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

  it.each(['string', 'binary'] as const)('bounds a complete %s carrier before delivery', (kind) => {
    /** Both profiles use the same admitted message budget. */
    const framer =
      kind === 'string'
        ? createStringChunkAssembler({ chunkBytes: 2, maxMessageBytes: 4, maxBufferedBytes: 4 })
        : createBinaryChunkAssembler({ chunkBytes: 2, maxMessageBytes: 4, maxBufferedBytes: 4 })
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

  it('unlinks one assembly before cancel can reenter close', () => {
    /** Counts actual invocations on the one scheduler-owned timer handle. */
    let cancellations = 0
    /** One synchronous reentry reproduces the supported cleanup callback race. */
    let nested = false
    /** An incomplete fragmented message owns one active timer. */
    const framer = createStringChunkAssembler({
      chunkBytes: 2,
      maxMessageBytes: 4,
      maxBufferedBytes: 4,
      /** Keep this cleanup race within its explicit per-source admission allowance. */
      maxBufferedBytesPerSource: 4,
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

it.each(['schedule'] as const)(
  'annotates an unclassified native %s callback error in place',
  () => {
    /** Semantic identity must not replace this supported native callback failure. */
    const original = new RangeError('callback failed')
    /** The native callsite stack remains unchanged at the boundary. */
    const stack = original.stack
    /** Only the schedule branch owns a framer to close after its failed admission. */
    const framer = createStringChunkAssembler({
      chunkBytes: 1,
      schedule: () => {
        throw original
      }
    })
    try {
      expect(() => {
        framer.accept(framer.frame('ab', context)[0], context)
      }).toThrow(original)
      expect(original).toMatchObject({ source: 'rpc.contract', code: 'CALLBACK_FAILED' })
      expect(original.stack).toBe(stack)
    } finally {
      framer.close()
    }
  }
)

it('preserves single frame-field reads and the exact native getter failure', () => {
  const framer = createStringChunkAssembler({ chunkBytes: 2 })
  const context = { source: 'source-a', messageId: 'native' }
  const frame = framer.frame('abcd', context)[0] as Record<string, unknown>
  const reads = new Map<string, number>()
  const hostile = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.keys(frame).map((key) => [
        key,
        {
          enumerable: true,
          get() {
            reads.set(key, (reads.get(key) ?? 0) + 1)
            return frame[key]
          }
        }
      ])
    )
  )
  expect(framer.accept(hostile, context).status).toBe('pending')
  expect([...reads.values()]).toEqual([1, 1, 1, 1, 1])
  const original = new Error('getter')
  let throwingReads = 0
  const throwing = {
    get messageId() {
      throwingReads++
      throw original
    }
  }
  expect(framer.accept(throwing, context)).toMatchObject({
    status: 'rejected',
    error: { code: 'INVALID_FRAME', source: 'rpc.contract', cause: original }
  })
  expect(throwingReads).toBe(1)
  framer.close()
})

it('retains the exact original frame cause as a non-enumerable property', () => {
  const original = new Error('prototype refused')
  const framer = createStringChunkAssembler()
  const frame = new Proxy(
    {},
    {
      get() {
        throw original
      }
    }
  )
  const result = framer.accept(frame, { source: 'x', messageId: 'm' })
  expect(result.status).toBe('rejected')
  if (result.status !== 'rejected') throw new Error('invalid frame was accepted')
  const frameError = result.error
  expect(frameError).toBeInstanceOf(RangeError)
  expect(frameError).toMatchObject({ code: 'INVALID_FRAME' })
  expect(frameError.cause).toBe(original)
  expect(Object.getOwnPropertyDescriptor(frameError, 'cause')?.enumerable).toBe(false)
  framer.close()
})

it('rejects forged byte views through the original native chunk owner', () => {
  const ordinary = new DataView(new ArrayBuffer(2))
  const tagged = new DataView(new ArrayBuffer(2))
  Object.defineProperty(tagged, Symbol.toStringTag, { value: 'Uint8Array' })
  const forged = Object.create(Uint8Array.prototype) as Uint8Array
  const ordinaryFrame = createBinaryChunkAssembler().accept(ordinary, {
    source: 'peer',
    messageId: 'frame'
  })
  expect(ordinaryFrame.status).toBe('rejected')
  for (const value of [tagged, forged]) {
    const frame = createBinaryChunkAssembler().accept(value, { source: 'peer', messageId: 'frame' })
    expect(frame.status).toBe('rejected')
    if (frame.status === 'rejected' && ordinaryFrame.status === 'rejected') {
      expect(frame.error.constructor).toBe(ordinaryFrame.error.constructor)
      expect(frame.error).toMatchObject({ code: Reflect.get(ordinaryFrame.error, 'code') })
    }
  }
})
