/**
 * Owns operation option snapshots for registry, frame slicing, encoding, decoding, and collection.
 * Each entry retains its public getter order and admission policy before downstream side effects.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.ts'
import { SerializeContext, SerializeCollectEmpty } from './operation-constants.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'
import { snapshotSerializeSignal } from './signal-snapshot.ts'
import { snapshotSerializeScheduler } from './stream-scheduler.ts'
import { isSerializeTaggedError, streamOptionFailure } from './operation-support.ts'

/** Fully admitted frame-budget options; no field reads remain when slicing begins. */
export type IFrameBudgetSnapshot = {
  readonly targetMs: number
  readonly minItems: number
  readonly maxItems: number
  readonly initialItems: number
  readonly yieldTo?: () => Promise<void>
  readonly signal?: IAbortSignal
  readonly scheduler: IScheduler
}

/** Fully admitted encode-stream options captured before the first slice or registry call. */
export type IEncodeStreamSnapshot = IFrameBudgetSnapshot & {
  readonly type?: string
  readonly context: string
  readonly maxInFlight: number
}

/** Fully admitted decode-stream options captured before the input iterator is touched. */
export type IDecodeStreamSnapshot = {
  readonly type?: string
  readonly context: string
  readonly signal?: IAbortSignal
}

/** Collector admission context preserves cancellation, empty-input policy and diagnostic ownership. */
export type ICollectStreamSnapshot = {
  readonly signal?: IAbortSignal
  readonly empty: typeof SerializeCollectEmpty.text | typeof SerializeCollectEmpty.reject
  readonly context: string
}

/** Immutable registry operation admission, captured before parser work or lease tracking. */
export type ISerializeOperationOptionsSnapshot = {
  readonly type: string
  readonly signal?: IAbortSignal
  readonly context: string
}

/** 有限正数；NaN 与 Infinity 都要挡住。 */
function assertPositiveMs(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeDiagnosticText.frameBudgetPositive(name, value)
    )
  }
}

/** 条目数必须是有限正整数——小数会让片边界漂移，NaN 会让循环停不下来。 */
function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeDiagnosticText.frameBudgetCount(name, value)
    )
  }
}

/** Capture and validate frame-budget fields exactly once before any iterator side effect. */
export const snapshotFrameBudgetOptions = (options: unknown): IFrameBudgetSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = options as Record<string, unknown>
    /** Once-read targetMs option preserves accessor order before validation and defaults. */
    const targetMsValue = candidate.targetMs
    /** Once-read minItems option preserves accessor order before validation and defaults. */
    const minItemsValue = candidate.minItems
    /** Once-read maxItems option preserves accessor order before validation and defaults. */
    const maxItemsValue = candidate.maxItems
    /** Once-read initialItems option preserves accessor order before validation and defaults. */
    const initialItemsValue = candidate.initialItems
    /** Once-read yieldTo option preserves accessor order before validation and defaults. */
    const yieldToValue = candidate.yieldTo
    /** Once-read signal option preserves accessor order before validation and defaults. */
    const signalValue = candidate.signal
    /** Once-read scheduler option preserves accessor order before validation and defaults. */
    const schedulerValue = candidate.scheduler
    /** Admitted frame budget preserves the existing cooperative scheduling target. */
    const targetMs = targetMsValue === undefined ? 8 : targetMsValue
    /** Minimum admitted slice size prevents zero-progress iteration. */
    const minItems = minItemsValue === undefined ? 64 : minItemsValue
    /** Maximum admitted slice size bounds every adaptive step. */
    const maxItems = maxItemsValue === undefined ? 250_000 : maxItemsValue
    /** Initial slice size preserves the existing default before runtime clamping. */
    const initialItems = initialItemsValue === undefined ? 2_048 : initialItemsValue
    /** Admitted custom yield keeps caller-owned settlement and cancellation semantics. */
    const yieldTo = yieldToValue === undefined ? undefined : (yieldToValue as () => Promise<void>)
    if (typeof targetMs !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof minItems !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof maxItems !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof initialItems !== 'number')
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (yieldTo !== undefined && typeof yieldTo !== 'function') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    /** Captured scheduler validates host capabilities before slice work begins. */
    const scheduler = snapshotSerializeScheduler(schedulerValue)
    if (scheduler === undefined) {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerInvalid
      )
    }
    /** Admitted cancellation state preserves pre-aborted reason identity and live rechecks. */
    const signal = signalValue === undefined ? undefined : snapshotSerializeSignal(signalValue)
    assertPositiveMs(targetMs, 'targetMs')
    assertCount(minItems, 'minItems')
    assertCount(maxItems, 'maxItems')
    assertCount(initialItems, 'initialItems')
    if (maxItems < minItems) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        SerializeDiagnosticText.frameBudgetBounds
      )
    }
    return { targetMs, minItems, maxItems, initialItems, yieldTo, signal, scheduler }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Capture encode-stream fields once, including all inherited frame-budget options. */
