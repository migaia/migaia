/** Owns invocation lifetimes and snapshot visits; channel membership remains owned by the channel. */
import type {
  ICanonicalEventChannel,
  IEventDispatchSnapshot,
  IEventInvocation,
  IEventInvocationVisitor,
  IFilteredEventChannel
} from '../types.ts'
import { EventSubscriberErrorCode } from '../error-code.ts'
import { codeExistingError, createEventTypeError, eventErrorText } from '../errors.ts'
import { reportEventProjectionFailure } from '../value-projection.ts'
import { createEventContext, invokeDispatchSnapshot } from './dispatch-context.ts'
import { getCapability, type IChannelCapability } from './channel-capability.ts'

/** A visit owns the shared close gate and the dispatch arguments used by each entry. */
export type IInvocationScope<T, R, V> = {
  readonly closed: boolean
  invoke(snapshot: IEventDispatchSnapshot<T, R, V>): R | PromiseLike<R>
}

/** Owns one entry's single-use gate while preserving its plain public object shape. */
export class DispatchInvocation<T, R, V> {
  /** Visit lifetime and dispatch arguments shared with sibling entries. */
  readonly #scope: IInvocationScope<T, R, V>
  /** Registration snapshot fixed when this invocation is offered. */
  readonly #snapshot: IEventDispatchSnapshot<T, R, V>
  /** A listener may be invoked only once, even if it throws. */
  #invoked = false
  /** Public entry keeps the incumbent taskId/invoke own-property order. */
  readonly entry: IEventInvocation<R>

  /** Creates an entry without exposing the mutable owner; snapshot entries are frozen. */
  constructor(
    scope: IInvocationScope<T, R, V>,
    snapshot: IEventDispatchSnapshot<T, R, V>,
    frozen = true
  ) {
    this.#scope = scope
    this.#snapshot = snapshot
    this.entry = { taskId: snapshot.taskId, invoke: () => this.#invoke() }
    if (frozen) Object.freeze(this.entry)
  }

  /** Rejects reuse/closed visits before invoking the listener with its original result. */
  #invoke(): R | PromiseLike<R> {
    if (this.#scope.closed || this.#invoked)
      throw createEventTypeError(
        EventSubscriberErrorCode.invocationClosed,
        eventErrorText(EventSubscriberErrorCode.invocationClosed)
      )
    this.#invoked = true
    return this.#scope.invoke(this.#snapshot)
  }
}

/** Owns a fixed snapshot, its shared projection and the lifetime of every offered entry. */
class SnapshotVisit<T, R, V> implements IInvocationScope<T, R, V> {
  /** Channel capability retains validated reporting options and the projection plan. */
  readonly #capability: IChannelCapability<T, R, V>
  /** Payload identity shared by the visit's listener invocations. */
  readonly #value: T
  /** Registration order fixed before the first visitor call. */
  readonly #snapshots: readonly IEventDispatchSnapshot<T, R, V>[]
  /** Projection is computed once only when at least one target exists. */
  readonly #projection: Parameters<typeof createEventContext<T, R, V>>[2]
  /** Closes all entries synchronously on visitor completion or eventual settlement. */
  #closed = false

  /** Captures targets and projection before user code can change registrations. */
  constructor(
    channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
    value: T
  ) {
    const { capability, taskId } = getCapability(channel)
    this.#capability = capability
    this.#value = value
    this.#snapshots = capability.snapshot(taskId)
    this.#projection =
      this.#snapshots.length > 0 && capability.plan
        ? { plan: capability.plan, outcome: capability.project(value) }
        : undefined
  }

  /** Entries read one shared gate rather than requiring per-entry cleanup callbacks. */
  get closed(): boolean {
    return this.#closed
  }

  /** Delivers the captured dispatch without assimilating or replacing its result. */
  invoke(snapshot: IEventDispatchSnapshot<T, R, V>): R | PromiseLike<R> {
    return invokeDispatchSnapshot(snapshot, this.#value, this.#projection)
  }

  /** Offers frozen entries and preserves synchronous versus Promise completion behavior. */
  run(visitor: IEventInvocationVisitor<R>): void | Promise<void> {
    /** Entries retain their owner and shared lifetime independently of the visitor receiver. */
    const entries = this.#snapshots.map((snapshot) => new DispatchInvocation(this, snapshot).entry)
    try {
      /** Undefined alone means the visitor completed synchronously. */
      const result = visitor(Object.freeze(entries))
      if (result === undefined) {
        this.#close()
        return
      }
      return Promise.resolve(result).then(
        () => {
          this.#close()
        },
        (error: unknown) => {
          this.#close()
          throw codeExistingError(error, EventSubscriberErrorCode.visitorFailed)
        }
      )
    } catch (error) {
      this.#close()
      throw codeExistingError(error, EventSubscriberErrorCode.visitorFailed)
    }
  }

  /** Closes once before reporting projection diagnostics, preserving reporter reentrancy. */
  #close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.#projection?.outcome.diagnostic)
      reportEventProjectionFailure(
        this.#capability.options,
        createEventContext(this.#value, this.#snapshots[0]!, this.#projection),
        this.#projection.outcome.diagnostic
      )
  }
}

/**
 * Gives a visitor a frozen, registration-ordered list of single-use listener invocations. Use when
 * custom invocation order is needed without exposing listeners or registration ownership. Only a
 * channel created by this package instance, or its task-filter view, is accepted.
 *
 * The visitor decides which entries to invoke and whether to await their results. Entries close
 * when the visitor returns synchronously or its returned promise settles. Calling an entry twice or
 * after closure throws INVOCATION_CLOSED. Visitor failure crosses the boundary as VISITOR_FAILED
 * while retaining the original failure; malformed channels throw INVALID_CHANNEL before
 * visitation.
 */
export const withSnapshotEntries = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: IEventInvocationVisitor<R>
): void | Promise<void> => new SnapshotVisit(channel, value).run(visitor)

/**
 * Visits listener invocations synchronously, including registrations appended during this pass.
 * Unlike a fixed snapshot, a later scan can admit new registrations until a removal or clear ends
 * admission. Entries already admitted stay scheduled, even when their registrations are removed.
 * Only this package instance's canonical channel or task-filter view is accepted.
 *
 * The visitor chooses whether to invoke each entry and owns any returned listener promise. Each
 * entry is single-use; all entries close when this synchronous visitor pass finishes.
 * INVALID_CHANNEL rejects other sources; visitor throws become VISITOR_FAILED with the original
 * failure retained. This helper does not await visitor or listener results.
 */
export const invokeEachLive = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>,
  value: T,
  visitor: (invocation: IEventInvocation<R>) => void
): void => {
  const { capability, taskId } = getCapability(channel)
  /** Live-visit operation; absent on objects that are not channels of this package. */
  const liveVisit = capability.liveVisit
  if (!liveVisit) return
  liveVisit(value, taskId, visitor)
}
