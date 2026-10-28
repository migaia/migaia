/**
 * Owns one synchronous live visit and its invocation lifetime. It resumes ordered membership
 * admission after callbacks, stopping new admission at the first removal generation change.
 */
import { EventSubscriberErrorCode } from '../error-code.ts'
import { codeExistingError } from '../errors.ts'
import type { IEventChannelOptions, IEventDispatchSnapshot, IEventInvocation } from '../types.ts'
import {
  projectEventValue,
  reportEventProjectionFailure,
  type IEventProjectionPlan
} from '../value-projection.ts'
import { ChannelRegistrations, type IRegistrationOwner } from './channel-registrations.ts'
import { createEventContext, invokeDispatchSnapshot, snapshotOwner } from './dispatch-context.ts'
import { DispatchInvocation, type IInvocationScope } from './invocation.ts'

/** A visit's shared close gate avoids per-invocation cleanup callbacks. */
export class LiveVisit<T, R, V> implements IInvocationScope<T, R, V> {
  /** Membership owner supplies the append-only cursor and removal generation. */
  readonly #registrations: ChannelRegistrations<T, R, V>
  /** Validated options determine where projection failures are reported. */
  readonly #options: IEventChannelOptions<T, undefined, V>
  /** Static alias projection, absent when disabled. */
  readonly #plan: IEventProjectionPlan | undefined
  /** Original payload shared by all entries. */
  readonly #value: T
  /** Optional task filter tested at each membership admission. */
  readonly #taskId: string | undefined
  /** Removal generation captured before the first admission. */
  readonly #epoch: number
  /** Last scanned owner; each committed node is scanned at most once. */
  #scanned: IRegistrationOwner<T, R, V> | undefined
  /** First admission remains valid even if the visit starts with an empty list. */
  #started = false
  /** Shared lifetime gate retained by all escaping invocation entries. */
  #closed = false
  /** Admitted owners remain scheduled even if callbacks later remove them. */
  readonly #pending: IRegistrationOwner<T, R, V>[] = []
  /** Projection result is populated only when an entry will actually be offered. */
  #projection: Parameters<typeof createEventContext<T, R, V>>[2]

  /** Captures the visit boundary; listener execution starts only in run(). */
  constructor(
    registrations: ChannelRegistrations<T, R, V>,
    options: IEventChannelOptions<T, undefined, V>,
    plan: IEventProjectionPlan | undefined,
    value: T,
    taskId: string | undefined
  ) {
    this.#registrations = registrations
    this.#options = options
    this.#plan = plan
    this.#value = value
    this.#taskId = taskId
    this.#epoch = registrations.epoch
  }

  /** Exposes only the shared lifetime gate to single-use invocation owners. */
  get closed(): boolean {
    return this.#closed
  }

  /** Invokes the offered snapshot without changing listener result or Promise identity. */
  invoke(snapshot: IEventDispatchSnapshot<T, R, V>): R | PromiseLike<R> {
    return invokeDispatchSnapshot(snapshot, this.#value, this.#projection)
  }

  /** Scans each appended owner once; no rescans occur after a removal or clear. */
  #append(): void {
    if (this.#started && this.#registrations.epoch !== this.#epoch) return
    this.#started = true
    /** Cursor starts after the last node already considered. */
    let current = this.#scanned ? this.#scanned.next : this.#registrations.first
    while (current) {
      if (
        current.committed &&
        (this.#taskId === undefined || current.currentTaskId === this.#taskId)
      )
        this.#pending.push(current)
      this.#scanned = current
      current = current.next
    }
  }

  /** Offers live entries in O(n), closes every entry before reporting or rethrowing failures. */
  run(visitor: (invocation: IEventInvocation<R>) => void): void {
    /** Original visitor failure remains primary after invocation cleanup. */
    let primaryError: unknown
    /** Separates throwing undefined from successful completion. */
    let visitorFailed = false
    try {
      this.#append()
      /** Queue cursor advances without shifting or copying admitted owners. */
      let index = 0
      while (index < this.#pending.length) {
        /** Registration remains admitted even when a prior callback removes it. */
        const owner = this.#pending[index++]!
        if (!this.#projection && this.#plan)
          this.#projection = {
            plan: this.#plan,
            outcome: projectEventValue(this.#value, this.#plan)
          }
        /** Fixed task label is captured when this owner is offered. */
        const snapshot = snapshotOwner(owner)
        visitor(new DispatchInvocation(this, snapshot, false).entry)
        this.#append()
      }
    } catch (error) {
      visitorFailed = true
      primaryError = error
    } finally {
      this.#closed = true
      if (this.#projection?.outcome.diagnostic)
        reportEventProjectionFailure(
          this.#options,
          createEventContext(this.#value, snapshotOwner(this.#pending[0]!), this.#projection),
          this.#projection.outcome.diagnostic
        )
    }
    if (visitorFailed) throw codeExistingError(primaryError, EventSubscriberErrorCode.visitorFailed)
  }
}
