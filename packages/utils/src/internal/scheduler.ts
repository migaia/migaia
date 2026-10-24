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
import { ERROR_SOURCE, UtilsErrorCode, type IUtilsErrorCode } from '../error-code.js'
import { UtilsErrorText } from '../error-text.js'
import { attachErrorIdentity } from '../error.js'

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
  /**
   * Optional non-cancellable deferred job registration. System uses native microtasks; manual
   * clocks use their existing zero-time queue. Registration is synchronous, callbacks are
   * asynchronous and any returned callback Promise belongs to its caller.
   */
  defer?(callback: () => void): void
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
  readonly queueMicrotask?: unknown
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
  message: string,
  options?: ErrorOptions
): Error {
  return attachErrorIdentity(new Constructor(message, options), { source: ERROR_SOURCE, code })
}

/**
 * Register one deferred job through its scheduler receiver. Older two-method schedulers use
 * schedule(callback, 0); default System jobs retain native microtask order. This does not await
 * callback results or create a cancellation owner. Registration failures propagate by identity.
 */
export function deferTask(scheduler: IScheduler, callback: () => void): void {
  if (typeof callback !== 'function')
    throw schedulerError(TypeError, UtilsErrorCode.invalidArgument, UtilsErrorText.deferredCallback)
  if ((typeof scheduler !== 'object' && typeof scheduler !== 'function') || scheduler === null)
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredScheduler
    )
  /** Capture only the method required for this operation, retaining its original receiver. */
  let deferred: unknown
  /** Legacy schedulers need their ordinary zero-time registration only when no defer exists. */
  let scheduled: unknown
  try {
    deferred = scheduler.defer
    if (deferred === undefined) scheduled = scheduler.schedule
  } catch (cause) {
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredAccessor,
      { cause }
    )
  }
  /** Both paths invoke exactly one captured method after admission. */
  const register = deferred === undefined ? scheduled : deferred
  if (typeof register !== 'function')
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredScheduler
    )
  Reflect.apply(register, scheduler, deferred === undefined ? [callback, 0] : [callback])
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

