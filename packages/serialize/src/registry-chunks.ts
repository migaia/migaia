/** Chunk protocol draining and final assembly own iterator cleanup and byte progress. */
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  SerializeCodecError,
  encodeSerializeTextChunk,
  validateSerializeChunk,
  isChunkShape,
  type ISerializeChunk,
  type ISerializeOutput,
  type ISerializePhase,
  type ITextEncoder
} from './types.ts'
import { SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { SerializeChunkKind } from './format-constants.ts'
import { reasonOf } from './operation-support.ts'
import { type IInvokable } from './registry-protocol.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'

/** Immutable operation location and cancellation capability used throughout collection. */
export type IChunkCollectionDetails = {
  readonly type: string
  readonly phase: ISerializePhase
  readonly context: string
  readonly signal: IAbortSignal
}

/** One parser output owns its validated chunks until a single final merge. */
export class ChunkCollection {
  /** Location snapshot remains stable while arbitrary parser iterators execute. */
  readonly #details: IChunkCollectionDetails
  /** Captured encoder converts text only when mixed output needs bytes. */
  readonly #encoder: ITextEncoder
  /** Secondary iterator-return failures stay observable without replacing the primary. */
  readonly #report: (error: unknown) => void
  /** Validated tuple snapshots retain payload identity until final assembly. */
  readonly #collected: ISerializeChunk[] = []
  /** Prior byte progress gives text encoder failures their original location. */
  readonly #chunkProgress: number[] = []
  /** Any byte chunk selects the final byte merge path. */
  #sawBytes = false
  /** Value chunks must be the sole output of an operation. */
  #sawValue = false
  /** Next chunk position remains accurate on protocol and validation failures. */
  #chunkIndex = 0
  /** Only admitted byte payloads contribute to diagnostic progress. */
  #bytesConsumed = 0

  /** Captures operation-owned inputs without touching parser output. */
  constructor(
    details: IChunkCollectionDetails,
    encoder: ITextEncoder,
    report: (error: unknown) => void
  ) {
    this.#details = details
    this.#encoder = encoder
    this.#report = report
  }

  /** Drains the original protocol, preserving asynchronous precedence and await boundaries. */
  async collect(output: ISerializeOutput): Promise<ISerializeChunk> {
    try {
      if (isChunkShape(output)) {
        this.#take(output)
      } else {
        /** Protocol probing happens once before any iterator work. */
        let iterable: IIterableProbe | undefined
        try {
          iterable = probeIterable(output)
        } catch (error) {
          throw this.#streamFailure(error)
        }
        if (iterable !== undefined) {
          try {
            if (iterable.kind === 'async') {
              await drainAsyncIterable(
                output as AsyncIterable<ISerializeChunk>,
                iterable.factory,
                (candidate) => this.#take(candidate),
                this.#report
              )
            } else {
              drainSyncIterable(
                output as Iterable<ISerializeChunk>,
                iterable.factory,
                (candidate) => this.#take(candidate),
                this.#report
              )
            }
          } catch (error) {
            if (error instanceof SerializeCodecError) throw error
            throw this.#streamFailure(error)
          }
        } else {
          /** A non-iterable output retains the original thenable assimilation boundary. */
          let single: unknown
          try {
            single = await output
          } catch (error) {
            throw new SerializeCodecError(SerializeDiagnosticText.stepFailed(reasonOf(error)), {
              ...this.#details,
              chunkIndex: this.#chunkIndex,
              bytesConsumed: this.#bytesConsumed,
              code: SerializeErrorCode.encodeFailed,
              cause: error
            })
          }
          this.#take(single)
        }
      }
    } catch (error) {
      if (error instanceof SerializeCodecError) throw error
      throw this.#streamFailure(error)
    }
    return this.#assemble()
  }

  /** Validates one tuple before advancing position or publishing any output. */
  #take(candidate: unknown): void {
    if (this.#details.signal.aborted) {
      throw new SerializeCodecError(SerializeErrorText.aborted, {
        type: this.#details.type,
        phase: this.#details.phase,
        context: this.#details.context,
        chunkIndex: this.#chunkIndex,
        bytesConsumed: this.#bytesConsumed,
        code: SerializeErrorCode.aborted,
        cause: this.#details.signal.reason
      })
    }
    /** Failure details describe progress before the candidate is admitted. */
    const at = {
      ...this.#details,
      chunkIndex: this.#chunkIndex,
      bytesConsumed: this.#bytesConsumed
    }
    /** Tuple validation snapshots hostile getters once while preserving payload identity. */
    const chunk = validateSerializeChunk(candidate, at)
    this.#chunkProgress.push(this.#bytesConsumed)
    if (chunk[0] === SerializeChunkKind.value) this.#sawValue = true
    if (chunk[0] === SerializeChunkKind.bytes) this.#sawBytes = true
    if (this.#sawValue && this.#chunkIndex > 0) {
      throw new SerializeCodecError(SerializeDiagnosticText.valueCombined, {
        ...at,
        code: SerializeErrorCode.invalidChunk
      })
    }
    this.#collected.push(chunk)
    this.#bytesConsumed += chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0
    this.#chunkIndex++
  }

  /** Protocol failures retain the original object and progress at the failure boundary. */
  #streamFailure(error: unknown): SerializeCodecError {
    return new SerializeCodecError(
      SerializeDiagnosticText.streamFailed(this.#chunkIndex, reasonOf(error)),
      {
        ...this.#details,
        chunkIndex: this.#chunkIndex,
        bytesConsumed: this.#bytesConsumed,
        code: SerializeErrorCode.encodeFailed,
        cause: error
      }
    )
  }

  /** Collects parts once and performs one final text join or byte allocation, O(total payload). */
  #assemble(): ISerializeChunk {
    if (this.#chunkIndex === 0) {
      throw new SerializeCodecError(SerializeDiagnosticText.noChunks, {
        ...this.#details,
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.encodeFailed
      })
    }
    if (this.#collected.length === 1 || this.#sawValue) return this.#collected[0]
    if (!this.#sawBytes) {
      /** Text parts join once instead of repeatedly growing the accumulated string. */
      const text: string[] = []
      /** Validated tuple payload remains unchanged while the collector assembles output. */
      for (const chunk of this.#collected) text.push(chunk[1] as string)
      return [SerializeChunkKind.text, text.join('')]
    }
    /** Every encoder succeeds before the final destination buffer is allocated. */
    const parts: Uint8Array[] = []
    for (let index = 0; index < this.#collected.length; index++) {
      /** The admitted tuple can now be read without touching caller getters. */
      const chunk = this.#collected[index]
      /** Byte payloads stay borrowed until the final single copy. */
      const part =
        chunk[0] === SerializeChunkKind.bytes
          ? chunk[1]
          : encodeSerializeTextChunk(this.#encoder, chunk[1] as string, {
              ...this.#details,
              chunkIndex: index,
              bytesConsumed: this.#chunkProgress[index] ?? 0
            })
      parts.push(part)
    }
    /** Length reads follow every conversion, preserving injected encoder side-effect order. */
    let total = 0
    /** Each borrowed byte part contributes to the one final output buffer. */
    for (const part of parts) total += part.byteLength
    /** One final allocation prevents quadratic byte concatenation. */
    const merged = new Uint8Array(total)
    /** Cursor advances exactly once for each admitted byte part. */
    let offset = 0
    /** Each borrowed byte part contributes to the one final output buffer. */
    for (const part of parts) {
      merged.set(part, offset)
      offset += part.byteLength
    }
    return [SerializeChunkKind.bytes, merged]
  }
}

