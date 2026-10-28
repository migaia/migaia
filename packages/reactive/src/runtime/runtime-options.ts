/**
 * Owns ordered Runtime option admission and receiver snapshots. Returns admitted capabilities;
 * graph allocation, scheduling and diagnostic execution remain with Runtime.
 */
import { tryReadProperty } from '@migaia/utils/error'
import { tagReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import { defaultRuntimeAdapter } from './default-runtime-adapter.ts'
import { createReceiverCallback } from './receiver.ts'
import type { IReactiveRuntimeAdapter, IRuntimeOptions } from './types.ts'

/** Admission result contains only snapshots; no option getter survives construction. */
type IRuntimeConfiguration = {
  adapter: IReactiveRuntimeAdapter
  maxFlushPasses: IRuntimeOptions['maxFlushPasses']
  onError: IReactiveRuntimeAdapter['reportError']
  onTrace: IRuntimeOptions['onTrace']
  scheduleIdle: IReactiveRuntimeAdapter['scheduleMicrotask']
  schedulerStrategy: IRuntimeOptions['schedulerStrategy']
}

/** Reads one option once and preserves its getter failure as the native TypeError cause. */
function readOption<K extends keyof IRuntimeOptions>(
  options: IRuntimeOptions,
  key: K
): IRuntimeOptions[K] {
  /** Failed property reads retain the original thrown value for the package boundary. */
  const read = tryReadProperty(options, key)
  if (read.threw) {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeOptionGetterFailed(String(key)), {
        cause: read.error
      }),
      ReactiveErrorCode.invalidOption
    )
  }
  return read.value
}

/** Snapshots one adapter method once, retaining its original receiver without a temporary record. */
function snapshotAdapterMethod<K extends keyof IReactiveRuntimeAdapter>(
  source: Partial<IReactiveRuntimeAdapter> | undefined,
  key: K
): IReactiveRuntimeAdapter[K] {
  if (source === undefined) {
    return createReceiverCallback<never[], unknown>(
      defaultRuntimeAdapter[key],
      defaultRuntimeAdapter
    ) as IReactiveRuntimeAdapter[K]
  }
  /** The adapter getter is never read again after admission, including on fallback. */
  const read = tryReadProperty(source, key)
  if (read.threw) {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeAdapterGetterFailed(String(key)), {
        cause: read.error
      }),
      ReactiveErrorCode.invalidOption
    )
  }
  if (read.value === undefined) {
    return createReceiverCallback<never[], unknown>(
      defaultRuntimeAdapter[key],
      defaultRuntimeAdapter
    ) as IReactiveRuntimeAdapter[K]
  }
  if (typeof read.value !== 'function') {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeAdapterMustBeFunction(String(key))),
      ReactiveErrorCode.invalidOption
    )
  }
  return createReceiverCallback<never[], unknown>(
    read.value as IReactiveRuntimeAdapter[K],
    source
  ) as IReactiveRuntimeAdapter[K]
}

/**
 * Admits options in their established read order before allocating any graph state. Adapter methods
 * and caller hooks keep their admission-time receivers and explicit undefined fallbacks.
 */
export function readRuntimeConfiguration(options: IRuntimeOptions): IRuntimeConfiguration {
  /** Flush budget admission precedes every adapter read. */
  const maxFlushPasses = readOption(options, 'maxFlushPasses')
  if (
    maxFlushPasses !== undefined &&
    (!Number.isSafeInteger(maxFlushPasses) || maxFlushPasses < 1)
  ) {
    throw tagReactiveError(
      new RangeError(ReactiveErrorText.maxFlushPassesInvalid),
      ReactiveErrorCode.invalidOption
    )
  }
  /** One source snapshot supplies all four adapter getters in declaration order. */
  const source = readOption(options, 'adapter')
  /** Bound methods replace the former four temporary {fn, receiver} allocations. */
  const adapter: IReactiveRuntimeAdapter = {
    scheduleMicrotask: snapshotAdapterMethod(source, 'scheduleMicrotask'),
    now: snapshotAdapterMethod(source, 'now'),
    timestamp: snapshotAdapterMethod(source, 'timestamp'),
    reportError: snapshotAdapterMethod(source, 'reportError')
  }
  /** Error hooks are admitted before trace and scheduling options. */
  const onError = readOption(options, 'onError')
  if (onError !== undefined && typeof onError !== 'function') {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onError')),
      ReactiveErrorCode.invalidOption
    )
  }
  /** Optional trace hook remains lazy until graph construction is complete. */
  const onTrace = readOption(options, 'onTrace')
  if (onTrace !== undefined && typeof onTrace !== 'function') {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onTrace')),
      ReactiveErrorCode.invalidOption
    )
  }
  /** Idle scheduling has separate fallback identity from flush strategy selection. */
  const scheduleIdle = readOption(options, 'scheduleIdle')
  if (scheduleIdle !== undefined && typeof scheduleIdle !== 'function') {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('scheduleIdle')),
      ReactiveErrorCode.invalidOption
    )
  }
  /** Strategy admission is the final getter before Runtime graph allocation. */
  const schedulerStrategy = readOption(options, 'schedulerStrategy')
  if (schedulerStrategy !== undefined && typeof schedulerStrategy !== 'function') {
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.schedulerStrategyInvalid),
      ReactiveErrorCode.invalidOption
    )
  }
  return {
    adapter,
    maxFlushPasses,
    onError: onError === undefined ? adapter.reportError : createReceiverCallback(onError, options),
    onTrace: onTrace === undefined ? undefined : createReceiverCallback(onTrace, options),
    scheduleIdle:
      scheduleIdle === undefined
        ? adapter.scheduleMicrotask
        : createReceiverCallback(scheduleIdle, options),
    schedulerStrategy
  }
}
