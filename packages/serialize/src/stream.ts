/**
 * Owns public stream orchestration: adaptive slices, ordered encoding, sequential decoding and
 * collection. Admission, scheduler ownership and collection conversion have separate canonical
 * module owners.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  SerializeCodecError,
  validateSerializeChunk,
  type ISerializeChunk,
  type ISerializeRegistry,
  type ITextEncoder
} from './types.ts'
import { createSerializeError, SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { SerializeChunkKind, SerializePhase } from './format-constants.ts'
import { SerializeContext } from './operation-constants.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'
import { createSerializeOperationSignal } from './signal.ts'
import {
  isSerializeTaggedError,
  reasonOf,
  checkStreamAbort,
  readSerializeSignalAborted,
  readSerializeSignalReason
} from './operation-support.ts'
import {
  snapshotFrameBudgetOptions,
  snapshotEncodeStreamOptions,
  snapshotDecodeStreamOptions,
  snapshotCollectOptions
} from './operation-options.ts'
import { OwnedStreamYield } from './stream-scheduler.ts'
import {
  snapshotCollectEncoder,
  getCollectIterator,
  closeCollectIterator,
  mergeCollectedStream
} from './stream-collection.ts'

/** Finish public encode-stream cleanup while preserving any earlier primary throw identity. */
const finalizeEncodeStreamCleanup = (
  cleanupErrors: readonly unknown[],
  hasPrimary: boolean,
  primaryError: unknown
): void => {
  if (hasPrimary) {
    throw attachSecondaryErrors(primaryError, cleanupErrors)
  }
  if (cleanupErrors.length > 0) throw cleanupErrors[0]
}

/** Explicit state for the generator's FIFO queue; slots release pending references when drained. */
type IEncodeStreamRun = {
  readonly inFlight: Array<Promise<ISerializeChunk> | undefined>
  head: number
  sliceIndex: number
  readonly type: string | undefined
  readonly context: string
  readonly registry: ISerializeRegistry
}

/**
 * Drains the original Promise in FIFO order, preserving its rejection and async settlement
 * boundary.
 */
async function drainEncodedStream(run: IEncodeStreamRun): Promise<ISerializeChunk> {
  /** A cursor releases each consumed slot without repeatedly shifting the growable queue. */
  const pending = run.inFlight[run.head]!
  run.inFlight[run.head] = undefined
  run.head += 1
  try {
    return await pending
  } catch (error) {
    throw new SerializeCodecError(
      SerializeDiagnosticText.streamEncodeFailed(run.sliceIndex, reasonOf(error)),
      {
        type: run.type ?? run.registry.primaryType,
        phase: SerializePhase.encode,
        context: run.context,
        chunkIndex: run.sliceIndex,
        bytesConsumed: 0,
        code: SerializeErrorCode.encodeFailed,
        cause: error
      }
    )
  }
}

/**
 * Adaptive slicing to fit a frame budget.
 *
 * Slice size follows measured processing time rather than a fixed byte count. The generator
 * suspends after yielding and resumes when the consumer requests the next slice. The elapsed
 * interval measures consumer processing time and controls the next slice size. The target is
 * adaptive guidance, not a guarantee that an individual slice or consumer operation fits a frame.
 */
export type IFrameBudgetOptions = {
  /**
   * Target duration per slice. Defaults to 8 ms, leaving about half a 16.7 ms frame at 60 fps for
   * rendering and other work.
   */
  readonly targetMs?: number
  /** Minimum slice size, default 64; must be a positive safe integer. */
  readonly minItems?: number
  /** Maximum slice size, default 250000; must be a positive safe integer at least minItems. */
  readonly maxItems?: number
  /** Initial size, default 2048; a positive safe integer clamped to the configured min/max bounds. */
  readonly initialItems?: number
  /**
   * Yield mechanism. Defaults to `scheduler.schedule(resolve, 0)`. Can use `scheduler.yield()` for
   * finer scheduling or requestIdleCallback for a more conservative yield. A custom callback owns
   * its own cancellation and settlement; it cannot forcibly interrupt consumer work.
   */
  readonly yieldTo?: () => Promise<void>
  /** Optional cooperative cancellation signal, default undefined; checked between slice admissions. */
  readonly signal?: IAbortSignal
  /**
   * Required runtime-neutral scheduler. Core has no default timer and never directly accesses host
   * `setTimeout`, `performance`, or `Date.now`.
   */
  readonly scheduler: IScheduler
}

