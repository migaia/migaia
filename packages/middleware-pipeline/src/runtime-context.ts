/** Owns shared signal admission, cooperative checkpoints, invocation and iterator cleanup. */
import { admitAbortSignal, type IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.js'
import {
  createMiddlewarePipelineAbortCleanupError,
  createMiddlewarePipelineAbortError,
  createMiddlewarePipelineInvalidOptionError
} from './errors.js'
import type { IMiddlewarePipelineContext } from './runtime.js'

/** Invokes a one-argument optional-context callback. */
export function invokeWithContext<TFirst, TResult>(
  callback: (first: TFirst, context?: IMiddlewarePipelineContext) => TResult,
  args: readonly [TFirst],
  context: IMiddlewarePipelineContext | undefined
): TResult
/** Invokes a two-argument optional-context callback. */
export function invokeWithContext<TFirst, TSecond, TResult>(
  callback: (first: TFirst, second: TSecond, context?: IMiddlewarePipelineContext) => TResult,
  args: readonly [TFirst, TSecond],
  context: IMiddlewarePipelineContext | undefined
): TResult
/** Implements both supported callback arities without reflective invocation. */
export function invokeWithContext(
  callback: Function,
  args: readonly [unknown] | readonly [unknown, unknown],
  context: IMiddlewarePipelineContext | undefined
): unknown {
  if (args.length === 1) return context ? callback(args[0], context) : callback(args[0])
  return context ? callback(args[0], args[1], context) : callback(args[0], args[1])
}

/** Reads one observed abort reason and applies the package's Error identity policy. */
const makeAbortError = (signal: IAbortSignal): Error => {
  const read = tryReadProperty(signal, 'reason')
  return createMiddlewarePipelineAbortError(read.threw ? read.error : read.value)
}
/** Applies structural signal admission inside each mode's own throw boundary. */
export const admit = (signal: IAbortSignal | undefined): IMiddlewarePipelineContext | undefined => {
  if (signal === undefined) return undefined
  const admission = admitAbortSignal(signal)
  if (admission.kind === 'invalid')
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption, {
      cause: admission.cause
    })
  if (admission.aborted) throw makeAbortError(signal)
  return Object.freeze({ signal })
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