/** The one-time iterable protocol snapshot used by `collectChunks`. */
type IIterableProbe =
  | {
      readonly kind: 'async'
      readonly factory: IInvokable<AsyncIterator<ISerializeChunk>>
    }
  | {
      readonly kind: 'sync'
      readonly factory: IInvokable<Iterator<ISerializeChunk>>
    }

/**
 * Probe object-like iterable outputs by direct protocol reads, preserving async precedence and
 * receiver.
 */
const probeIterable = (value: unknown): IIterableProbe | undefined => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  /** Protocol probing reads caller-owned iterator properties in precedence order. */
  const candidate = value as Record<PropertyKey, unknown>
  /** A present asynchronous protocol takes precedence over synchronous iteration. */
  const asyncFactory = candidate[Symbol.asyncIterator]
  if (asyncFactory !== undefined) {
    /** Callable validation finishes before the captured protocol is invoked. */
    const factory = asyncFactory
    if (typeof factory !== 'function')
      throw new TypeError(SerializeDiagnosticText.asyncIteratorFunction)
    return {
      kind: 'async',
      factory: factory as IInvokable<AsyncIterator<ISerializeChunk>>
    }
  }
  /** Synchronous iteration is considered only when the async protocol is absent. */
  const syncFactory = candidate[Symbol.iterator]
  if (syncFactory !== undefined) {
    /** Callable validation finishes before the captured protocol is invoked. */
    const factory = syncFactory
    if (typeof factory !== 'function') throw new TypeError(SerializeDiagnosticText.iteratorFunction)
    return {
      kind: 'sync',
      factory: factory as IInvokable<Iterator<ISerializeChunk>>
    }
  }
  return undefined
}

