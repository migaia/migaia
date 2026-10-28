/**
 * Public rate-control contracts and admission; each pending invocation and loop has one named
 * owner.
 */

import type {
  IControlledFunction,
  IDebounceOptions,
  IThrottleOptions,
  ICoalescedFunction,
  IRepeatContext,
  IRepeatOptions,
  IRepeatHandle
} from './rate-contract.ts'
export type {
  IControlledFunction,
  IDebounceOptions,
  IThrottleOptions,
  ICoalescedFunction,
  IRepeatContext,
  IRepeatOptions,
  IRepeatHandle
} from './rate-contract.ts'

import type { AsyncTaskStrategy } from './async-task-contract.ts'

import { DebouncedFunction, FrameThrottledFunction } from './rate-debounce.ts'
import { CoalescedFunction } from './rate-coalesce.ts'
import { RepeatingTask } from './rate-repeat.ts'
import { admitWait } from './rate-admission.ts'

/**
 * Delays `fn` until `wait` milliseconds pass without another call. `leading` invokes at the start
 * of a burst, `trailing` (default) at its end, and `maxWait` caps how long a continuous burst may
 * postpone an invocation.
 *
 * Errors from leading calls and `flush()` throw to the caller; errors from timer-driven trailing
 * calls are reported to the host.
 *
 * @example
 *   ;```ts
 *   const save = debounce((draft: string) => api.save(draft), 500, { maxWait: 5000 })
 *   input.addEventListener('input', () => save(input.value))
 *   ```
 */
export function debounce<F extends (...args: never[]) => unknown>(
  fn: F,
  wait: number,
  options: IDebounceOptions = {}
): IControlledFunction<F> {
  return new DebouncedFunction(fn, wait, options).controlled
}

/**
 * Invokes `fn` at most once per `wait` milliseconds (leading and trailing by default). Pass
 * `'animationFrame'` to invoke at most once per rendered frame with the latest arguments (browser
 * only; `ENV_UNSUPPORTED` elsewhere at call time).
 *
 * @example
 *   ;```ts
 *   const onScroll = throttle(() => updateHeader(window.scrollY), 'animationFrame')
 *   ```
 */
export function throttle<F extends (...args: never[]) => unknown>(
  fn: F,
  wait: number | 'animationFrame',
  options: IThrottleOptions = {}
): IControlledFunction<F> {
  if (wait !== 'animationFrame') {
    /** Numeric throttle remains the canonical debounce with one bounded maximum window. */
    const window = admitWait(wait, 'wait')
    return debounce(fn, window, {
      leading: options.leading !== false,
      trailing: options.trailing !== false,
      maxWait: window,
      signal: options.signal,
      scheduler: options.scheduler
    })
  }
  return new FrameThrottledFunction(fn, options).controlled
}

/**
 * Collects every call made before the chosen queue runs and delivers them in one invocation, in
 * call order. Useful for batching writes, analytics events or DOM reads within one tick. Failures
 * of the batched invocation are reported to the host.
 *
 * @example
 *   ;```ts
 *   const track = coalesce((calls: [event: string][]) => send(calls.map(([event]) => event)))
 *   track('open')
 *   track('click') // one send(['open', 'click'])
 *   ```
 */
export function coalesce<A extends unknown[]>(
  fn: (calls: readonly A[]) => void,
  strategy: AsyncTaskStrategy | readonly AsyncTaskStrategy[] = 'microtask'
): ICoalescedFunction<A> {
  return new CoalescedFunction(fn, strategy).coalesced
}

/**
 * Runs `task` every `interval` milliseconds without overlap: the next iteration is scheduled only
 * after the previous one settles. The schedule is drift-corrected against the start time; after an
 * overrun it realigns instead of firing a burst of catch-up runs.
 *
 * @example
 *   ;```ts
 *   const poll = repeat(({ signal }) => refresh({ signal }), 30_000, {
 *     immediate: true,
 *     onError: 'continue'
 *   })
 *   // later
 *   poll.stop()
 *   ```
 */
export function repeat(
  task: (context: IRepeatContext) => unknown,
  interval: number,
  options: IRepeatOptions = {}
): IRepeatHandle {
  return new RepeatingTask(task, interval, options).handle
}
