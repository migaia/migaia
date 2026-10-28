/** Own the extracted original Set deadlines; indexed deadlines land separately. */
import type { IScheduler, IScheduledTask } from './scheduler-contract.ts'
import { assertDelay, addVirtualTime } from './scheduler-validation.ts'
import { NativeTaskReference } from './native-timer.ts'

/** Endpoint identity retains its one existing scheduler owner. */
export const sharedSchedulers = new WeakMap<object, IScheduler>()

type ISharedDeadline = {
  readonly due: number
  callback: (() => void) | undefined
  unreferenced: boolean
}

export class SharedScheduler implements IScheduler {
  /** Explicit scheduler owner replaces the original enclosing-module reference. */
  readonly #scheduler: IScheduler

  /** Capture the canonical owner without registering a task. */
  constructor(scheduler: IScheduler) {
    this.#scheduler = scheduler
  }

  /** Set insertion order supplies FIFO ties for exactly equal deadlines. */
  #deadlines = new Set<ISharedDeadline>()
  /** Sole active native timer serving this endpoint. */
  #armed: IScheduledTask | undefined
  /** An earlier idle wakeup may be retained after cancellation. */
  #armedDue = Number.POSITIVE_INFINITY
  /** Avoid duplicate native ref/unref while reflecting each logical task's liveness. */
  #armedUnreferenced = false

  /** Clock substitution remains observable through the original scheduler owner. */
  now = (): number => this.#scheduler.now()

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
    const next = this.#first()
    if (!next) return
    if (next.due > this.#scheduler.now()) {
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
    const due = addVirtualTime(this.#scheduler.now(), delayMs, 'delayMs')
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

export function sharedScheduler(receiver: object, schedulerOwner: IScheduler): IScheduler {
  /** Reuse the endpoint's original scheduling strategy. */
  const existing = sharedSchedulers.get(receiver)
  if (existing) return existing
  /** This owner alone manages the receiver's native timer. */
  const scheduler = new SharedScheduler(schedulerOwner)
  sharedSchedulers.set(receiver, scheduler)
  return scheduler
}