/** Keeps adaptive slice size inside admitted bounds without changing fractional rounding. */
const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value

/**
 * Slices a large array to fit a frame budget and yields the main thread between slices.
 *
 * Use `for await (const slice of sliceByFrameBudget(rows, { scheduler }))` and process each slice
 * in the loop. The generator measures the interval until the next pull to choose the next slice
 * size; it yields fresh shallow slices in input order. Options are captured on first iteration,
 * before slicing. Empty input yields nothing; invalid options reject with INVALID_OPTION, and
 * cooperative cancellation preserves its reason. The source array stays unchanged; element payloads
 * are not cloned.
 */
export async function* sliceByFrameBudget<T>(
  items: readonly T[],
  options: IFrameBudgetOptions
): AsyncGenerator<readonly T[], void, undefined> {
  const { targetMs, minItems, maxItems, initialItems, yieldTo, signal, scheduler } =
    snapshotFrameBudgetOptions(options)

  /** Current adaptive slice size persists only until this generator finishes. */
  let size = clamp(initialItems, minItems, maxItems)
  /** Current stream position preserves input order and identifies failures at admission. */
  let index = 0
  while (index < items.length) {
    if (signal !== undefined && readSerializeSignalAborted(signal))
      throw createSerializeError(SerializeErrorCode.aborted, SerializeErrorText.aborted, {
        cause: readSerializeSignalReason(signal)
      })
    /** Fresh shallow slice exposes each input item exactly once without copying payloads. */
    const slice = items.slice(index, index + size)
    /** Clock sample precedes yielding so the resumed interval measures consumer work. */
    const startedAt = scheduler.now()
    yield slice
    // 恢复点：消费者已经处理完这一片，时差即其真实耗时
    /** Consumer processing interval determines the next slice size after resumption. */
    const elapsed = scheduler.now() - startedAt
    index += slice.length

    // 阻尼调整：直接按比例缩放会在噪声下来回振荡，取当前值与目标值的中点。
    // elapsed 极小时用下限兜底，避免除出一个荒谬的放大倍数。
    /** Budget ratio uses the established minimum elapsed interval to bound adaptation. */
    const ratio = targetMs / Math.max(elapsed, 0.05)
    /** Bounded target is damped against current size to avoid oscillation. */
    const target = clamp(Math.round(size * ratio), minItems, maxItems)
    size = clamp(Math.round((size + target) / 2), minItems, maxItems)

    if (index < items.length) {
      if (yieldTo === undefined) await new OwnedStreamYield(scheduler, signal).run()
      else await yieldTo()
    }
  }
}

/** Frame slicing plus registry routing and ordered concurrency policy; scheduler remains required. */
export type IEncodeStreamOptions = IFrameBudgetOptions & {
  /** Optional plugin route, defaulting through each registry call to primaryType. */
  readonly type?: string
  /** Diagnostic label, default stream. */
  readonly context?: string
  /**
   * Backpressure limit for concurrent requests. Defaults to 1, waiting for each encoded slice
   * before encoding the next. Only one slice is in flight at that setting. Higher limits overlap
   * encoding with worker processing at the cost of retaining more slices in memory.
   */
  readonly maxInFlight?: number
}

/** Captured policy for one collector operation; getters are read before iterator acquisition. */
export type ICollectStreamOptions = {
  /**
   * Optional cancellation signal, default undefined; an outstanding iterator next is not forcibly
   * interrupted.
   */
  readonly signal?: IAbortSignal
  /** Chooses whether an empty stream returns empty text or rejects; defaults to `text`. */
  readonly empty?: 'text' | 'reject'
  /** Diagnostic label, default stream. */
  readonly context?: string
}

