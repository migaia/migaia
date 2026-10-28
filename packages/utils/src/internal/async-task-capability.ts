/** Owns async task capability mechanics; strategy selection remains at the public entry. */
import type { IAbortSignal } from './promise-contract.ts'
import type { IConcreteAsyncTaskStrategy } from './async-task-contract.ts'
import { ERROR_SOURCE, UtilsErrorCode, type IUtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { attachErrorIdentity, tryReadProperty } from '../error.ts'

/** Largest delay host timers accept without overflowing. */
export const MAXIMUM_DELAY = 2_147_483_647

/** `postTask` priority per strategy. */
export const POST_TASK_PRIORITY = {
  postTaskUserBlocking: 'user-blocking',
  postTaskUserVisible: 'user-visible',
  postTaskBackground: 'background'
} as const

/** Structural view of the host globals this module reads. */
export type IAsyncTaskHost = {
  readonly queueMicrotask?: unknown
  readonly process?: { readonly nextTick?: unknown }
  readonly setTimeout?: unknown
  readonly clearTimeout?: unknown
  readonly setImmediate?: unknown
  readonly clearImmediate?: unknown
  readonly MessageChannel?: unknown
  readonly requestAnimationFrame?: unknown
  readonly cancelAnimationFrame?: unknown
  readonly requestIdleCallback?: unknown
  readonly cancelIdleCallback?: unknown
  readonly scheduler?: { readonly postTask?: unknown; readonly yield?: unknown }
  readonly AbortController?: unknown
}

/** Host API label per strategy, used in `ENV_UNSUPPORTED` messages. */
export const CAPABILITY: Readonly<Record<IConcreteAsyncTaskStrategy, string>> = Object.freeze({
  promise: 'Promise',
  microtask: 'queueMicrotask',
  nextTick: 'process.nextTick',
  timeout: 'setTimeout/clearTimeout',
  immediate: 'setImmediate/clearImmediate',
  messageChannel: 'MessageChannel',
  animationFrame: 'requestAnimationFrame/cancelAnimationFrame',
  idleCallback: 'requestIdleCallback/cancelIdleCallback',
  postTaskUserBlocking: 'scheduler.postTask',
  postTaskUserVisible: 'scheduler.postTask',
  postTaskBackground: 'scheduler.postTask',
  schedulerYield: 'scheduler.yield'
})

/** Reads host globals per call so substituted hosts are honoured. */
export function host(): IAsyncTaskHost {
  return globalThis as unknown as IAsyncTaskHost
}

/** Reads one host member without letting a hostile getter escape. */
export function member(owner: unknown, key: string): unknown {
  if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) return undefined
  /** Guarded read. */
  const read = tryReadProperty(owner as Record<string, unknown>, key)
  return read.threw ? undefined : read.value
}

/** Creates a coded native error without replacing its type. */
export function taskError(
  Constructor: ErrorConstructor | TypeErrorConstructor | RangeErrorConstructor,
  code: IUtilsErrorCode,
  message: string
): Error {
  return attachErrorIdentity(new Constructor(message), { source: ERROR_SOURCE, code })
}

/** Checks the host capability behind one concrete strategy. */
export function supported(strategy: IConcreteAsyncTaskStrategy): boolean {
  /** Host snapshot for this check. */
  const globals = host()
  switch (strategy) {
    case 'promise':
      return typeof Promise === 'function'
    case 'microtask':
      return typeof member(globals, 'queueMicrotask') === 'function'
    case 'nextTick':
      return typeof member(member(globals, 'process'), 'nextTick') === 'function'
    case 'timeout':
      return (
        typeof member(globals, 'setTimeout') === 'function' &&
        typeof member(globals, 'clearTimeout') === 'function'
      )
    case 'immediate':
      return (
        typeof member(globals, 'setImmediate') === 'function' &&
        typeof member(globals, 'clearImmediate') === 'function'
      )
    case 'messageChannel':
      return typeof member(globals, 'MessageChannel') === 'function'
    case 'animationFrame':
      return (
        typeof member(globals, 'requestAnimationFrame') === 'function' &&
        typeof member(globals, 'cancelAnimationFrame') === 'function'
      )
    case 'idleCallback':
      return (
        typeof member(globals, 'requestIdleCallback') === 'function' &&
        typeof member(globals, 'cancelIdleCallback') === 'function'
      )
    case 'postTaskUserBlocking':
    case 'postTaskUserVisible':
    case 'postTaskBackground':
      return (
        typeof member(member(globals, 'scheduler'), 'postTask') === 'function' &&
        typeof member(globals, 'AbortController') === 'function'
      )
    case 'schedulerYield':
      return typeof member(member(globals, 'scheduler'), 'yield') === 'function'
  }
}

/** Validates a delay-like option; non-numbers are `TypeError`, out-of-range is `RangeError`. */
export function admitDelay(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, UtilsErrorText.delayExpectation)
    )
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_DELAY)
    throw taskError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, UtilsErrorText.delayExpectation)
    )
  return value
}

/** Validates the structural abort signal shape without subscribing. */
export function admitSignal(value: unknown): IAbortSignal {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof member(value, 'addEventListener') !== 'function' ||
    typeof member(value, 'removeEventListener') !== 'function' ||
    typeof member(value, 'aborted') !== 'boolean'
  )
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('signal', UtilsErrorText.abortSignalExpectation)
    )
  return value as IAbortSignal
}
