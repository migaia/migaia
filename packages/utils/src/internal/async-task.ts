/**
 * Public cross-host task strategies and admission; native registrations and Promise settlement have
 * separate owners.
 */

import type {
  IConcreteAsyncTaskStrategy,
  IAsyncTaskOptions,
  IAsyncTaskContext
} from './async-task-contract.ts'
export type {
  IConcreteAsyncTaskStrategy,
  IAsyncTaskOptions,
  IAsyncTaskContext
} from './async-task-contract.ts'
import { AsyncTaskStrategy } from './async-task-contract.ts'
export { AsyncTaskStrategy } from './async-task-contract.ts'

import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { tryReadProperty, UtilsAbortError } from '../error.ts'
import type { IAbortSignal } from './promise-contract.ts'
import {
  taskError,
  supported,
  admitDelay,
  admitSignal,
  CAPABILITY,
  POST_TASK_PRIORITY
} from './async-task-capability.ts'
import { ScheduledCallback } from './async-task-settlement.ts'

/** Fixed five-item fallback order; the compile-time literal bounds every auto scan. */
const AUTO_ORDER: readonly IConcreteAsyncTaskStrategy[] = Object.freeze([
  'schedulerYield',
  'postTaskUserVisible',
  'messageChannel',
  'immediate',
  'timeout'
])

/** Whether a key names a known strategy (own key only). */
function isStrategy(value: unknown): value is AsyncTaskStrategy {
  return typeof value === 'string' && Object.hasOwn(AsyncTaskStrategy, value)
}

/**
 * Whether the current host can run `strategy`. `auto` is supported whenever any of its fallbacks
 * is. Unknown keys return `false`.
 *
 * @example
 *   ;```ts
 *   const strategy = isAsyncTaskSupported('idleCallback') ? 'idleCallback' : 'timeout'
 *   ```
 */
export function isAsyncTaskSupported(strategy: AsyncTaskStrategy): boolean {
  if (!isStrategy(strategy)) return false
  if (strategy !== 'auto') return supported(strategy)
  // AUTO_ORDER has exactly five compile-time entries, so this scan is bounded independently of callers.
  for (const candidate of AUTO_ORDER) if (supported(candidate)) return true
  return false
}

/**
 * Returns the first supported strategy of an ordered preference list (`auto` expands in place).
 * Throws `INVALID_ARGUMENT` for an empty list or unknown key, `ENV_UNSUPPORTED` when none is
 * supported.
 *
 * @example
 *   ;```ts
 *   resolveAsyncTaskStrategy(['postTaskBackground', 'idleCallback', 'timeout'])
 *   ```
 */
export function resolveAsyncTaskStrategy(
  preferred: AsyncTaskStrategy | readonly AsyncTaskStrategy[]
): IConcreteAsyncTaskStrategy {
  /** Preference list; a single key is a one-item list. */
  const list: readonly unknown[] = Array.isArray(preferred) ? preferred : [preferred]
  /** Match Array.every's one length snapshot and skip sparse holes during validation. */
  const length = list.length
  /** Empty lists and unknown entries retain the same admission error before host probing. */
  let invalid = length === 0
  for (let index = 0; index < length && !invalid; index++)
    if (index in list && !isStrategy(list[index])) invalid = true
  if (invalid)
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('strategy', UtilsErrorText.asyncTaskStrategyExpectation)
    )
  /** Concrete candidates preserve the second original source pass and sparse-array semantics. */
  const candidates: IConcreteAsyncTaskStrategy[] = []
  /** FlatMap previously captured this second length independently of validation. */
  const expandedLength = list.length
  for (let index = 0; index < expandedLength; index++) {
    if (!(index in list)) continue
    /** This pass intentionally rereads caller entries, preserving their original accessor count. */
    const strategy = list[index] as AsyncTaskStrategy
    if (strategy === 'auto') {
      // Exactly five fallback entries are fixed in AUTO_ORDER; expansion remains O(list length).
      for (const candidate of AUTO_ORDER) candidates.push(candidate)
    } else candidates.push(strategy)
  }
  for (const candidate of candidates) if (supported(candidate)) return candidate
  throw taskError(
    Error,
    UtilsErrorCode.envUnsupported,
    UtilsErrorText.envUnsupported(
      candidates
        .map((strategy) => UtilsErrorText.asyncTaskCapability(strategy, CAPABILITY[strategy]))
        .join(', ')
    )
  )
}

/**
 * Runs `callback` later on the chosen queue and resolves with its result (thenables are adopted,
 * rejections pass through with their original identity).
 *
 * Argument and host problems throw synchronously: an unknown strategy, invalid delay or signal is
 * `INVALID_ARGUMENT`; a strategy the host lacks is `ENV_UNSUPPORTED` (pass a list for fallback).
 * Aborting `signal` before the callback starts cancels the host registration and rejects with
 * `UtilsAbortError`; aborting after it started has no effect.
 *
 * @example
 *   ;```ts
 *   await asyncTask('idleCallback', ({ timeRemaining }) => prefetch(timeRemaining()), {
 *     idleTimeout: 2000
 *   })
 *   await asyncTask(['postTaskBackground', 'timeout'], flushLogs, 100)
 *   ```
 */
export function asyncTask<const S extends AsyncTaskStrategy, R>(
  strategy: S | readonly S[],
  callback: (context: IAsyncTaskContext<S>) => R | PromiseLike<R>,
  delayOrOptions?: number | IAsyncTaskOptions
): Promise<Awaited<R>> {
  if (typeof callback !== 'function')
    throw taskError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('callback', UtilsErrorText.functionExpectation)
    )
  /** Normalized options; a number is the delay shorthand. */
  const options: IAsyncTaskOptions =
    typeof delayOrOptions === 'number' ? { delay: delayOrOptions } : (delayOrOptions ?? {})
  /** Validated scheduling inputs. */
  const delay = admitDelay(options.delay ?? 0, 'delay')
  /** Capture the idle deadline after delay admission in the original getter order. */
  const idleTimeout =
    options.idleTimeout === undefined ? undefined : admitDelay(options.idleTimeout, 'idleTimeout')
  /** Capture the original external cancellation capability before resource admission. */
  const signal = options.signal === undefined ? undefined : admitSignal(options.signal)
  /** Concrete strategy, resolved before any registration. */
  const concrete = resolveAsyncTaskStrategy(strategy)
  if (
    delay > 0 &&
    !supported('timeout') &&
    concrete !== 'timeout' &&
    !(concrete in POST_TASK_PRIORITY)
  )
    throw taskError(
      Error,
      UtilsErrorCode.envUnsupported,
      UtilsErrorText.envUnsupported(UtilsErrorText.asyncTaskCapability('delay', CAPABILITY.timeout))
    )
  if (signal?.aborted) {
    /** Abort reason read once through a guarded getter. */
    const reason = tryReadProperty(signal as { reason?: unknown }, 'reason')
    return Promise.reject(new UtilsAbortError(reason.threw ? reason.error : reason.value))
  }
  return new ScheduledCallback<S, R>(concrete, callback, delay, idleTimeout, signal).promise
}

/**
 * Resolves after yielding to the host once: `await yieldToHost()` inside long loops lets rendering,
 * input and I/O run. Defaults to `auto`.
 *
 * @example
 *   ;```ts
 *   for (const row of rows) {
 *     process(row)
 *     if (++n % 500 === 0) await yieldToHost()
 *   }
 *   ```
 */
export function yieldToHost(
  strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[] = 'auto',
  options?: { readonly signal?: IAbortSignal }
): Promise<void> {
  return asyncTask(strategy, () => undefined, options)
}
