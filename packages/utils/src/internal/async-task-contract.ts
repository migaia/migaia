/** Canonical async-task type and value contracts; implementations depend inward on this module. */
import type { IAbortSignal } from './promise-contract.ts'

/**
 * Every supported way to schedule a callback. Pick by the queue you need; unsupported strategies
 * throw `ENV_UNSUPPORTED` instead of silently degrading. Pass a list to declare your own fallback
 * order, or `auto` for the library's default macrotask order.
 */
export const AsyncTaskStrategy = {
  /**
   * `Promise.resolve().then(callback)`: a promise-reaction microtask. Runs after the current
   * synchronous code and before any timer or I/O. Available everywhere.
   */
  promise: 'promise',
  /**
   * `queueMicrotask(callback)`: the same microtask queue as `promise`, without allocating a
   * Promise. Available in all modern browsers, workers, Node, Deno and Bun.
   */
  microtask: 'microtask',
  /**
   * `process.nextTick(callback)`: Node's tick queue, which drains before promise microtasks when
   * scheduled from a macrotask (inside a promise job, pending microtasks drain first). Node and
   * Bun; Deno only when the Node-compatible `process` global is present.
   */
  nextTick: 'nextTick',
  /**
   * `setTimeout(callback, delay)`: a timer macrotask. Browsers clamp nested timers to at least 4ms
   * and throttle background tabs. Available everywhere; the only strategy with native `delay`
   * besides the `postTask*` family.
   */
  timeout: 'timeout',
  /**
   * `setImmediate(callback)`: Node's check phase, right after I/O polling and before timers of the
   * next loop turn. Node and Bun.
   */
  immediate: 'immediate',
  /**
   * `MessageChannel` round trip: a macrotask without the nested-timer clamp, the usual way to yield
   * to the event loop quickly. Browsers, workers, Node, Deno and Bun.
   */
  messageChannel: 'messageChannel',
  /**
   * `requestAnimationFrame(callback)`: runs before the next paint and receives the frame time.
   * Paused in hidden tabs. Browser windows and some worker hosts only.
   */
  animationFrame: 'animationFrame',
  /**
   * `requestIdleCallback(callback, { timeout })`: runs in an idle period and receives
   * `timeRemaining()`; `idleTimeout` forces a run after that many milliseconds. Chromium, Firefox
   * and Safari 18+.
   */
  idleCallback: 'idleCallback',
  /**
   * `scheduler.postTask(callback, { priority: 'user-blocking' })`: highest-priority task, for work
   * that blocks user input. Supports native `delay`. Chromium and Firefox.
   */
  postTaskUserBlocking: 'postTaskUserBlocking',
  /**
   * `scheduler.postTask(callback, { priority: 'user-visible' })`: default-priority task, for work
   * whose result the user will see soon. Supports native `delay`. Chromium and Firefox.
   */
  postTaskUserVisible: 'postTaskUserVisible',
  /**
   * `scheduler.postTask(callback, { priority: 'background' })`: lowest-priority task, for logging,
   * prefetching and other deferrable work. Supports native `delay`. Chromium and Firefox.
   */
  postTaskBackground: 'postTaskBackground',
  /**
   * `await scheduler.yield()`: yields to the browser and resumes ahead of other queued tasks of the
   * same priority, the recommended way to split long tasks. Chromium and Firefox.
   */
  schedulerYield: 'schedulerYield',
  /**
   * First supported of `schedulerYield`, `postTaskUserVisible`, `messageChannel`, `immediate`,
   * `timeout`: a fast macrotask that lets rendering and I/O run. Available everywhere.
   */
  auto: 'auto'
} as const

export type AsyncTaskStrategy = keyof typeof AsyncTaskStrategy

/** Concrete strategies, i.e. every key except `auto`. */
export type IConcreteAsyncTaskStrategy = Exclude<AsyncTaskStrategy, 'auto'>

/** Options for `asyncTask()`. A bare number argument is shorthand for `{ delay }`. */
export type IAsyncTaskOptions = {
  /** Milliseconds to wait before the strategy's queue is used. Defaults to `0`. */
  readonly delay?: number
  /** Cancels the task before it starts; rejects with `UtilsAbortError` (`ABORTED`). */
  readonly signal?: IAbortSignal
  /** `idleCallback` only: forces a run after this many milliseconds without an idle period. */
  readonly idleTimeout?: number
}

/**
 * Context passed to the callback. `strategy` is the concrete strategy that ran; frame and idle
 * strategies add their host data.
 */
export type IAsyncTaskContext<S extends AsyncTaskStrategy = AsyncTaskStrategy> = S extends unknown
  ? S extends 'animationFrame'
    ? { readonly strategy: S; readonly frameTime: number }
    : S extends 'idleCallback'
      ? { readonly strategy: S; readonly didTimeout: boolean; timeRemaining(): number }
      : S extends 'auto'
        ? { readonly strategy: IConcreteAsyncTaskStrategy }
        : { readonly strategy: S }
  : never
