import { Buffer } from 'node:buffer'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import * as codecBoundary from '../src/codec.ts'
import { identityCodec } from '../src/codecs/identity/v1.ts'
// @ts-expect-error removes this synonym; ISerializeChunkKind is the canonical public name.
import type { ISerializeChunkType as IRetiredChunkType } from '../src/core.ts'
import {
  base64ToBytes,
  chunkToBytes,
  chunkToText,
  collectStream,
  createSerializeRegistry,
  decodeStream,
  isChunkShape,
  jsonParser,
  SerializeErrorCode,
  tagSerializeError,
  type ISerializeChunk
} from '../src/index.ts'

describe('serialize audited ownership and failure contracts', () => {
  it('expose canonical entries without helper or compatibility exports', () => {
    for (const retired of ['assertCodecVersion', 'createCodecError', 'identityCodecV1'])
      expect(Object.hasOwn(codecBoundary, retired)).toBe(false)
    expectTypeOf<IRetiredChunkType>().toBeAny()
    expect(identityCodec.version).toBe(1)
    expect(Object.isFrozen(identityCodec)).toBe(true)
  })

  it('copies Buffer-backed chunks into independently owned bytes', () => {
    /** Buffer is a supported Uint8Array subclass whose slice() shares its backing storage. */
    const original = Buffer.from([1, 2])
    /** Conversion must not borrow the caller's storage or delegate copying to its slice method. */
    const copy = chunkToBytes(['bytes', original], new TextEncoder())
    copy[0] = 9
    expect(original[0]).toBe(1)
    expect(copy.buffer).not.toBe(original.buffer)
    expect(copy).toBeInstanceOf(Uint8Array)
  })

  it.each([false, true])('rejects undefined iterator failures, async=%s', async (asynchronous) => {
    /** Empty and partially collected streams must both retain an unknown thrown failure. */
    function* values(): Generator<ISerializeChunk> {
      if (asynchronous) yield ['text', 'partial']
      throw undefined
    }
    /** Both supported iterator forms use the same collector failure owner. */
    const source = asynchronous
      ? (async function* () {
          yield* values()
        })()
      : values()
    await expect(collectStream(source)).rejects.toMatchObject({
      source: 'serialization',
      code: 'ENCODE_FAILED',
      phase: 'encode',
      chunkIndex: asynchronous ? 1 : 0
    })
  })

  it('keeps collector cancellation at the public ABORTED boundary', async () => {
    /** The caller must find its native cancellation reason directly on the abort failure. */
    const reason = new DOMException('stop', 'AbortError')
    /** Pre-abort proves the collector does not translate its own cancellation into encoding failure. */
    const controller = new AbortController()
    controller.abort(reason)
    await expect(
      collectStream([['text', 'x']], undefined, { signal: controller.signal })
    ).rejects.toMatchObject({ source: 'serialization', code: 'ABORTED', cause: reason })
  })

  it('delegates identity conflicts to the canonical utils owner with the original cause', () => {
    /** The first semantic identity cannot be rewritten by a second tag request. */
    const original = tagSerializeError(new Error('original'), SerializeErrorCode.encodeFailed)
    expect(() => tagSerializeError(original, SerializeErrorCode.decodeFailed)).toThrowError(
      expect.objectContaining({
        source: 'foundation.utils',
        code: 'ERROR_IDENTITY_CONFLICT',
        cause: original
      })
    )
  })

  it('retains the canonical Base64 failure behind the serialize diagnostic', () => {
    try {
      base64ToBytes('!')
    } catch (error) {
      expect(error).toMatchObject({
        source: 'serialization',
        code: 'INVALID_OPTION',
        cause: expect.objectContaining({ source: 'foundation.utils', code: 'INVALID_ENCODING' })
      })
      return
    }
    expect.unreachable('invalid Base64 must fail')
  })

  it('tags standalone JSON failures while retaining native types and callback identity', () => {
    /** Standalone parser calls must carry the same package identity as registry calls. */
    const parser = jsonParser()
    /** Parser context is irrelevant to pure JSON but remains part of its public call contract. */
    const context = { signal: new AbortController().signal, context: 'audit' }
    expect(() => parser.decode(['text', '{'], context)).toThrowError(
      expect.objectContaining({
        name: 'SyntaxError',
        source: 'serialization',
        code: 'DECODE_FAILED'
      })
    )
    expect(() => parser.encode(1n, context)).toThrowError(
      expect.objectContaining({
        name: 'TypeError',
        source: 'serialization',
        code: 'ENCODE_FAILED'
      })
    )
    /** An already existing native callback failure can be annotated without rebuilding it. */
    const failure = new SyntaxError('callback')
    /** Replacer is an explicitly supported user callback. */
    const rejecting = jsonParser({
      replacer: () => {
        throw failure
      }
    })
    expect(() => rejecting.encode({}, context)).toThrow(failure)
    expect(failure).toMatchObject({ source: 'serialization', code: 'ENCODE_FAILED' })
  })

  it('preserves a decoder native code on the original cause and tags the conversion boundary', () => {
    /** Native TextDecoder failures may already own a host-specific code without semantic source. */
    const original = Object.assign(new TypeError('native decoder'), { code: 'ERR_NATIVE_ENCODING' })
    try {
      chunkToText(['bytes', new Uint8Array([255])], {
        decode: () => {
          throw original
        }
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({ source: 'serialization', code: 'DECODE_FAILED' })
      expect(walkErrorCauses(error)).toContain(original)
      return
    }
    expect.unreachable('decoder must fail')
  })

  it('reports a detached parser rejection before registry disposal', async () => {
    /** A parser that ignores abort still owns a task whose later failure requires reporting. */
    let rejectParser!: (error: unknown) => void
    /** The task deliberately outlives the caller's cancelled result. */
    const task = new Promise<ISerializeChunk>((_resolve, reject) => {
      rejectParser = reject
    })
    /** Reports retain failures rather than merely counting them. */
    const reports: unknown[] = []
    /** Registry remains open when the detached parser fails. */
    const registry = createSerializeRegistry(
      [
        {
          type: 'late',
          parser: {
            name: 'late',
            encode: () => task,
            decode: () => undefined
          }
        }
      ],
      { report: (error) => reports.push(error) }
    )
    /** Cancellation settles the public result before the parser rejects. */
    const controller = new AbortController()
    /** Attach observation before cancellation. */
    const pending = registry.encode(1, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    /** The failure itself remains reachable in the single late diagnostic. */
    const failure = new Error('late parser')
    rejectParser(failure)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(reports).toHaveLength(1)
    expect(walkErrorCauses(reports[0])).toContain(failure)
    await registry.dispose()
  })

  it('narrows only the candidate tuple shape without claiming a validated chunk', () => {
    /** Invalid tags must still reach the canonical chunk validator for precise diagnostics. */
    const candidate: unknown = ['wrong', 123]
    expect(isChunkShape(candidate)).toBe(true)
    if (isChunkShape(candidate)) expectTypeOf(candidate).toEqualTypeOf<readonly [string, unknown]>()
  })

  it('checks cancellation before the first and every subsequent iterator pull', async () => {
    /** Pull count measures the actual source side effect, independently of the returned error. */
    let pulls = 0
    /** A reusable source exposes two decode opportunities. */
    const source = {
      *[Symbol.iterator](): Generator<ISerializeChunk> {
        pulls++
        yield ['text', '1']
        pulls++
        yield ['text', '2']
      }
    }
    /** Pure JSON keeps this observation at the public decode-stream boundary. */
    const registry = createSerializeRegistry([{ type: 'json', parser: jsonParser() }])
    /** First cancellation happens before any iterator acquisition. */
    const pre = new AbortController()
    pre.abort()
    await expect(
      decodeStream(registry, source, { signal: pre.signal }).next()
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(pulls).toBe(0)
    /** The next cancellation happens while the consumer holds its first yielded value. */
    const controller = new AbortController()
    /** Keep the same iterator across consumer turns. */
    const stream = decodeStream(registry, source, { signal: controller.signal })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: 1 })
    controller.abort()
    await expect(stream.next()).rejects.toMatchObject({ code: 'ABORTED' })
    expect(pulls).toBe(1)
    await registry.dispose()
  })
})
