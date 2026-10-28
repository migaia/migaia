/** Owns debounce control state and its existing native resource lifetime. */

import { reportUnhandledError } from '../host-report.ts'

import { asyncTask } from './async-task.ts'
import { type IScheduledTask, type IScheduler } from './scheduler.ts'
import type { IControlledFunction, IDebounceOptions, IThrottleOptions } from './rate-contract.ts'
import { admitFunction, admitWait, admitSignal, admitScheduler } from './rate-admission.ts'

/** One pending invocation owns the latest arguments and completed result for either rate control. */
export class PendingInvocation<F extends (...args: never[]) => unknown> {
  /** User callback is invoked as a plain function, preserving its original receiver semantics. */
  #fn: F
  /** The newest undelivered call replaces earlier arguments. */
  #args: Parameters<F> | undefined
  /** Idle flush returns the most recent successful result. */
  #result: ReturnType<F> | undefined
  /** Capture the already-admitted callback without invoking it. */
  constructor(fn: F) {
    this.#fn = fn
  }
  /** Replace the one pending call. */
  stage(args: Parameters<F>): void {
    this.#args = args
  }
  /** Cancel arguments while retaining the last result. */
  clear(): void {
    this.#args = undefined
  }
  /** Whether one call remains undelivered. */
  get pending(): boolean {
    return this.#args !== undefined
  }
  /** Consume before invoking so reentrant calls create a fresh pending call. */
  invoke(): ReturnType<F> | undefined {
    /** One invocation consumes this exact argument list before user code runs. */
    const args = this.#args
    this.#args = undefined
    if (args === undefined) return this.#result
    this.#result = Reflect.apply(this.#fn, undefined, args) as ReturnType<F>
    return this.#result
  }
}

/** One debounce burst owns its quiet/max timers and terminal abort marker. */
export class DebouncedFunction<F extends (...args: never[]) => unknown> {
  /** Shared invocation owner preserves reentrant argument and result behavior. */
  #invocation: PendingInvocation<F>
  /** Validated quiet-period duration. */
  #delay: number
  /** Optional upper bound for a continuous burst. */
  #maxWait: number | undefined
  /** Leading calls run only when there is no active quiet timer. */
  #leading: boolean
  /** Trailing delivery defaults to enabled. */
  #trailing: boolean
  /** Timer registration and cancellation retain their canonical scheduler. */
  #scheduler: IScheduler
  /** Quiet timer also identifies whether a burst is active. */
  #waitTask: IScheduledTask | undefined
  /** Continuous bursts share one maximum-wait timer. */
  #maxTask: IScheduledTask | undefined
  /** Abort permanently fences later calls. */
  #disposed = false
  /** The frozen callable retains the original public API shape. */
  readonly controlled: IControlledFunction<F>