/** Endpoint-derived receiver identities retain one canonical scheduler strategy per endpoint. */
const sharedSchedulers = new WeakMap<object, IScheduler>()
/** Native re-reference belongs to its task, without a per-registration global identity table. */
class NativeTaskReference extends class {
  /** Return the original public handle so the derived private field adds no observable properties. */
  constructor(task: IScheduledTask) {
    return task
  }
} {
  /** Restores this task's native liveness when its shared-deadline owner needs referenced work. */
  #reference: () => void

  /** Stamp the existing handle once; its cancel/unref methods and public shape remain unchanged. */
  constructor(task: IScheduledTask, reference: () => void) {
    super(task)
    this.#reference = reference
  }

  /** Only scheduler-created native handles have a private reference-restoration capability. */
  static restore(task: IScheduledTask): void {
    if (#reference in task) task.#reference()
  }
}

/** One native timer owns segmented delay, cancellation and liveness without shared closure state. */
class NativeTimerTask {
  /** The caller's original function runs with the same plain-call receiver. */
  #callback: () => void
  /** Native registration is captured with the corresponding cancellation operation. */
  #set: IHostSetTimeout
  /** Native cancellation remains paired with this task's host snapshot. */
  #clear: IHostClearTimeout
  /** Long delays retain only their unarmed remainder. */
  #remaining: number
  /** The current native segment is also the receiver for optional ref/unref hints. */
  #handle: unknown
  /** Completion and cancellation share an at-most-once fence. */
  #settled = false
  /** Every later segment inherits a previously requested unref hint. */
  #unrefRequested = false
  /** Preserve the existing plain public handle and detached cancel/unref methods. */
  readonly task: IScheduledTask

  /** Arm before publishing the original plain handle, preserving registration failure timing. */
  constructor(
    callback: () => void,
    delayMs: number,
    set: IHostSetTimeout,
    clear: IHostClearTimeout
  ) {
    this.#callback = callback
    this.#set = set
    this.#clear = clear
    this.#remaining = delayMs
    this.#arm()
    this.task = { cancel: () => this.#cancel(), unref: () => this.#unref() }
    new NativeTaskReference(this.task, () => this.#reference())
  }

  /** A segment consumes only the native maximum; each firing arms at most one successor. */
  #arm(): void {
    if (this.#settled) return
    /** Native hosts bound one segment to their signed 32-bit delay domain. */
    const segment = Math.min(this.#remaining, MAXIMUM_TIMER_DELAY)
    this.#remaining -= segment
    /** Keep the original receiver-free invocation of the captured native function. */
    const set = this.#set
    this.#handle = set(() => this.#fire(), segment)
    if (this.#unrefRequested) this.#applyUnref()
  }

  /** Complete only after all segments and before invoking a possibly reentrant caller. */
  #fire(): void {
    if (this.#settled) return
    if (this.#remaining > 0) this.#arm()
    else {
      this.#settled = true
      /** Caller callbacks are plain calls rather than methods on the timer owner. */
      const callback = this.#callback
      callback()
    }
  }

  /** Cancel the current segment once, including after repeated detached calls. */
  #cancel(): void {
    if (this.#settled) return
    this.#settled = true
    /** Cancellation preserves the same receiver-free native operation. */
    const clear = this.#clear
    clear(this.#handle)
  }

  /** Apply a liveness hint now and carry it into any later segment. */
  #unref(): void {
    this.#unrefRequested = true
    this.#applyUnref()
  }

  /** Browser numeric handles have no hint; Node/Bun retain the native timer receiver. */
  #applyUnref(): void {
    /** Only the existing handle supplies its optional native unref method. */
    const timer = this.#handle as { readonly unref?: unknown } | null | undefined
    if (typeof timer?.unref === 'function') Reflect.apply(timer.unref, timer, [])
  }

  /** Shared-deadline ownership can restore this exact native task's reference hint. */
  #reference(): void {
    this.#unrefRequested = false
    /** Browsers retain their original numeric handle behavior. */
    const timer = this.#handle as { readonly ref?: unknown } | null | undefined
    if (typeof timer?.ref === 'function') Reflect.apply(timer.ref, timer, [])
  }
}

/** One logical deadline owns its callback and independent native-liveness request. */
type ISharedDeadline = {
  readonly due: number
  callback: (() => void) | undefined
  unreferenced: boolean
}

/** One derived scheduler shares exact deadlines through the canonical native timer owner. */
class SharedScheduler implements IScheduler {
  /** Set insertion order supplies FIFO ties for exactly equal deadlines. */
  #deadlines = new Set<ISharedDeadline>()
  /** Sole active native timer serving this endpoint. */
  #armed: IScheduledTask | undefined
  /** An earlier idle wakeup may be retained after cancellation. */
  #armedDue = Number.POSITIVE_INFINITY
  /** Avoid duplicate native ref/unref while reflecting each logical task's liveness. */
  #armedUnreferenced = false

  /** Clock substitution remains observable through the original scheduler owner. */
  now = (): number => systemScheduler.now()

  /** Selects the earliest live task; strict comparison preserves insertion order for exact ties. */
  #first = (): ISharedDeadline | undefined => {
    /** Earliest task observed while walking the endpoint's bounded live task set. */
    let next: ISharedDeadline | undefined
    for (const entry of this.#deadlines)
      if (next === undefined || entry.due < next.due) next = entry
    return next
  }
  /** The native task may be unreferenced only when every remaining logical task is unreferenced. */
  #syncReference = (): void => {
    if (!this.#armed || this.#deadlines.size === 0) return
    /** Any referenced logical deadline must keep the same host liveness as its own native timer. */
    let unreferenced = true
    for (const entry of this.#deadlines)
      if (!entry.unreferenced) {
        unreferenced = false
        break
      }
    if (unreferenced === this.#armedUnreferenced) return
    this.#armedUnreferenced = unreferenced
    if (unreferenced) this.#armed.unref?.()
    else NativeTaskReference.restore(this.#armed)
  }
  /** Reuses an earlier armed wakeup; native flush will re-check exact due time before execution. */
  #arm = (): void => {
    /** An earlier native tick is retained even if its original logical deadline was cancelled. */
    const next = this.#first()
    if (!next) return
    if (this.#armed && this.#armedDue <= next.due) {
      this.#syncReference()
      return
    }
    this.#armed?.cancel()
    this.#armed = undefined
    this.#armedDue = next.due
    this.#armed = systemScheduler.schedule(
      this.#flush,
      Math.max(0, next.due - systemScheduler.now())
    )
    this.#armedUnreferenced = false
    this.#syncReference()
  }
  /** Executes one callback per native task, preserving Promise reactions before the next callback. */
  #flush = (): void => {
    this.#armed = undefined
    this.#armedDue = Number.POSITIVE_INFINITY
    this.#armedUnreferenced = false
    /** A retained earlier tick never authorizes firing another deadline early. */
    const next = this.#first()
    if (!next) return
    if (next.due > systemScheduler.now()) {
      this.#arm()
      return
    }
    this.#deadlines.delete(next)
    /** Clear callback ownership before reentrant cancellation or new registrations. */
    const callback = next.callback
    next.callback = undefined
    try {
      callback?.()
    } finally {
      this.#arm()
    }
  }

  /** Admit one deadline and roll back only its own registration if native scheduling fails. */
  schedule = (callback: () => void, delayMs: number): IScheduledTask => {
    assertDelay(delayMs, 'delayMs')
    /** Finite absolute-clock admission precedes mutation. */
    const due = addVirtualTime(systemScheduler.now(), delayMs, 'delayMs')
    /** This handle owns exactly one logical deadline. */
    const entry: ISharedDeadline = { due, callback, unreferenced: false }
    this.#deadlines.add(entry)
    try {
      this.#arm()
    } catch (error) {
      this.#deadlines.delete(entry)
      throw error
    }
    return {
      cancel: () => this.#cancel(entry),
      unref: () => {
        entry.unreferenced = true
        this.#syncReference()
      }
    }
  }

  /** Cancel one logical callback; native cancellation occurs only when no siblings remain. */
  #cancel(entry: ISharedDeadline): void {
    entry.callback = undefined
    this.#deadlines.delete(entry)
    if (this.#deadlines.size === 0) {
      this.#armed?.cancel()
      this.#armed = undefined
      this.#armedDue = Number.POSITIVE_INFINITY
      this.#armedUnreferenced = false
    } else this.#syncReference()
  }
}

/** Endpoint identity selects one named scheduler without sharing deadlines across endpoints. */
function sharedScheduler(receiver: object): IScheduler {
  /** Reuse the endpoint's original scheduling strategy. */
  const existing = sharedSchedulers.get(receiver)
  if (existing) return existing
  /** This owner alone manages the receiver's native timer. */
  const scheduler = new SharedScheduler()
  sharedSchedulers.set(receiver, scheduler)
  return scheduler
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
  /** Default deferred work stays a native microtask, independently of timer/deadline strategy. */
  defer(callback) {
    /** Read the host on each call, matching the existing timer substitution contract. */
    const host = hostGlobals()
    /** Native microtask registration is a host capability, not another library queue. */
    const enqueue = host.queueMicrotask
    if (typeof enqueue !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.microtasks)
      )
    Reflect.apply(enqueue, host, [callback])
  },
  schedule(callback, delayMs) {
    if (
      this !== systemScheduler &&
      this !== undefined &&
      Object.getPrototypeOf(this) === systemScheduler
    )
      return sharedScheduler(this).schedule(callback, delayMs)
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
    return new NativeTimerTask(callback, delayMs, set, clear).task
  }
}

/** One heap entry carries its cancellation index and FIFO tie-breaker. */
type IManualTask = {
  readonly due: number
  readonly order: number
  index: number
  callback: (() => void) | undefined
}

/** One virtual clock owns its task heap and reentrancy fence. */
class ManualScheduler implements IManualScheduler {
  /** Virtual time starts at zero and never moves backwards. */
  #current = 0
  /** Registration order breaks equal-deadline ties. */
  #sequence = 0
  /** Nested advances cannot rewind the outer clock. */
  #advancing = false
  /** Indexed min-heap supports one insertion or cancellation in O(log n). */
  #tasks: IManualTask[] = []

  /** Heap ordering: earlier due time first, then earlier registration. */
  #compareTasks = (left: IManualTask, right: IManualTask): number =>
    left.due - right.due || left.order - right.order
  /** Exchanges two heap entries and keeps cancellation handles synchronized with their indexes. */
  #swapTasks = (left: number, right: number): void => {
    ;[this.#tasks[left], this.#tasks[right]] = [this.#tasks[right]!, this.#tasks[left]!]
    this.#tasks[left]!.index = left
    this.#tasks[right]!.index = right
  }
  /** Restores heap order toward the root after an indexed insertion or removal. */
  #siftUp = (start: number): void => {
    /** Heap slot currently being compared with its parent. */
    let index = start
    while (index > 0) {
      /** Parent slot of `index` in the implicit binary heap. */
      const parent = Math.floor((index - 1) / 2)
      if (this.#compareTasks(this.#tasks[parent]!, this.#tasks[index]!) <= 0) break
      this.#swapTasks(parent, index)
      index = parent
    }
  }
  /** Restores heap order toward the leaves after a root or indexed removal. */
  #siftDown = (start: number): void => {
    /** Heap slot currently being compared with its children. */
    let index = start
    while (true) {
      /** Left child slot of `index`. */
      const left = index * 2 + 1
      /** Right child slot of `index`. */
      const right = left + 1
      /** Slot holding the earliest task among `index` and its children. */
      let smallest = index
      if (
        left < this.#tasks.length &&
        this.#compareTasks(this.#tasks[left]!, this.#tasks[smallest]!) < 0
      )
        smallest = left
      if (
        right < this.#tasks.length &&
        this.#compareTasks(this.#tasks[right]!, this.#tasks[smallest]!) < 0
      )
        smallest = right
      if (smallest === index) break
      this.#swapTasks(index, smallest)
      index = smallest
    }
  }
  /** Removes one task by its handle index in O(log n); a no-op for tasks already removed. */
  #removeTask = (task: IManualTask): void => {
    /** Heap slot recorded on the task handle. */
    const index = task.index
    if (index < 0 || this.#tasks[index] !== task) return
    /** Last heap entry, moved into the freed slot. */
    const last = this.#tasks.pop()!
    task.index = -1
    if (index === this.#tasks.length) return
    this.#tasks[index] = last
    last.index = index
    if (index > 0 && this.#compareTasks(this.#tasks[Math.floor((index - 1) / 2)]!, last) > 0)
      this.#siftUp(index)
    else this.#siftDown(index)
  }

  /** Read the current monotonic virtual clock. */
  now = (): number => this.#current

  /** Register a task against this clock without depending on the replaceable public method slot. */
  #register = (callback: () => void, delayMs: number): IScheduledTask => {
    assertDelay(delayMs, 'delayMs')
    /** Reject overflow before touching the heap. */
    const due = addVirtualTime(this.#current, delayMs, 'delayMs')
    /** The handle's index follows every heap exchange. */
    const task: IManualTask = { due, order: this.#sequence++, index: this.#tasks.length, callback }
    this.#tasks.push(task)
    this.#siftUp(task.index)
    return {
      cancel: () => {
        task.callback = undefined
        this.#removeTask(task)
      },
      unref: () => undefined
    }
  }

  /** Public registration retains detached-call behavior and the original callable identity. */
  schedule = this.#register

  /** Deferral retains the captured registration even if a caller replaces schedule. */
  defer = (callback: () => void): void => {
    this.#register(callback, 0)
  }

  /** Flush due callbacks in deadline/FIFO order, stopping at the existing fixed runaway bound. */
  advance = (ms: number): void => {
    if (this.#advancing)
      throw schedulerError(TypeError, UtilsErrorCode.reentrantCall, UtilsErrorText.reentrantCall)
    assertDelay(ms, 'ms')
    /** Validate the final clock value before any callback runs. */
    const target = addVirtualTime(this.#current, ms, 'ms')
    /**
     * MAXIMUM_ADVANCE_FLUSH is a compile-time 10000 bound, so one advance performs O(log n) heap
     * work.
     */
    let count = 0
    this.#advancing = true
    try {
      while (true) {
        /** Earliest pending deadline is always the heap root. */
        const next = this.#tasks[0]
        if (next === undefined || next.due > target) break
        if (++count > MAXIMUM_ADVANCE_FLUSH)
          throw schedulerError(
            RangeError,
            UtilsErrorCode.schedulerRunaway,
            UtilsErrorText.schedulerRunaway
          )
        this.#removeTask(next)
        this.#current = next.due
        /** Detach before reentrant cancellation or scheduling. */
        const callback = next.callback
        next.callback = undefined
        callback?.()
      }
      this.#current = target
    } finally {
      this.#advancing = false
    }
  }

  /** Cancelled and completed tasks are absent from the heap. */
  get pendingCount(): number {
    return this.#tasks.length
  }
}

/**
 * Create a deterministic clock. Callbacks scheduled during advance may run in that same advance;
 * argument overflow and reentrant advances fail before clock/heap mutation.
 */
export function createManualScheduler(): IManualScheduler {
  return new ManualScheduler()
}

/** Default wall clock: `Date.now()` epoch milliseconds, for diagnostic timestamps only. */
export const systemWallClock: IWallClock = {
  timestamp: () => Date.now()
}