/**
 * Encodes a large array as a chunk stream without assembling the full result.
 *
 * `registry.encode` merges each operation's chunks into one complete result for consumers that need
 * a whole blob. Stream consumers such as IndexedDB, files, or fetch bodies can accept slices
 * individually. Avoiding full-stream assembly avoids retaining another object containing all data.
 * Each slice is encoded independently, so concatenating JSON array slices is not one JSON array.
 * Results stay in input order with at most maxInFlight operations outstanding. Early consumer
 * return cancels operation-owned work and observes late failures without waiting indefinitely for a
 * non-cooperative parser; registry disposal remains responsible for draining its parser tasks.
 */
export async function* encodeStream<T>(
  registry: ISerializeRegistry,
  items: readonly T[],
  options: IEncodeStreamOptions
): AsyncGenerator<ISerializeChunk, void, undefined> {
  /** All caller getters are captured before any signal, scheduler or registry work. */
  const streamOptions = snapshotEncodeStreamOptions(options)
  const { type, context, maxInFlight } = streamOptions
  /** Admitted caller signal feeds the operation-owned cancellation bridge. */
  const callerSignal = streamOptions.signal
  /** Exact listener and operation cleanup failures retained until generator finalization. */
  const cleanupErrors: unknown[] = []
  /** Operation cancellation owns queued work and records cleanup failures for finalization. */
  const operation = createSerializeOperationSignal(callerSignal, (error) => {
    cleanupErrors.push(error)
  })
  /** Owned cancellation is shared by slice admission and every registry request. */
  const operationSignal = operation.signal
  /** Internal frame snapshot changes only the signal to operation-owned cancellation. */
  const operationOptions = { ...streamOptions, signal: operationSignal }
  /** Explicit state owns ordered pending work and diagnostic position until finalization. */
  const run: IEncodeStreamRun = { inFlight: [], head: 0, sliceIndex: 0, type, context, registry }
  /** Normal exhaustion suppresses early-return cancellation during finalization. */
  let completed = false
  /** Whether the generator body recorded a primary throw before finalization. */
  let hasPrimary = false
  /** First generator-body failure; cleanup failures must remain secondary to it. */
  let primaryError: unknown

  try {
    /** Each admitted frame stays owned until its original encode Promise enters the FIFO. */
    for await (const slice of sliceByFrameBudget(items, operationOptions)) {
      if (readSerializeSignalAborted(operationSignal)) {
        throw createSerializeError(SerializeErrorCode.aborted, SerializeErrorText.aborted, {
          cause: readSerializeSignalReason(operationSignal)
        })
      }
      /** Original admitted Promise is observed immediately and drained in FIFO order. */
      let pending: Promise<ISerializeChunk>
      try {
        // Promise.resolve preserves native Promise identity and assimilates thenables while the
        // catch below is installed in the same admission turn.
        pending = Promise.resolve(
          registry.encode(slice, { type, signal: operationSignal, context })
        )
      } catch (error) {
        // A synchronous registry failure is still an ordered admission. Queue its rejection so
        // earlier work drains first and the same immediate observer prevents unhandled rejection.
        pending = Promise.reject(error)
      }
      // Observe every queued rejection at admission; draining later must still await the original
      // Promise so ordered output and exact error identity remain unchanged.
      pending.catch(() => undefined)
      run.inFlight.push(pending)
      // 背压：在途数达到上限就先把最早那笔排空，避免无限堆积
      while (run.inFlight.length - run.head >= maxInFlight) {
        yield await drainEncodedStream(run)
        run.sliceIndex++
      }
    }
    while (run.inFlight.length - run.head > 0) {
      yield await drainEncodedStream(run)
      run.sliceIndex++
    }
    completed = true
  } catch (error) {
    hasPrimary = true
    primaryError = error
  } finally {
    // Consumer early return/throw owns cancellation of queued work before observing settlement.
    if (!completed && !operationSignal.aborted)
      operation.abort(SerializeErrorText.streamConsumerClosed)
    // Admission-time rejection observers retain ownership of residual noncooperative work.
    // Do not await it here: a parser that ignores abort must not block generator finalization.
    for (let index = run.head; index < run.inFlight.length; index++)
      run.inFlight[index]?.catch(() => undefined)
    operation.dispose()
    run.inFlight.length = 0
    run.head = 0
    finalizeEncodeStreamCleanup(cleanupErrors, hasPrimary, primaryError)
  }
}

