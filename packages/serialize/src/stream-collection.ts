/**
 * Owns stream collector iterator/encoder admission, failure projection, and final chunk joining. It
 * never starts source iteration or changes the caller's async resumption boundaries.
 */
import type { ITextEncoder, ISerializeChunk } from './types.ts'
import type { ICollectStreamSnapshot } from './operation-options.ts'
import { SerializeCodecError, encodeSerializeTextChunk } from './types.ts'
import { createSerializeError, SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { SerializeChunkKind, SerializePhase } from './format-constants.ts'
import { SerializeContext, SerializeCollectEmpty } from './operation-constants.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'
import { isSerializeTaggedError, reasonOf, streamOptionFailure } from './operation-support.ts'

/** Captured protocol method invoked only with its once-admitted original receiver. */
type ISerializeInvokable<TResult> = (...args: never[]) => TResult

/** Captures an encoder method once and preserves its receiver across mixed collection. */
export function snapshotCollectEncoder(
  encoder: ITextEncoder | undefined
): ITextEncoder | undefined {
  if (encoder === undefined) return undefined
  try {
    if (encoder === null || (typeof encoder !== 'object' && typeof encoder !== 'function'))
      throw new TypeError(SerializeErrorText.encoderInvalid)
    /** Structural encoder view admits its capability without invoking it or reading it twice. */
    const target = encoder as { readonly encode?: unknown }
    /** Encoder capability is read once so later mutation cannot replace admitted behavior. */
    let method: unknown
    method = target.encode
    if (typeof method !== 'function') throw new TypeError(SerializeErrorText.encoderInvalid)
    /** Original host object preserves the method receiver across collection. */
    const receiver = encoder as object
    return {
      /** Captured encoder receiver boundary keeps the original host object as the method receiver. */
      encode: (input: string): Uint8Array =>
        Reflect.apply(method as ISerializeInvokable<Uint8Array>, receiver, [input])
    }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Resolves exactly one async or sync iterator after option and cancellation admission. */
export function getCollectIterator(
  source: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>
): AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> {
  try {
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = source as {
      readonly [Symbol.asyncIterator]?: () => AsyncIterator<ISerializeChunk>
      readonly [Symbol.iterator]?: () => Iterator<ISerializeChunk>
    }
    /** Async protocol takes precedence without reading the synchronous factory. */
    const asyncFactory = candidate[Symbol.asyncIterator]
    if (asyncFactory !== undefined) {
      if (typeof asyncFactory !== 'function')
        throw new TypeError(SerializeErrorText.collectOptionInvalid)
      /** Original protocol receiver is retained by the admitted next/return callbacks. */
      const sourceIterator = Reflect.apply(
        asyncFactory as ISerializeInvokable<AsyncIterator<ISerializeChunk>>,
        candidate as object,
        []
      )
      /** Next method is captured once before source iteration begins. */
      const next = sourceIterator.next
      /** Return capability is captured once and only invoked during abnormal completion. */
      const close = sourceIterator.return
      return {
        next: (): Promise<IteratorResult<ISerializeChunk>> =>
          Reflect.apply(
            next as ISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,
            sourceIterator as object,
            []
          ),
        return: close
          ? (): Promise<IteratorResult<ISerializeChunk>> =>
              Reflect.apply(
                close as ISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,
                sourceIterator as object,
                []
              )
          : undefined
      }
    }
    /** Synchronous protocol is captured only when the async factory is absent. */
    const syncFactory = candidate[Symbol.iterator]
    if (syncFactory !== undefined) {
      if (typeof syncFactory !== 'function')
        throw new TypeError(SerializeErrorText.collectOptionInvalid)
      /** Original protocol receiver is retained by the admitted next/return callbacks. */
      const sourceIterator = Reflect.apply(
        syncFactory as ISerializeInvokable<Iterator<ISerializeChunk>>,
        candidate as object,
        []
      )
      /** Next method is captured once before source iteration begins. */
      const next = sourceIterator.next
      /** Return capability is captured once and only invoked during abnormal completion. */
      const close = sourceIterator.return
      return {
        next: (): IteratorResult<ISerializeChunk> =>
          Reflect.apply(
            next as ISerializeInvokable<IteratorResult<ISerializeChunk>>,
            sourceIterator as object,
            []
          ),
        return: close
          ? (): IteratorResult<ISerializeChunk> =>
              Reflect.apply(
                close as ISerializeInvokable<IteratorResult<ISerializeChunk>>,
                sourceIterator as object,
                []
              )
          : undefined
      }
    }
    throw new TypeError(SerializeErrorText.collectOptionInvalid)
  } catch (error) {
    if (isSerializeTaggedError(error, SerializeErrorCode.invalidOption)) throw error
    throw new SerializeCodecError(SerializeDiagnosticText.streamCollectFailed(0, reasonOf(error)), {
      type: SerializeContext.stream,
      phase: SerializePhase.encode,
      context: SerializeContext.stream,
      chunkIndex: 0,
      bytesConsumed: 0,
      code: SerializeErrorCode.encodeFailed,
      cause: error
    })
  }
}

/** Calls iterator return at most once and reports cleanup failure without replacing primary. */
export async function closeCollectIterator(
  iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined,
  completed: boolean
): Promise<unknown> {
  if (iterator === undefined || completed) return undefined
  try {
    /** Return capability is captured once and only invoked during abnormal completion. */
    const close = iterator.return
    if (typeof close !== 'function') return undefined
    await close()
    return undefined
  } catch (error) {
    return createSerializeError(
      SerializeErrorCode.encodeFailed,
      SerializeErrorText.collectCleanupFailed,
      {
        cause: error
      }
    )
  }
}

/**
 * Joins admitted chunks once; the whole batch performs O(n) work over chunks and payload bytes.
 * Temporary text encodings finish before output allocation, so a failed encoder emits no partial
 * result.
 */
export function mergeCollectedStream(
  collected: readonly ISerializeChunk[],
  sawBytes: boolean,
  chunkProgress: readonly number[],
  encoder: ITextEncoder | undefined,
  options: ICollectStreamSnapshot
): ISerializeChunk {
  if (collected.length === 0) {
    if (options.empty === SerializeCollectEmpty.reject)
      throw createSerializeError(SerializeErrorCode.encodeFailed, SerializeErrorText.collectEmpty, {
        context: options.context
      })
    return [SerializeChunkKind.text, '']
  }
  if (collected.length === 1) return collected[0]
  if (!sawBytes) {
    // Joining once avoids repeatedly copying the accumulated string for a
    // long stream (which otherwise turns collection into quadratic work).
    return [SerializeChunkKind.text, collected.map((chunk) => chunk[1] as string).join('')]
  }
  // core 无默认 Encoding adapter：出现 bytes 需要合并时必须注入 encoder，不直接使用宿主 TextEncoder。
  /** Admitted encoder is required for any multi-chunk result containing bytes. */
  const enc = encoder
  if (enc === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      SerializeErrorText.encoderInvalid,
      { context: options.context }
    )
  }
  /** All text encodings finish before allocating the final binary result. */
  const parts = collected.map((chunk, chunkIndex) =>
    chunk[0] === SerializeChunkKind.bytes
      ? chunk[1]
      : encodeSerializeTextChunk(enc, chunk[1] as string, {
          type: SerializeContext.stream,
          phase: SerializePhase.encode,
          context: options.context,
          chunkIndex,
          bytesConsumed: chunkProgress[chunkIndex] ?? 0
        })
  )
  /** Combined byte length is calculated once before output allocation. */
  let total = 0
  /** Each admitted byte part contributes once to the final allocation size. */
  for (const part of parts) total += part.byteLength
  /** Single output allocation avoids repeated copying of the accumulated stream. */
  const merged = new Uint8Array(total)
  /** Write cursor advances once per part during final binary assembly. */
  let offset = 0
  /** Each part is copied once after every text encoding has succeeded. */
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return [SerializeChunkKind.bytes, merged]
}