  /** Admit configuration in the original read order, then expose one controlled callable. */
  constructor(fn: F, wait: number, options: IDebounceOptions) {
    admitFunction(fn, 'fn')
    this.#delay = admitWait(wait, 'wait')
    this.#maxWait =
      options.maxWait === undefined ? undefined : admitWait(options.maxWait, 'maxWait')
    this.#leading = options.leading === true
    this.#trailing = options.trailing !== false
    this.#scheduler = admitScheduler(options.scheduler)
    /** Subscription admission remains after scheduler admission. */
    const signal = admitSignal(options.signal)
    this.#invocation = new PendingInvocation(fn)
    /** The callable is a receipt for this owner, not a second state container. */
    const controlled = this.#call as IControlledFunction<F>
    controlled.cancel = this.#cancel
    controlled.flush = this.#flush
    controlled.pending = () => this.#waitTask !== undefined && this.#invocation.pending
    controlled[Symbol.dispose] = this.#cancel
    if (signal) {
      if (signal.aborted) this.#abort()
      else signal.addEventListener('abort', this.#abort, { once: true })
    }
    this.controlled = Object.freeze(controlled)
  }

  /** Timer-driven callbacks have no caller; preserve host reporting of thrown failures. */
  #invokeFromTimer(): void {
    try {
      this.#invocation.invoke()
    } catch (error) {
      reportUnhandledError(error)
    }
  }
  /** End a burst and release both timer handles. */
  #clearTimers(): void {
    this.#waitTask?.cancel()
    this.#maxTask?.cancel()
    this.#waitTask = undefined
    this.#maxTask = undefined
  }
  /** A quiet period ends the burst and optionally delivers its latest call. */
  #onWait = (): void => {
    this.#waitTask = undefined
    this.#maxTask?.cancel()
    this.#maxTask = undefined
    if (this.#trailing) this.#invokeFromTimer()
    else this.#invocation.clear()
  }
  /** A continuing burst can arm a fresh maximum window on its next call. */
  #onMaxWait = (): void => {
    this.#maxTask = undefined
    if (this.#invocation.pending) this.#invokeFromTimer()
  }
  /** Replace pending arguments and rearm the quiet period before a possible leading invocation. */
  #call = (...args: Parameters<F>): void => {
    if (this.#disposed) return
    /** Leading admission observes the previous burst marker. */
    const idle = this.#waitTask === undefined
    this.#invocation.stage(args)
    this.#waitTask?.cancel()
    this.#waitTask = this.#scheduler.schedule(this.#onWait, this.#delay)
    if (this.#maxWait !== undefined && this.#maxTask === undefined)
      this.#maxTask = this.#scheduler.schedule(this.#onMaxWait, this.#maxWait)
    if (idle && this.#leading) this.#invocation.invoke()
  }
  /** Cancellation drops pending work without erasing the last completed result. */
  #cancel = (): void => {
    this.#clearTimers()
    this.#invocation.clear()
  }
  /** Explicit flush throws directly to its caller. */
  #flush = (): ReturnType<F> | undefined => {
    this.#clearTimers()
    return this.#invocation.invoke()
  }
  /** External abort is terminal, unlike ordinary cancellation. */
  #abort = (): void => {
    this.#disposed = true
    this.#cancel()
  }
}

/** One frame throttle owns its frame request and terminal abort state. */
export class FrameThrottledFunction<F extends (...args: never[]) => unknown> {
  /** Invocation semantics are shared with numeric debounce. */
  #invocation: PendingInvocation<F>
  /** Cancels this owner's single pending frame. */
  #frame: AbortController | undefined
  /** External abort permanently fences later calls. */
  #disposed = false
  /** The frozen callable is the only public receipt. */
  readonly controlled: IControlledFunction<F>

  /** Capture the admitted signal before creating the callable and installing its observer. */
  constructor(fn: F, options: IThrottleOptions) {
    admitFunction(fn, 'fn')
    /** Frame throttling does not read unrelated numeric scheduler options. */
    const signal = admitSignal(options.signal)
    this.#invocation = new PendingInvocation(fn)
    /** All attached operations share this one frame owner. */
    const controlled = this.#call as IControlledFunction<F>
    controlled.cancel = this.#cancel
    controlled.flush = this.#flush
    controlled.pending = () => this.#frame !== undefined
    controlled[Symbol.dispose] = this.#cancel
    if (signal) {
      if (signal.aborted) this.#abort()
      else signal.addEventListener('abort', this.#abort, { once: true })
    }
    this.controlled = Object.freeze(controlled)
  }
  /** Stage the newest arguments and request at most one native frame. */
  #call = (...args: Parameters<F>): void => this.#stage(args)

  /** Stage arguments and own the one frame registration and its cancellation observer. */
  #stage(args: Parameters<F>): void {
    if (this.#disposed) return
    this.#invocation.stage(args)
    if (this.#frame) return
    /** Cancellation belongs to this exact frame registration. */
    const controller = new AbortController()
    this.#frame = controller
    asyncTask('animationFrame', this.#onFrame, { signal: controller.signal }).then(
      undefined,
      (error: unknown) => {
        if (!controller.signal.aborted) reportUnhandledError(error)
      }
    )
  }
  /** A delivered frame retires its cancellation token before reentrant user code runs. */
  readonly #onFrame = (): void => {
    this.#frame = undefined
    this.#invocation.invoke()
  }

  /** Drop the pending frame and its arguments. */
  #cancel = (): void => {
    this.#frame?.abort()
    this.#frame = undefined
    this.#invocation.clear()
  }
  /** Flush cancels the native frame before invoking synchronously. */
  #flush = (): ReturnType<F> | undefined => {
    this.#frame?.abort()
    this.#frame = undefined
    return this.#invocation.invoke()
  }
  /** External abort is terminal. */
  #abort = (): void => {
    this.#disposed = true
    this.#cancel()
  }
}