/**
 * 手动消费 AsyncIterable，使 `take` 抛错（abort）时能显式调用 `iterator.return()` 并把其错误作为 secondary 路由到
 * `report`（不覆盖 primary）。
 */
async function drainAsyncIterable(
  output: AsyncIterable<ISerializeChunk>,
  factory: IInvokable<AsyncIterator<ISerializeChunk>>,
  take: (chunk: unknown) => void,
  report: (error: unknown) => void
): Promise<void> {
  /** The acquired iterator is owned by this protocol admission or drain. */
  let iterator: AsyncIterator<ISerializeChunk> | undefined
  try {
    iterator = Reflect.apply(factory, output, [])
    if (iterator === null || typeof iterator !== 'object')
      throw new TypeError(SerializeDiagnosticText.asyncIteratorObject)
    /** The iterator next method is captured once before advancing it. */
    const next = iterator.next
    if (typeof next !== 'function') throw new TypeError(SerializeDiagnosticText.asyncIteratorNext)
    while (true) {
      /** The next protocol result is checked before reading completion or payload. */
      const result = await Reflect.apply(
        next as unknown as IInvokable<Promise<IteratorResult<ISerializeChunk>>>,
        iterator,
        []
      )
      if (result.done) break
      take(result.value)
    }
  } catch (error) {
    if (iterator !== undefined) {
      try {
        /** The return method is read only when a drain failure requires iterator cleanup. */
        const close = iterator.return
        if (typeof close === 'function') await Reflect.apply(close, iterator, [])
      } catch (closeError) {
        try {
          report(closeError)
        } catch {
          // A diagnostic reporter must not replace the iterator's primary failure.
        }
      }
    }
    throw error
  }
}

/** Consume a captured synchronous iterator and close it when chunk processing fails. */
function drainSyncIterable(
  output: Iterable<ISerializeChunk>,
  factory: IInvokable<Iterator<ISerializeChunk>>,
  take: (chunk: unknown) => void,
  report: (error: unknown) => void
): void {
  /** The acquired iterator is owned by this protocol admission or drain. */
  let iterator: Iterator<ISerializeChunk> | undefined
  try {
    iterator = Reflect.apply(factory, output, [])
    if (iterator === null || typeof iterator !== 'object')
      throw new TypeError(SerializeDiagnosticText.iteratorObject)
    /** The iterator next method is captured once before advancing it. */
    const next = iterator.next
    if (typeof next !== 'function') throw new TypeError(SerializeDiagnosticText.iteratorNext)
    while (true) {
      /** The next protocol result is checked before reading completion or payload. */
      const result = Reflect.apply(
        next as unknown as IInvokable<IteratorResult<ISerializeChunk>>,
        iterator,
        []
      )
      if (result.done) break
      take(result.value)
    }
  } catch (error) {
    if (iterator !== undefined) {
      try {
        /** The return method is read only when a drain failure requires iterator cleanup. */
        const close = iterator.return
        if (typeof close === 'function') Reflect.apply(close, iterator, [])
      } catch (closeError) {
        try {
          report(closeError)
        } catch {
          // A diagnostic reporter must not replace the iterator's primary failure.
        }
      }
    }
    throw error
  }
}