/**
 * Decodes each source chunk sequentially and yields one decoded value without joining frames.
 * Options default to an empty record: route uses registry.primaryType, context is stream, and no
 * caller signal is supplied. Cancellation is checked before source pulls and after consumer
 * resumption. Iterator or parser failures retain the stream position and original cause.
 */
export async function* decodeStream(
  registry: ISerializeRegistry,
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  options: {
    /** Registry route, default primaryType. */
    readonly type?: string
    /** Diagnostic label, default stream. */
    readonly context?: string
    /** Optional cooperative cancellation signal, default undefined. */
    readonly signal?: IAbortSignal
  } = {}
): AsyncGenerator<unknown, void, undefined> {
  const { type, context, signal } = snapshotDecodeStreamOptions(options)
  /** Current stream position preserves input order and identifies failures at admission. */
  let index = 0
  /** Exact error produced by inner decode wrapping must not be wrapped twice. */
  let ownedError: unknown
  try {
    checkStreamAbort(signal)
    /** Each source chunk is decoded before another pull, preserving sequential backpressure. */
    for await (const chunk of chunks as AsyncIterable<ISerializeChunk>) {
      checkStreamAbort(signal)
      try {
        yield await registry.decode(chunk, { type, signal, context })
      } catch (error) {
        // 同上：保留流位置，内层错误挂 cause
        ownedError = new SerializeCodecError(
          SerializeDiagnosticText.streamDecodeFailed(index, reasonOf(error)),
          {
            type: type ?? registry.primaryType,
            phase: SerializePhase.decode,
            context,
            chunkIndex: index,
            bytesConsumed: 0,
            code: SerializeErrorCode.decodeFailed,
            cause: error
          }
        )
        throw ownedError
      }
      index++
      // The consumer may abort while holding a yielded value; check before the next source pull.
      checkStreamAbort(signal)
    }
  } catch (error) {
    if (error === ownedError || isSerializeTaggedError(error, SerializeErrorCode.aborted))
      throw error
    throw new SerializeCodecError(
      SerializeDiagnosticText.streamDecodeFailed(index, reasonOf(error)),
      {
        type: type ?? registry.primaryType,
        phase: SerializePhase.decode,
        context,
        chunkIndex: index,
        bytesConsumed: 0,
        code: SerializeErrorCode.decodeFailed,
        cause: error
      }
    )
  }
}

/**
 * Assembles a chunk stream into one result. Use only when the consumer needs a complete blob
 * because all data stays in memory. Text chunks join as text; multiple chunks containing bytes
 * produce one byte chunk and require an explicit encoder, even when every chunk is already bytes. A
 * single wire chunk needs no conversion. Value chunks always reject INVALID_CHUNK. Empty input
 * defaults to empty text, or rejects ENCODE_FAILED with empty: reject. Failure closes the acquired
 * iterator and retains cleanup errors without replacing the primary failure; payload references are
 * not deep-cloned.
 */
