import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  createDescriptor,
  deserializeRpcError,
  normalizePortable,
  normalizeRpcEnvelope,
  serializeRpcError
} from '../src/index.js'
import {
  bindRpcFrameIngress,
  createBinaryFramer,
  createStringFramer
} from '../src/framing/index.js'

const packageRoot = dirname(dirname(decodeURI(import.meta.url).replace(/^file:\/\//u, '')))

/** Walk a package source tree for the closed-world architecture assertion. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

describe('RPCC-T01 architecture and export boundary', () => {
  it('publishes only runtime-neutral root/framing exports and dependencies', () => {
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      exports?: Record<string, unknown>
    }
    expect(metadata.dependencies ?? {}).toEqual({})
    expect(metadata.exports).toMatchObject({
      '.': expect.any(Object),
      './framing': expect.any(Object)
    })
    const forbidden = /(?:node:|@migaia\/(?:store|web-rpc)|@msgpack\/msgpack|cbor-x|protobuf)/u
    for (const path of sourceFiles(join(packageRoot, 'src'))) {
      expect(readFileSync(path, 'utf8')).not.toMatch(forbidden)
    }
  })
})

describe('RPCC-T02 descriptor identity', () => {
  it('freezes exact identities and rejects invalid versions before publication', () => {
    const descriptor = createDescriptor('test.protocol', 7)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(descriptor).toEqual({ id: 'test.protocol', version: 7 })
    const invalid = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]
    for (const version of invalid)
      expect(() => createDescriptor('test.protocol', version)).toThrow()
    expect(() => createDescriptor('Bad Protocol', 1)).toThrow()
  })
})

describe('RPCC-T04 hostile normalization', () => {
  it('snapshots every envelope getter once and fails closed with causes', () => {
    const reads = new Map<string, number>()
    const input = {
      get kind() {
        reads.set('kind', (reads.get('kind') ?? 0) + 1)
        return 'request'
      },
      get id() {
        reads.set('id', (reads.get('id') ?? 0) + 1)
        return 'request-1'
      },
      get method() {
        reads.set('method', (reads.get('method') ?? 0) + 1)
        return 'ping'
      },
      get data() {
        reads.set('data', (reads.get('data') ?? 0) + 1)
        return null
      }
    }
    expect(normalizeRpcEnvelope(input)).toMatchObject({ kind: 'request', id: 'request-1' })
    expect([...reads.values()]).toEqual([1, 1, 1, 1])

    const original = new Error('getter failed')
    const hostile = {
      kind: 'request',
      id: 'request-2',
      method: 'ping',
      get data() {
        throw original
      }
    }
    try {
      normalizeRpcEnvelope(hostile)
      expect.unreachable('hostile getter must fail')
    } catch (error) {
      expect((error as Error & { cause?: unknown }).cause).toBe(original)
    }
    expect(() => normalizeRpcEnvelope({ kind: 'forged', id: '1', data: null })).toThrow()
    const foreignPrototype = Object.create({ inherited: true }) as Record<string, unknown>
    foreignPrototype.kind = 'request'
    foreignPrototype.id = '1'
    foreignPrototype.method = 'ping'
    foreignPrototype.data = null
    expect(() => normalizeRpcEnvelope(foreignPrototype)).toThrow()
  })
})

describe('RPCC-T05 portable vectors', () => {
  it('accepts canonical values and rejects the complete forbidden matrix', () => {
    const vectors = JSON.parse(
      readFileSync(join(packageRoot, 'schema/vectors/portable-values.json'), 'utf8')
    ) as { cases: Array<{ value: unknown }> }
    for (const vector of vectors.cases)
      expect(normalizePortable(vector.value)).toEqual(vector.value)
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const invalid: unknown[] = [
      new Date(),
      new Map(),
      new Set(),
      cycle,
      () => undefined,
      Symbol('invalid'),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { $rpc: 'bytes', base64url: 'A' },
      { $rpc: 'bytes', base64url: 'AB' },
      { $rpc: 'bytes', base64url: 'AA=' },
      { $rpc: 'reserved', value: 'invalid' }
    ]
    for (const value of invalid) expect(() => normalizePortable(value)).toThrow()
  })
})

describe('RPCC-T06 serialized error graphs', () => {
  it('preserves foreign realm identity, stack, cause order, and aggregate errors', () => {
    const context = createContext({})
    const remote = runInContext(
      `(() => {
        const cause = new RangeError('remote cause')
        Object.defineProperty(cause, 'source', { value: '@remote', enumerable: true })
        Object.defineProperty(cause, 'code', { value: 'REMOTE_CAUSE', enumerable: true })
        const cleanup = new Error('cleanup')
        const root = new TypeError('remote root')
        Object.defineProperty(root, 'source', { value: '@remote', enumerable: true })
        Object.defineProperty(root, 'code', { value: 'REMOTE_ROOT', enumerable: true })
        Object.defineProperty(root, 'cause', { value: cause })
        Object.defineProperty(root, 'errors', { value: [cleanup] })
        return root
      })()`,
      context
    )
    const wire = serializeRpcError(remote)
    expect(wire).toMatchObject({ source: '@remote', code: 'REMOTE_ROOT', name: 'TypeError' })
    expect(wire.stack).toBeTypeOf('string')
    expect(wire.cause?.code).toBe('REMOTE_CAUSE')
    expect(wire.errors?.[0]?.message).toBe('cleanup')
    const restored = deserializeRpcError(wire)
    expect(restored).toBeInstanceOf(TypeError)
    expect(restored.stack).toBe(wire.stack)
    expect((restored as Error & { cause: Error }).cause).toBeInstanceOf(RangeError)
    expect((restored as Error & { errors: Error[] }).errors[0]?.message).toBe('cleanup')
  })
})

describe('RPCC-T07 framing matrix', () => {
  it('prepares native ingress once without reflecting opaque custom frames', () => {
    const framer = createStringFramer({ chunkBytes: 2 })
    const context = { source: 'source-a', messageId: 'native' } as const
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
    const prepare = bindRpcFrameIngress(framer.accept)
    expect(Object.isExtensible(prepare)).toBe(true)
    Object.defineProperty(prepare, 'clientTag', { value: 'retained' })
    expect((prepare as typeof prepare & { clientTag: string }).clientTag).toBe('retained')
    expect(prepare.nativeOutputDomain).toBeUndefined()
    const prepared = prepare(hostile as never, context)
    expect(prepared.messageId).toBe('native')
    expect([...reads.values()]).toEqual([1, 1, 1, 1, 1, 1])
    expect(framer.accept(prepared.frame, context).status).toBe('pending')
    const spread = { ...framer }
    const native = bindRpcFrameIngress(spread.accept, spread.frame)
    expect(native(hostile as never, context).messageId).toBe('native')
    expect(native.nativeOutputDomain).toEqual({
      kind: 'carrier-or-fragment',
      carrierEncodedType: 'string'
    })
    expect(Object.isFrozen(native.nativeOutputDomain)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(native, 'nativeOutputDomain')).toMatchObject({
      enumerable: true,
      configurable: false,
      writable: false
    })
    const binary = createBinaryFramer({ chunkBytes: 2 })
    expect(bindRpcFrameIngress(binary.accept, binary.frame).nativeOutputDomain).toEqual({
      kind: 'carrier-or-fragment',
      carrierEncodedType: 'uint8array'
    })
    const opaqueReads = { value: 0 }
    const opaque = {
      get kind() {
        opaqueReads.value += 1
        return 'rpc.frame.v1'
      }
    }
    const wrapped: typeof framer.accept = (value, inner) => framer.accept(value, inner)
    const customFrame = (value: string) => [value] as const
    expect(bindRpcFrameIngress(framer.accept, customFrame).nativeOutputDomain).toBeUndefined()
    expect(bindRpcFrameIngress(wrapped, customFrame)(opaque as never, context).frame).toBe(opaque)
    expect(bindRpcFrameIngress(wrapped, customFrame).nativeOutputDomain).toBeUndefined()
    expect(bindRpcFrameIngress(wrapped, framer.frame).nativeOutputDomain).toEqual({
      kind: 'carrier-or-fragment',
      carrierEncodedType: 'string'
    })
    expect(opaqueReads.value).toBe(0)
    expect(
      bindRpcFrameIngress((() => ({ status: 'pending' })) as never)(
        { nope: true } as never,
        context
      )
    ).toMatchObject({ frame: { nope: true }, messageId: 'whole' })
    const original = new Error('getter')
    let throwingReads = 0
    const throwing = {
      get kind() {
        throwingReads += 1
        throw original
      }
    }
    expect(() => prepare(throwing as never, context)).toThrow(
      expect.objectContaining({ cause: original })
    )
    expect(throwingReads).toBe(1)
    throwingReads = 0
    expect(framer.accept(throwing as never, context)).toMatchObject({
      status: 'rejected',
      error: { code: 'INVALID_FRAME', source: '@migaia/rpc-contract', cause: original }
    })
    expect(throwingReads).toBe(1)
  })
  it('covers empty, exact-boundary, fragmentation, order, duplicate, and limits', () => {
    const exact = createStringFramer({ chunkBytes: 2 })
    const exactContext = { source: 'source-a', messageId: 'exact' } as const
    expect(exact.frame('ab', exactContext)).toEqual(['ab'])
    expect(exact.accept('ab', exactContext)).toEqual({ status: 'complete', value: 'ab' })
    expect(exact.frame('', exactContext)).toEqual([''])

    const framer = createStringFramer({ chunkBytes: 2, maxMessageBytes: 4 })
    const context = { source: 'source-a', messageId: 'fragmented' } as const
    const frames = framer.frame('abcd', context)
    expect(framer.accept(frames[1]!, context).status).toBe('rejected')
    expect(framer.accept(frames[0]!, context).status).toBe('pending')
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')
    expect(framer.accept(frames[1]!, context)).toEqual({ status: 'complete', value: 'abcd' })
    expect(framer.accept(frames[0]!, context).status).toBe('rejected')

    const binary = createBinaryFramer({ chunkBytes: 2, maxMessageBytes: 4 })
    const binaryContext = { source: 'source-a', messageId: 'binary' } as const
    const binaryFrames = binary.frame(new Uint8Array([1, 2, 3, 4]), binaryContext)
    expect(binary.accept({ ...binaryFrames[0]!, index: 9 }, binaryContext).status).toBe('rejected')
    expect(() => binary.frame(new Uint8Array([1, 2, 3, 4, 5]), binaryContext)).toThrow()
  })
})

describe('RPCC-T08 framing races and cleanup', () => {
  it('keeps NUL-delimited source/message pairs collision-free and drains resources', () => {
    const timers: Array<() => void> = []
    let cancelled = 0
    const framer = createStringFramer({
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
      const framer = createStringFramer({
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
      framer.close('race complete')
      expect(framer.accept(secondFrames[0]!, second).status).toBe('rejected')
      expect(reported).toHaveLength(1)
    } finally {
      ;(globalThis as unknown as { reportError?: (value: unknown) => void }).reportError =
        previousReporter
    }
  })

  it('expires missing fragments and rejects late completion without rebuilding state', () => {
    let expire: (() => void) | undefined
    const framer = createStringFramer({
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
})
