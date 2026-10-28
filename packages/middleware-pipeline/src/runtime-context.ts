/** Owns shared signal admission, cooperative checkpoints, invocation and iterator cleanup. */
import { admitAbortSignal, type IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.ts'
import {
  createMiddlewarePipelineAbortCleanupError,
  createMiddlewarePipelineAbortError,
  createMiddlewarePipelineInvalidOptionError
} from './errors.ts'
import type { IMiddlewarePipelineContext } from './runtime.ts'

/** Invoke a terminal or generator directly, appending context only when a signal was admitted. */
export function invokeWithContext<TFirst, TResult>(
  callback: (first: TFirst, context?: IMiddlewarePipelineContext) => TResult,
  first: TFirst,
  context: IMiddlewarePipelineContext | undefined
): TResult {
  return context ? callback(first, context) : callback(first)
}

/** Invoke a next-style stage directly, retaining its exact two- or three-argument call shape. */
export function invokeStageWithContext<TFirst, TNext, TResult>(
  callback: (first: TFirst, next: TNext, context?: IMiddlewarePipelineContext) => TResult,
  first: TFirst,
  next: TNext,
  context: IMiddlewarePipelineContext | undefined
): TResult {
  return context ? callback(first, next, context) : callback(first, next)
}

/**
 * Returns the stage sequence one run dispatches from. A frozen list cannot change after this call,
 * so it is used as is; any other list is copied once so later caller mutation cannot reach an
 * active run.
 */
export const snapshotStages = <TStage>(stages: readonly TStage[]): readonly TStage[] =>
  Object.isFrozen(stages) ? stages : stages.slice()

/** Reads one observed abort reason and applies the package's Error identity policy. */
const makeAbortError = (signal: IAbortSignal): Error => {
  const read = tryReadProperty(signal, 'reason')
  return createMiddlewarePipelineAbortError(read.threw ? read.error : read.value)
}
/**
 * Frozen run context per admitted signal. A host usually passes the same signal to every run, so
 * structural admission and the context record happen once per signal instead of once per run.
 */
const admittedContexts = new WeakMap<object, IMiddlewarePipelineContext>()

/**
 * Applies structural signal admission inside each mode's own throw boundary. A signal admitted
 * before reuses its context; only its aborted state is read again for this run.
 */
export const admit = (signal: IAbortSignal | undefined): IMiddlewarePipelineContext | undefined => {
  if (signal === undefined) return undefined
  /** Context from an earlier admission of this exact signal object. */
  const admitted =
    signal !== null && (typeof signal === 'object' || typeof signal === 'function')
      ? admittedContexts.get(signal)
      : undefined
  if (admitted) {
    if (readAborted(signal)) throw makeAbortError(signal)
    return admitted
  }
  const admission = admitAbortSignal(signal)
  if (admission.kind === 'invalid')
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption, {
      cause: admission.cause
    })
  if (admission.aborted) throw makeAbortError(signal)
  /** One frozen context serves every run that uses this signal. */
  const context: IMiddlewarePipelineContext = Object.freeze({ signal })
  admittedContexts.set(signal, context)
  return context
}
/** Reads cancellation at every supported structural-signal boundary with coded getter failures. */
const readAborted = (signal: IAbortSignal): boolean => {
  /** Structural signals may fail on a later read; preserve that failure on the coded boundary. */
  const aborted = tryReadProperty(signal, 'aborted')
  if (aborted.threw)
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption, {
      cause: aborted.error
    })
  return Boolean(aborted.value)
}
/** Rechecks cooperative cancellation between public runner transitions. */
export const check = (context: IMiddlewarePipelineContext | undefined): void => {
  if (context && readAborted(context.signal)) throw makeAbortError(context.signal)
}

type ISyncCleanupIterator = Generator<unknown, unknown, void>
type IAsyncCleanupIterator = AsyncGenerator<unknown, unknown, void>

/** Runs one abort cleanup protocol and preserves abort as primary failure. */
export const cleanupSyncIterator = (
  iterator: ISyncCleanupIterator,
  abortFailure: unknown
): never => {
  try {
    const returned = iterator.return(undefined)
    let step = returned
    while (!step.done) step = iterator.next()
  } catch (cleanupFailure) {
    throw createMiddlewarePipelineAbortCleanupError(abortFailure, cleanupFailure)
  }
  throw abortFailure
}

/** Runs one async abort cleanup protocol and preserves abort as primary failure. */
export const cleanupAsyncIterator = async (
  iterator: IAsyncCleanupIterator,
  abortFailure: unknown
): Promise<never> => {
  try {
    let step = await iterator.return(undefined)
    while (!step.done) step = await iterator.next()
  } catch (cleanupFailure) {
    throw createMiddlewarePipelineAbortCleanupError(abortFailure, cleanupFailure)
  }
  throw abortFailure
}