export const snapshotEncodeStreamOptions = (options: unknown): IEncodeStreamSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = options as Record<string, unknown>
    /** Once-read type option preserves accessor order before validation and defaults. */
    const typeValue = candidate.type
    /** Once-read context option preserves accessor order before validation and defaults. */
    const contextValue = candidate.context
    /** Once-read maxInFlight option preserves accessor order before validation and defaults. */
    const maxInFlightValue = candidate.maxInFlight
    /** Frame fields retain their own getter order after encode routing fields are captured. */
    const frame = snapshotFrameBudgetOptions(options)
    /** Optional route remains undefined when each registry call should choose its primary type. */
    const type = typeValue === undefined ? undefined : typeValue
    /** Diagnostic label is captured once and defaults at the operation boundary. */
    const context = contextValue === undefined ? SerializeContext.stream : contextValue
    /** Positive ordered-concurrency bound limits queued registry requests. */
    const maxInFlight = maxInFlightValue === undefined ? 1 : maxInFlightValue
    if (type !== undefined && typeof type !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (typeof context !== 'string') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof maxInFlight !== 'number') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        SerializeDiagnosticText.streamInFlight(maxInFlight)
      )
    }
    return { ...frame, type, context, maxInFlight }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Capture decode-stream fields once before the source iterator is requested. */
export const snapshotDecodeStreamOptions = (options: unknown): IDecodeStreamSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = options as Record<string, unknown>
    /** Once-read type option preserves accessor order before validation and defaults. */
    const typeValue = candidate.type
    /** Once-read context option preserves accessor order before validation and defaults. */
    const contextValue = candidate.context
    /** Once-read signal option preserves accessor order before validation and defaults. */
    const signalValue = candidate.signal
    /** Optional route remains undefined when each registry call should choose its primary type. */
    const type = typeValue === undefined ? undefined : typeValue
    /** Diagnostic label is captured once and defaults at the operation boundary. */
    const context = contextValue === undefined ? SerializeContext.stream : contextValue
    if (type !== undefined && typeof type !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (typeof context !== 'string') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    /** Admitted cancellation state preserves pre-aborted reason identity and live rechecks. */
    const signal = signalValue === undefined ? undefined : snapshotSerializeSignal(signalValue)
    return { type, context, signal }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Captures collector options and rejects malformed values before touching the source iterator. */
export function snapshotCollectOptions(options: unknown): ICollectStreamSnapshot {
  try {
    if (options === undefined)
      return { empty: SerializeCollectEmpty.text, context: SerializeContext.stream }
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = options as Record<string, unknown>
    /** Admitted cancellation state preserves pre-aborted reason identity and live rechecks. */
    const signal = candidate.signal
    /** Empty-stream policy is captured before iterator acquisition. */
    const empty = candidate.empty
    /** Diagnostic label is captured once and defaults at the operation boundary. */
    const context = candidate.context
    if (
      empty !== undefined &&
      empty !== SerializeCollectEmpty.text &&
      empty !== SerializeCollectEmpty.reject
    )
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    if (context !== undefined && typeof context !== 'string')
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    return {
      signal: signal === undefined ? undefined : snapshotSerializeSignal(signal),
      empty: empty ?? SerializeCollectEmpty.text,
      context: context ?? SerializeContext.stream
    }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Read operation options once, validate their structural contract, and preserve defaults. */
export const snapshotOperationOptions = (
  options: unknown,
  primaryType: string
): ISerializeOperationOptionsSnapshot => {
  try {
    if (options !== undefined && (options === null || typeof options !== 'object')) {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    /** Caller object remains the receiver of getters captured in contractual order. */
    const candidate = options as
      | { readonly type?: unknown; readonly signal?: unknown; readonly context?: unknown }
      | undefined
    /** Once-read type option preserves accessor order before validation and defaults. */
    const typeOption = candidate?.type
    /** Once-read signal option preserves accessor order before validation and defaults. */
    const signalOption = candidate?.signal
    /** Once-read context option preserves accessor order before validation and defaults. */
    const contextOption = candidate?.context
    if (typeOption !== undefined && typeof typeOption !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (contextOption !== undefined && typeof contextOption !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    return {
      type: typeOption ?? primaryType,
      signal: signalOption === undefined ? undefined : snapshotSerializeSignal(signalOption),
      context: contextOption ?? SerializeContext.anonymous
    }
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.operationOptionInvalid,
      { cause: error }
    )
  }
}
