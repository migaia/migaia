/**
 * The single runtime-neutral scheduler contract of the workspace, its default host implementation,
 * the deterministic manual implementation, and the separate wall clock used only for diagnostic
 * timestamps.
 *
 * `IScheduler.now()` is a monotonic clock: it is only compared by difference and never read as a
 * Unix epoch. Epoch milliseconds come exclusively from `IWallClock.timestamp()`.
 *
 * `lib: ["ES2024"]` declares neither `performance` nor the timer functions, so the default
 * implementation reads them structurally from `globalThis` on every call instead of importing DOM
 * or Node types. Reading per call keeps `vi.stubGlobal`-style host substitution observable.
 */
import { UtilsErrorCode, type IUtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

/**
 * Handle of one scheduled callback. `cancel()` is idempotent; after it, or after the callback ran,
 * the callback never runs (again). `unref()` is an optional hint that does not change when the
 * callback runs; it only lets a host exit while this timer is the last pending work.
 */
export type IScheduledTask = { cancel(): void; unref?(): void }

/**
 * The only scheduler contract. `now()` is monotonic non-decreasing milliseconds (two reads may be
 * equal) and is only meaningful as a difference. `schedule()` accepts a finite non-negative
 * `delayMs`, runs the callback at most once, and never runs it synchronously inside `schedule()`.
 */
export type IScheduler = {
  now(): number
  schedule(callback: () => void, delayMs: number): IScheduledTask
}

/**
 * Deterministic scheduler for tests and simulations. `advance(ms)` moves virtual time forward and
 * synchronously flushes due callbacks; `pendingCount` counts tasks neither run nor cancelled.
 */
export type IManualScheduler = IScheduler & {
  advance(ms: number): void
  readonly pendingCount: number
}

/**
 * Wall clock for diagnostic timestamps only. `timestamp()` returns epoch milliseconds as a safe
 * integer and must never take part in deadline, expiry, or replay-window comparisons.
 */
export type IWallClock = { timestamp(): number }

/** Structural view of the host globals the default scheduler needs; never exported. */
type ISchedulerHostGlobals = {
  readonly performance?: { readonly now?: unknown }
  readonly setTimeout?: unknown
  readonly clearTimeout?: unknown
}

/** Host timer registration function shape, admitted only after a `typeof` check. */
type IHostSetTimeout = (callback: () => void, delayMs: number) => unknown

/** Host timer cancellation function shape, admitted only after a `typeof` check. */
type IHostClearTimeout = (handle: unknown) => void

/** Native error constructors whose runtime type callers branch on. */
type ISchedulerErrorConstructor = ErrorConstructor | TypeErrorConstructor | RangeErrorConstructor

/**
 * Largest delay a host timer accepts without clamping (signed 32-bit maximum). Longer delays are
 * split into segments of at most this length so the callback does not fire early.
 */
const MAXIMUM_TIMER_DELAY = 2_147_483_647

/**
 * Upper bound on callbacks one `advance()` may flush before it is treated as runaway
 * self-scheduling.
 */
const MAXIMUM_ADVANCE_FLUSH = 10_000

/** Expectation text shared by every delay-like argument this module validates. */
const DELAY_EXPECTATION = 'a finite non-negative number'

/** Reads the host globals fresh on every call so substituted hosts are honoured. */
function hostGlobals(): ISchedulerHostGlobals {
  return globalThis as unknown as ISchedulerHostGlobals
}

/**
 * Creates a native error of the requested type and attaches the utils boundary identity without
 * replacing the error object, so callers can branch on both the native type and `code`.
 */
function schedulerError(
  Constructor: ISchedulerErrorConstructor,
  code: IUtilsErrorCode,
  message: string
): Error {
  return attachErrorIdentity(new Constructor(message), { source: '@migaia/utils', code })
}

/**
 * Rejects a delay-like argument before any state changes: a non-number is a `TypeError`, a
 * non-finite or negative number is a `RangeError`; both carry `INVALID_ARGUMENT`.
 */
function assertDelay(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  if (!Number.isFinite(value) || value < 0)
    throw schedulerError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  return value
}

/**
 * Adds a validated increment to the virtual clock and rejects an overflowing target before the
 * caller mutates its heap or clock.
 */
function addVirtualTime(base: number, delta: number, field: string): number {
  /** Candidate absolute virtual time; only returned when it stayed finite. */
  const target = base + delta
  if (!Number.isFinite(target))
    throw schedulerError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  return target
}

/**
 * Default scheduler: `performance.now()` as the monotonic clock and host `setTimeout` /
 * `clearTimeout` for timers. Host capabilities are checked lazily on each call and a missing or
 * non-finite capability fails with `ENV_UNSUPPORTED` instead of silently degrading. The object is
 * deliberately a plain mutable object so tests can spy on its methods.
 */
export const systemScheduler: IScheduler = {
  now() {
    /** Host performance object whose `now` method must stay its own receiver. */
    const performanceHost = hostGlobals().performance
    if (typeof performanceHost?.now !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.monotonicClock)
      )
    /** Raw host clock reading; a throw from the host propagates unchanged. */
    const value: unknown = Reflect.apply(performanceHost.now, performanceHost, [])
    if (typeof value !== 'number')
      throw schedulerError(
        TypeError,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.finiteClock)
      )
    if (!Number.isFinite(value))
      throw schedulerError(
        RangeError,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.finiteClock)
      )
    return value
  },
  schedule(callback, delayMs) {
    assertDelay(delayMs, 'delayMs')
    /** One host snapshot so the registering and cancelling functions always pair up. */
    const host = hostGlobals()
    /** Host timer registration captured once for every segment of this task. */
    const setCandidate = host.setTimeout
    /** Host timer cancellation paired with the registration function for this task. */
    const clearCandidate = host.clearTimeout
    if (typeof setCandidate !== 'function' || typeof clearCandidate !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.timers)
      )
    /** Admitted host registration function. */
    const set = setCandidate as IHostSetTimeout
    /** Admitted host cancellation function, always paired with `set`. */
    const clear = clearCandidate as IHostClearTimeout
    /** Delay still to wait after the currently armed segment. */
    let remaining = delayMs
    /** Native handle of the currently armed segment; the receiver `unref` needs. */
    let handle: unknown
    /** True once the task was cancelled or its callback started; blocks further segments. */
    let settled = false
    /** Whether `unref()` was requested, so every later segment is unref'd as well. */
    let unrefRequested = false
    /** Applies the unref hint to the current native timer with the timer as receiver. */
    const applyUnref = (): void => {
      /** Native timer viewed structurally; browsers return numbers without `unref`. */
      const timer = handle as { readonly unref?: unknown } | null | undefined
      if (typeof timer?.unref === 'function') Reflect.apply(timer.unref, timer, [])
    }
    /** Arms the next segment; long delays re-arm until nothing remains. */
    const arm = (): void => {
      if (settled) return
      /** Length of this segment, bounded by the host timer maximum. */
      const segment = Math.min(remaining, MAXIMUM_TIMER_DELAY)
      remaining -= segment
      handle = set(() => {
        if (settled) return
        if (remaining > 0) arm()
        else {
          settled = true
          callback()
        }
      }, segment)
      if (unrefRequested) applyUnref()
    }
    arm()
    return {
      cancel() {
        if (settled) return
        settled = true
        clear(handle)
      },
      unref() {
        unrefRequested = true
        applyUnref()
      }
    }
  }
}

