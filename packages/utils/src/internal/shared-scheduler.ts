/** Own endpoint deadline admission, native timer liveness and cancellation around the shared heap. */
import { DeadlineHeap, type IDeadlineHeapEntry } from './deadline-heap.ts'

import type { IScheduler, IScheduledTask } from './scheduler-contract.ts'
import { assertDelay, addVirtualTime } from './scheduler-validation.ts'
import { NativeTaskReference } from './native-timer.ts'

/** Endpoint-derived receiver identities retain one canonical scheduler strategy per endpoint. */
export const sharedSchedulers = new WeakMap<object, IScheduler>()

/** One logical deadline owns its callback and independent native-liveness request. */
export type ISharedDeadline = IDeadlineHeapEntry & {
  callback: (() => void) | undefined
  unreferenced: boolean
  /** Queue membership is retired before user callbacks or cancellation can reenter. */
  active: boolean
}

/** One derived scheduler shares exact deadlines through the canonical native timer owner. */
export class SharedScheduler implements IScheduler {
  /** Canonical host scheduler remains the only source of time, tasks and liveness hints. */
  readonly #scheduler: IScheduler

  /** Captures the canonical scheduler without creating an endpoint registration. */
  constructor(scheduler: IScheduler) {
    this.#scheduler = scheduler
  }

  /** The canonical heap owns indexed removal and FIFO ties without allocating task wrappers. */
  #deadlines = new DeadlineHeap<ISharedDeadline>()
  /** Referenced membership is updated at admission, unref and removal, making liveness O(1). */
  #referenced = 0
  /** Sole active native timer serving this endpoint. */
  #armed: IScheduledTask | undefined
  /** An earlier idle wakeup may be retained after cancellation. */
  #armedDue = Number.POSITIVE_INFINITY
  /** Avoid duplicate native ref/unref while reflecting each logical task's liveness. */
  #armedUnreferenced = false

  /** Clock substitution remains observable through the original scheduler owner. */
  now = (): number => this.#scheduler.now()

  /** The native task may be unreferenced only when every remaining logical task is unreferenced. */
  #syncReference(): void {
    if (!this.#armed || this.#deadlines.size === 0) return
    /** Every live referenced registration contributes once to the incrementally maintained count. */
    const unreferenced = this.#referenced === 0
    if (unreferenced === this.#armedUnreferenced) return
    this.#armedUnreferenced = unreferenced
    if (unreferenced) this.#armed.unref?.()
    else NativeTaskReference.restore(this.#armed)
  }
  /** Reuses an earlier armed wakeup; native flush will re-check exact due time before execution. */
  #arm(): void {
    /** An earlier native tick is retained even if its original logical deadline was cancelled. */
    const next = this.#deadlines.first
    if (!next) return
    if (this.#armed && this.#armedDue <= next.due) {
      this.#syncReference()
      return
    }
    this.#armed?.cancel()
    this.#armed = undefined
    this.#armedDue = next.due
    this.#armed = this.#scheduler.schedule(
      this.#flush,
      Math.max(0, next.due - this.#scheduler.now())
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
    const next = this.#deadlines.first
    if (!next) return
    if (next.due > this.#scheduler.now()) {
      this.#arm()
      return
    }
    this.#deadlines.remove(next)
    next.active = false
    if (!next.unreferenced) this.#referenced--
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
  schedule = (callback: () => void, delayMs: number): IScheduledTask =>
    this.#schedule(callback, delayMs)

  /** Owns one logical deadline admission and its independent cancellation receipt. */
  #schedule(callback: () => void, delayMs: number): IScheduledTask {
    assertDelay(delayMs, 'delayMs')
    /** Finite absolute-clock admission precedes mutation. */
    const due = addVirtualTime(this.#scheduler.now(), delayMs, 'delayMs')
    /** This handle owns exactly one logical deadline. */
    const entry: ISharedDeadline = {
      due,
      order: this.#deadlines.takeOrder(),
      index: this.#deadlines.size,
      callback,
      unreferenced: false,
      active: true
    }
    this.#deadlines.add(entry)
    this.#referenced++
    try {
      this.#arm()
    } catch (error) {
      this.#deadlines.remove(entry)
      entry.active = false
      if (!entry.unreferenced) this.#referenced--
      throw error
    }
    return {
      cancel: () => this.#cancel(entry),
      unref: () => {
        if (entry.active && !entry.unreferenced) this.#referenced--
        entry.unreferenced = true
        this.#syncReference()
      }
    }
  }

  /** Cancel one logical callback; native cancellation occurs only when no siblings remain. */
  #cancel(entry: ISharedDeadline): void {
    entry.callback = undefined
    this.#deadlines.remove(entry)
    if (entry.active && !entry.unreferenced) this.#referenced--
    entry.active = false
    if (this.#deadlines.size === 0) {
      this.#armed?.cancel()
      this.#armed = undefined
      this.#armedDue = Number.POSITIVE_INFINITY
      this.#armedUnreferenced = false
    } else this.#syncReference()
  }
}

/** Endpoint identity selects one named scheduler without sharing deadlines across endpoints. */
export function sharedScheduler(receiver: object, schedulerOwner: IScheduler): IScheduler {
  /** Reuse the endpoint's original scheduling strategy. */
  const existing = sharedSchedulers.get(receiver)
  if (existing) return existing
  /** This owner alone manages the receiver's native timer. */
  const scheduler = new SharedScheduler(schedulerOwner)
  sharedSchedulers.set(receiver, scheduler)
  return scheduler
}