export async function collectStream(
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  encoder?: ITextEncoder,
  options?: ICollectStreamOptions
): Promise<ISerializeChunk> {
  /** Collector policy is captured before encoder admission and source acquisition. */
  const collectOptions = snapshotCollectOptions(options)
  /** Encoder method is captured once before touching even a text-only iterator. */
  const capturedEncoder = snapshotCollectEncoder(encoder)
  /** Validated chunk snapshots retain input order until one final join. */
  const collected: ISerializeChunk[] = []
  /** Binary presence selects the established mixed-stream conversion policy. */
  let sawBytes = false
  /** Validated byte progress excludes text until the final conversion stage. */
  let bytesConsumed = 0
  /** Current stream position preserves input order and identifies failures at admission. */
  let index = 0
  /** Each text conversion receives byte progress from its original admission position. */
  const chunkProgress: number[] = []
  /** Acquired iterator is closed only after failure before normal exhaustion. */
  let iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined
  /** Undefined is a valid thrown value, so failure presence is separate from its payload. */
  let hasPrimaryError = false
  /** Exact first failure survives iterator cleanup and final boundary projection. */
  let primaryError: unknown
  /** Normal exhaustion suppresses early-return cancellation during finalization. */
  let completed = false
  try {
    checkStreamAbort(collectOptions.signal)
    iterator = getCollectIterator(chunks)
    while (true) {
      checkStreamAbort(collectOptions.signal)
      /** Awaited protocol result is inspected before any chunk-specific access. */
      const step = await iterator.next()
      if (step === null || (typeof step !== 'object' && typeof step !== 'function'))
        throw new SerializeCodecError(SerializeErrorText.collectOptionInvalid, {
          type: SerializeContext.stream,
          phase: SerializePhase.encode,
          context: collectOptions.context,
          chunkIndex: index,
          bytesConsumed,
          code: SerializeErrorCode.encodeFailed,
          cause: step
        })
      /** Completion is read once and short-circuits payload access for truthy values. */
      let done: unknown
      try {
        done = step.done
      } catch (error) {
        throw new SerializeCodecError(
          SerializeDiagnosticText.streamCollectFailed(index, reasonOf(error)),
          {
            type: SerializeContext.stream,
            phase: SerializePhase.encode,
            context: collectOptions.context,
            chunkIndex: index,
            bytesConsumed,
            code: SerializeErrorCode.encodeFailed,
            cause: error
          }
        )
      }
      if (done) {
        completed = true
        break
      }
      /** Payload is read only for nonterminal results and validated before tag-specific access. */
      let chunk: unknown
      try {
        chunk = step.value
      } catch (error) {
        throw new SerializeCodecError(
          SerializeDiagnosticText.streamCollectFailed(index, reasonOf(error)),
          {
            type: SerializeContext.stream,
            phase: SerializePhase.encode,
            context: collectOptions.context,
            chunkIndex: index,
            bytesConsumed,
            code: SerializeErrorCode.encodeFailed,
            cause: error
          }
        )
      }
      checkStreamAbort(collectOptions.signal)
      /** Frozen tuple snapshot prevents hostile raw input from changing after admission. */
      const validatedChunk = validateSerializeChunk(chunk, {
        type: SerializeContext.stream,
        phase: SerializePhase.encode,
        context: collectOptions.context,
        chunkIndex: index,
        bytesConsumed
      })
      chunkProgress.push(bytesConsumed)
      if (validatedChunk[0] === SerializeChunkKind.value) {
        throw new SerializeCodecError(SerializeErrorText.collectValue, {
          type: SerializeContext.stream,
          phase: SerializePhase.encode,
          context: collectOptions.context,
          chunkIndex: index,
          bytesConsumed,
          code: SerializeErrorCode.invalidChunk
        })
      }
      if (validatedChunk[0] === SerializeChunkKind.bytes) {
        sawBytes = true
        bytesConsumed += validatedChunk[1].byteLength
      }
      collected.push(validatedChunk)
      index++
    }
  } catch (error) {
    hasPrimaryError = true
    primaryError = error
  } finally {
    /** Iterator return failure remains secondary to an earlier operation failure. */
    const cleanupError = await closeCollectIterator(iterator, completed)
    if (cleanupError !== undefined) {
      if (!hasPrimaryError) primaryError = cleanupError
      else primaryError = attachSecondaryErrors(primaryError, [cleanupError])
      hasPrimaryError = true
    }
  }
  if (hasPrimaryError) {
    if (
      isSerializeTaggedError(primaryError, SerializeErrorCode.invalidChunk) ||
      isSerializeTaggedError(primaryError, SerializeErrorCode.invalidOption) ||
      isSerializeTaggedError(primaryError, SerializeErrorCode.aborted)
    )
      throw primaryError
    if (primaryError instanceof SerializeCodecError) throw primaryError
    throw new SerializeCodecError(
      SerializeDiagnosticText.streamCollectFailed(index, reasonOf(primaryError)),
      {
        type: SerializeContext.stream,
        phase: SerializePhase.encode,
        context: collectOptions.context,
        chunkIndex: index,
        bytesConsumed,
        code: SerializeErrorCode.encodeFailed,
        cause: primaryError
      }
    )
  }
  return mergeCollectedStream(collected, sawBytes, chunkProgress, capturedEncoder, collectOptions)
}