/**
 * Creates a deterministic scheduler over a virtual clock that starts at `0`. Due callbacks run in
 * ascending due time and, for equal due times, registration order; callbacks scheduled during an
 * `advance()` that fall due within it run in the same `advance()`. Arguments are validated and
 * overflow is rejected before any state changes; nested `advance()` calls are rejected so `now()`
 * never moves backwards.
 */
export function createManualScheduler(): IManualScheduler {
  /** Current virtual time in milliseconds. */
  let current = 0
  /** Registration counter that orders tasks with equal due times. */
  let sequence = 0
  /** Whether an `advance()` is flushing callbacks; guards against reentrant advances. */
  let advancing = false
  /** One registered task inside the min-heap. */
  type IManualTask = {
    readonly due: number
    readonly order: number
    index: number
    callback: (() => void) | undefined
  }
  /** Min-heap of pending tasks ordered by due time, then registration order. */
  const tasks: IManualTask[] = []
  /** Heap ordering: earlier due time first, then earlier registration. */
  const compareTasks = (left: IManualTask, right: IManualTask): number =>
    left.due - right.due || left.order - right.order
  /** Exchanges two heap entries and keeps cancellation handles synchronized with their indexes. */
  const swapTasks = (left: number, right: number): void => {
    ;[tasks[left], tasks[right]] = [tasks[right]!, tasks[left]!]
    tasks[left]!.index = left
    tasks[right]!.index = right
  }
  /** Restores heap order toward the root after an indexed insertion or removal. */
  const siftUp = (start: number): void => {
    /** Heap slot currently being compared with its parent. */
    let index = start
    while (index > 0) {
      /** Parent slot of `index` in the implicit binary heap. */
      const parent = Math.floor((index - 1) / 2)
      if (compareTasks(tasks[parent]!, tasks[index]!) <= 0) break
      swapTasks(parent, index)
      index = parent
    }
  }
  /** Restores heap order toward the leaves after a root or indexed removal. */
  const siftDown = (start: number): void => {
    /** Heap slot currently being compared with its children. */
    let index = start
    while (true) {
      /** Left child slot of `index`. */
      const left = index * 2 + 1
      /** Right child slot of `index`. */
      const right = left + 1
      /** Slot holding the earliest task among `index` and its children. */
      let smallest = index
      if (left < tasks.length && compareTasks(tasks[left]!, tasks[smallest]!) < 0) smallest = left
      if (right < tasks.length && compareTasks(tasks[right]!, tasks[smallest]!) < 0)
        smallest = right
      if (smallest === index) break
      swapTasks(index, smallest)
      index = smallest
    }
  }
  /** Removes one task by its handle index in O(log n); a no-op for tasks already removed. */
  const removeTask = (task: IManualTask): void => {
    /** Heap slot recorded on the task handle. */
    const index = task.index
    if (index < 0 || tasks[index] !== task) return
    /** Last heap entry, moved into the freed slot. */
    const last = tasks.pop()!
    task.index = -1
    if (index === tasks.length) return
    tasks[index] = last
    last.index = index
    if (index > 0 && compareTasks(tasks[Math.floor((index - 1) / 2)]!, last) > 0) siftUp(index)
    else siftDown(index)
  }
  return {
    now: () => current,
    schedule(callback, delayMs) {
      assertDelay(delayMs, 'delayMs')
      /** Absolute due time; overflow is rejected before the heap changes. */
      const due = addVirtualTime(current, delayMs, 'delayMs')
      /** Heap entry owned by the returned handle. */
      const task: IManualTask = { due, order: sequence++, index: tasks.length, callback }
      tasks.push(task)
      siftUp(task.index)
      return {
        cancel() {
          task.callback = undefined
          removeTask(task)
        },
        unref: () => undefined
      }
    },
    advance(ms) {
      if (advancing)
        throw schedulerError(TypeError, UtilsErrorCode.reentrantCall, UtilsErrorText.reentrantCall)
      assertDelay(ms, 'ms')
      /** Virtual time reached when this advance completes; overflow rejected before flushing. */
      const target = addVirtualTime(current, ms, 'ms')
      /** Callbacks flushed by this advance, bounded by the runaway guard. */
      let count = 0
      advancing = true
      try {
        while (true) {
          /** Earliest pending task, if any. */
          const next = tasks[0]
          if (next === undefined || next.due > target) break
          if (++count > MAXIMUM_ADVANCE_FLUSH)
            throw schedulerError(
              RangeError,
              UtilsErrorCode.schedulerRunaway,
              UtilsErrorText.schedulerRunaway
            )
          removeTask(next)
          current = next.due
          /** Callback detached before running so it can run at most once. */
          const callback = next.callback
          next.callback = undefined
          callback?.()
        }
        current = target
      } finally {
        advancing = false
      }
    },
    get pendingCount() {
      return tasks.length
    }
  }
}

/** Default wall clock: `Date.now()` epoch milliseconds, for diagnostic timestamps only. */
export const systemWallClock: IWallClock = {
  timestamp: () => Date.now()
}
