/**
 * Owns escaping dispatch contexts and frozen registration controls; never mutates channel
 * membership.
 */
import type {
  IEventContext,
  IEventDispatchControl,
  IEventDispatchSnapshot,
  IEventListener,
  IEventValueListener,
  IUnsubscribe
} from '../types.js'
import { EventDelivery } from '../state-constants.js'
import {
  addEventProjection,
  type IEventProjectionPlan,
  type IEventProjectionOutcome
} from '../value-projection.js'
import { validateTaskId } from './channel-options.js'

/** Live registration state needed by the immutable control surface. */
export type IRegistrationControlOwner = {
  active: boolean
  aborted: boolean
  abortReason: unknown
  currentTaskId: string | undefined
  release: IUnsubscribe
}

/** Registration data captured once per dispatch, separate from linked-list ownership. */
export type IRegistrationSnapshotOwner<T, R, V> = IRegistrationControlOwner & {
  listener: IEventListener<T, R, V> | IEventValueListener<T, R>
  delivery: EventDelivery
  control: IEventDispatchControl
}

/** Per-dispatch data shared by the prototype accessors, never reused between contexts. */
type IEventContextState<T, R, V> = {
  /** Payload delivered by this dispatch. */
  readonly value: T
  /** Registration snapshot of this dispatch: listener, task name at dispatch start and live control. */
  readonly snapshot: IEventDispatchSnapshot<T, R, V>
}

/** Keeps dispatch data on each escaping context while sharing the read-only accessors. */
class EventContext<T, R, V> implements IEventContext<T> {
  /** A single state slot avoids multiple private-field maps in the ES2020 build. */
  readonly #state: IEventContextState<T, R, V>

  /** Each cancellation callback retains its registration independently of the call-site receiver. */
  declare readonly abort: (reason?: unknown) => void
  /** Each retagging callback remains safe to detach or retain after listener delivery. */
  declare readonly setTaskId: (taskId: string | undefined) => void

  /** Captures one dispatch without reusing contexts or installing per-instance accessors. */
  constructor(value: T, snapshot: IEventDispatchSnapshot<T, R, V>) {
    this.#state = { value, snapshot }
    this.abort = (reason?: unknown): void => {
      snapshot.control.abort(reason)
    }
    this.setTaskId = (taskId: string | undefined): void => {
      snapshot.control.setTaskId(taskId)
    }
  }

  /** Returns the original payload without cloning or projection. */
  get value(): T {
    return this.#state.value
  }

  /** Reads cancellation from the registration retained by this dispatch. */
  get aborted(): boolean {
    return this.#state.snapshot.control.aborted
  }

  /** Preserves the exact reason identity recorded by the registration. */
  get abortReason(): unknown {
    return this.#state.snapshot.control.abortReason
  }

  /** Retains the label captured before listeners can retag their registration. */
  get taskId(): string | undefined {
    return this.#state.snapshot.taskId
  }
}

/** Creates a distinct live context and then appends the existing immutable projection alias. */
export const createEventContext = <T, R, V = undefined>(
  value: T,
  snapshot: IEventDispatchSnapshot<T, R, V>,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): IEventContext<T> => {
  /** Every listener invocation owns its context, including callbacks retained after dispatch. */
  const context = new EventContext(value, snapshot)
  if (projection) addEventProjection(context, projection.plan, projection.outcome)
  return context
}

/** Keeps internal control state off the frozen object's observable own-property surface. */
const controlOwners = new WeakMap<
  IEventDispatchControl,
  Pick<
    IRegistrationControlOwner,
    'active' | 'aborted' | 'abortReason' | 'currentTaskId' | 'release'
  >
>()

/** Reuses control functions while preserving the original plain object's own descriptors and order. */
const ownerControlDescriptors = Object.getOwnPropertyDescriptors({
  /** Whether the registration is still linked into its channel. */
  get active(): boolean {
    return controlOwners.get(this)!.active
  },
  /** Whether the registration was cancelled through `abort()`. */
  get aborted(): boolean {
    return controlOwners.get(this)!.aborted
  },
  /** Reason passed to `abort()`, kept with its identity. */
  get abortReason(): unknown {
    return controlOwners.get(this)!.abortReason
  },
  /** Cancels only this registration: records the reason and releases it. Does nothing once inactive. */
  abort(reason?: unknown): void {
    /** Only the control's registration is released, even when another owner has the same listener. */
    const owner = controlOwners.get(this)!
    if (!owner.active) return
    owner.aborted = true
    owner.abortReason = reason
    owner.release()
  },
  /**
   * Changes the task name later dispatches see; snapshots already taken keep their name. Does
   * nothing once inactive.
   */
  setTaskId(taskId: string | undefined): void {
    /** Retagging remains live while each dispatch snapshot keeps its earlier fixed task label. */
    const owner = controlOwners.get(this)!
    if (!owner.active) return
    owner.currentTaskId = validateTaskId(taskId, true)
  }
} satisfies IEventDispatchControl)

/** Builds one frozen own-property control without allocating five functions per registration. */
export const createOwnerControl = (owner: IRegistrationControlOwner): IEventDispatchControl => {
  /** The WeakMap entry owns the registration for exactly as long as a control remains reachable. */
  const control = Object.create(Object.prototype, ownerControlDescriptors) as IEventDispatchControl
  controlOwners.set(control, owner)
  return Object.freeze(control)
}

/**
 * Builds a package-internal snapshot whose task label is fixed at dispatch time while abort state
 * stays live through the shared owner control. Snapshots never reach user code, so they are not
 * frozen.
 */
export const snapshotOwner = <T, R, V>(
  owner: IRegistrationSnapshotOwner<T, R, V>
): IEventDispatchSnapshot<T, R, V> => ({
  listener: owner.listener,
  delivery: owner.delivery,
  taskId: owner.currentTaskId,
  control: owner.control
})

/** Invokes one snapshot entry and returns its raw listener result. */
export const invokeDispatchSnapshot = <T, R, V = undefined>(
  snapshot: IEventDispatchSnapshot<T, R, V>,
  value: T,
  projection?: { readonly plan: IEventProjectionPlan; readonly outcome: IEventProjectionOutcome }
): R | PromiseLike<R> =>
  snapshot.delivery === EventDelivery.value
    ? (snapshot.listener as IEventValueListener<T, R>)(value)
    : (snapshot.listener as IEventListener<T, R, V>)(
        createEventContext(value, snapshot, projection) as never
      )
