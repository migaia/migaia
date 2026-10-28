/** Owns native timer state and resources without adding a scheduling policy. */

import type { IScheduledTask } from './scheduler-contract.ts'

/** Host timer registration function shape, admitted only after a `typeof` check. */
export type IHostSetTimeout = (callback: () => void, delayMs: number) => unknown

/** Host timer cancellation function shape, admitted only after a `typeof` check. */
export type IHostClearTimeout = (handle: unknown) => void

/**
 * Largest delay a host timer accepts without clamping (signed 32-bit maximum). Longer delays are
 * split into segments of at most this length so the callback does not fire early.
 */
export const MAXIMUM_TIMER_DELAY = 2_147_483_647

/** Native re-reference belongs to its task, without a per-registration global identity table. */
export class NativeTaskReference extends class {
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
export class NativeTimerTask {
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
