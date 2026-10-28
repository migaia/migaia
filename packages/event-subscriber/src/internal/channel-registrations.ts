/**
 * Owns ordered channel membership and listener identity indexes. Exposes atomic admission, release
 * and ordered snapshots; it neither invokes listeners nor owns public handle chains.
 */
import { createInvalidOptionsError } from './channel-options.js'
import { EventAdmissionPolicy, EventRemovalPolicy, type EventDelivery } from '../state-constants.js'
import type {
  IEventChannelOptions,
  IEventDispatchControl,
  IEventDispatchSnapshot,
  IEventListener,
  IEventValueListener,
  IUnsubscribe
} from '../types.js'
import { createOwnerControl, snapshotOwner } from './dispatch-context.js'

/** Linked registration state shared with escaping dispatch controls. */
export type IRegistrationOwner<T, R, V> = {
  /** Listener identity used by admission and listener-wide release. */
  listener: IEventListener<T, R, V> | IEventValueListener<T, R>
  /** Immutable delivery argument mode. */
  delivery: EventDelivery
  /** Whether membership remains live. */
  active: boolean
  /** Whether cancellation explicitly recorded an abort reason. */
  aborted: boolean
  /** Exact reason retained by escaping contexts. */
  abortReason: unknown
  /** Current label; snapshots capture the label at their own admission time. */
  currentTaskId: string | undefined
  /** Previous member, cleared on release. */
  previous: IRegistrationOwner<T, R, V> | undefined
  /** Next member, cleared on release. */
  next: IRegistrationOwner<T, R, V> | undefined
  /** Stable idempotent release supplied to handles and controls. */
  release: IUnsubscribe
  /** Whether the registration passed handle projection and entered membership. */
  committed: boolean
  /** Frozen shared control retaining this registration's live cancellation state. */
  control: IEventDispatchControl
}

/** Owns the two-phase lifetime of one registration before and after handle projection. */
class EventRegistration<T, R, V> {
  /** Registry whose ordered list receives this registration only after commit. */
  readonly #registry: ChannelRegistrations<T, R, V>
  /** Registration state retained by public contexts through their control. */
  readonly #owner: IRegistrationOwner<T, R, V>
  /** Prevents repeated release, including release before commit. */
  #released = false
  /** Current task label; writes update the registry index before the next dispatch can select it. */
  #taskId: string | undefined

  /** Allocates inactive-to-membership state without exposing it to dispatch. */
  constructor(
    registry: ChannelRegistrations<T, R, V>,
    listener: IRegistrationOwner<T, R, V>['listener'],
    taskId: string | undefined,
    delivery: EventDelivery
  ) {
    this.#registry = registry
    this.#taskId = taskId
    this.#owner = EventRegistration.#createOwner(this, registry, listener, delivery)
    this.#owner.control = createOwnerControl(this.#owner)
  }

  /** Builds live control state with an indexed task setter and no captured component variables. */
  static #createOwner<T, R, V>(
    registration: EventRegistration<T, R, V>,
    registry: ChannelRegistrations<T, R, V>,
    listener: IRegistrationOwner<T, R, V>['listener'],
    delivery: EventDelivery
  ): IRegistrationOwner<T, R, V> {
    return {
      listener,
      delivery,
      active: true,
      aborted: false,
      abortReason: undefined,
      /** Every retag updates task membership while retaining the original registration position. */
      get currentTaskId() {
        return registration.#taskId
      },
      set currentTaskId(taskId) {
        registry.retag(registration.#owner, taskId)
        registration.#taskId = taskId
      },
      previous: registry.last,
      next: undefined,
      release: registration.release,
      committed: false,
      control: undefined as never
    }
  }

  /** Releases once; a projected duplicate handle must never release an uncommitted owner. */
  readonly release = (): void => {
    if (this.#released) return
    this.#released = true
    this.#registry.release(this.#owner)
  }

  /** Commits once after successful handle creation, unless rollback already released it. */
  readonly commit = (): void => {
    if (this.#owner.committed || this.#released) return
    this.#registry.commit(this.#owner)
  }
}

/** Maintains O(1) identity lookup and unlinking, with O(n) ordered snapshot traversal. */
export class ChannelRegistrations<T, R, V> {
  /** Head of the registration-order list. */
  #first: IRegistrationOwner<T, R, V> | undefined
  /** Tail for O(1) append and resuming live visits. */
  #last: IRegistrationOwner<T, R, V> | undefined
  /** Number of committed live registrations. */
  #count = 0
  /** Removal generation; live visits stop admitting additions once this changes. */
  #epoch = 0
  /** Task identity index supports exact selection and counts without scanning unrelated owners. */
  readonly #taskOwners = new Map<string, Set<IRegistrationOwner<T, R, V>>>()
  /** Unique admission index, absent for multiple channels. */
  readonly #uniqueOwners:
    | Map<IRegistrationOwner<T, R, V>['listener'], IRegistrationOwner<T, R, V>>
    | undefined
  /** Listener-wide release index, absent when removal needs only one owner. */
  readonly #listenerOwners:
    | Map<IRegistrationOwner<T, R, V>['listener'], Set<IRegistrationOwner<T, R, V>>>
    | undefined

  /** Creates only the indexes required by the admitted policies. */
  constructor(
    admissionPolicy: IEventChannelOptions<T, undefined, V>['admissionPolicy'],
    removalPolicy: IEventChannelOptions<T, undefined, V>['removalPolicy']
  ) {
    this.#uniqueOwners = admissionPolicy === EventAdmissionPolicy.unique ? new Map() : undefined
    this.#listenerOwners =
      removalPolicy === EventRemovalPolicy.listenerAll && !this.#uniqueOwners
        ? new Map()
        : undefined
  }

  /** Reads the current head without creating a membership snapshot. */
  get first(): IRegistrationOwner<T, R, V> | undefined {
    return this.#first
  }
  /** Reads the current tail while constructing an uncommitted owner. */
  get last(): IRegistrationOwner<T, R, V> | undefined {
    return this.#last
  }
  /** Reads the maintained registration count. */
  get size(): number {
    return this.#count
  }
  /** Reads the removal generation used by live admission. */
  get epoch(): number {
    return this.#epoch
  }

  /** Allocates a two-phase registration; membership changes only when its commit runs. */
  register(
    listener: IRegistrationOwner<T, R, V>['listener'],
    taskId: string | undefined,
    delivery: EventDelivery
  ): { readonly release: IUnsubscribe; readonly commit: () => void } {
    return new EventRegistration(this, listener, taskId, delivery)
  }

  /** Finds an existing unique listener in O(1), rejecting conflicting labels or delivery modes. */
  admitUnique(
    listener: IRegistrationOwner<T, R, V>['listener'],
    taskId: string | undefined,
    delivery: EventDelivery
  ): IUnsubscribe | undefined {
    /** Existing registration preserves its original list position and control identity. */
    const existing = this.#uniqueOwners?.get(listener)
    if (!existing) return undefined
    if (existing.currentTaskId !== taskId || existing.delivery !== delivery) {
      throw createInvalidOptionsError()
    }
    return existing.release
  }

  /** Appends a projected owner and indexes its listener identity in O(1). */
  commit(owner: IRegistrationOwner<T, R, V>): void {
    owner.committed = true
    owner.previous = this.#last
    owner.next = undefined
    if (this.#last) this.#last.next = owner
    else this.#first = owner
    this.#last = owner
    this.#count += 1
    this.#uniqueOwners?.set(owner.listener, owner)
    this.#addTask(owner, owner.currentTaskId)
    if (this.#listenerOwners) {
      /** Set owned by this listener identity, removed once its final owner leaves. */
      let matching = this.#listenerOwners.get(owner.listener)
      if (!matching) this.#listenerOwners.set(owner.listener, (matching = new Set()))
      matching.add(owner)
    }
  }

  /** Releases one owner or its indexed listener group; work is proportional to removed owners. */
  release(owner: IRegistrationOwner<T, R, V>): void {
    if (this.#listenerOwners && owner.committed) {
      /** Existing membership group; iterating deletes each entry once without copying it. */
      const matching = this.#listenerOwners.get(owner.listener)
      if (!matching) return
      for (const matchingOwner of matching) this.#remove(matchingOwner, false)
      this.#epoch += 1
    } else this.#remove(owner, true)
  }

  /** Removes one member and all indexes in O(1), retaining live abort state for old contexts. */
  #remove(owner: IRegistrationOwner<T, R, V>, incrementEpoch: boolean): void {
    if (!owner.active || !owner.committed) return
    owner.active = false
    this.#removeTask(owner, owner.currentTaskId)
    if (this.#uniqueOwners?.get(owner.listener) === owner) this.#uniqueOwners.delete(owner.listener)
    /** Listener index shares the same owner nodes as the ordered list. */
    const matching = this.#listenerOwners?.get(owner.listener)
    matching?.delete(owner)
    if (matching?.size === 0) this.#listenerOwners!.delete(owner.listener)
    if (owner.previous) owner.previous.next = owner.next
    else this.#first = owner.next
    if (owner.next) owner.next.previous = owner.previous
    else this.#last = owner.previous
    owner.previous = undefined
    owner.next = undefined
    this.#count -= 1
    if (incrementEpoch) this.#epoch += 1
  }

  /** Captures registration order in O(n); every selected listener requires its own fixed snapshot. */
  snapshot(taskId?: string): readonly IEventDispatchSnapshot<T, R, V>[] {
    if (taskId !== undefined) {
      /** Empty and single-task selection need only an O(1) key lookup. */
      const matching = this.#taskOwners.get(taskId)
      if (!matching) return Object.freeze([])
      if (matching.size === 1)
        return Object.freeze([snapshotOwner(matching.values().next().value!)])
    }
    /** Snapshot entries are immutable as a list while each control stays live. */
    const snapshots: IEventDispatchSnapshot<T, R, V>[] = []
    /** Ordered cursor also preserves ordering after a listener retags itself. */
    let current = this.#first
    while (current) {
      if (taskId === undefined || current.currentTaskId === taskId)
        snapshots.push(snapshotOwner(current))
      current = current.next
    }
    return Object.freeze(snapshots)
  }

  /** Reads task count and its sole snapshot in O(1), before any listener can execute. */
  selectTask(taskId: string): {
    readonly snapshot: IEventDispatchSnapshot<T, R, V> | undefined
    readonly matchCount: number
  } {
    /** Set insertion order is irrelevant to exact selection, which requires exactly one owner. */
    const matching = this.#taskOwners.get(taskId)
    return {
      snapshot: matching?.size === 1 ? snapshotOwner(matching.values().next().value!) : undefined,
      matchCount: matching?.size ?? 0
    }
  }

  /** Updates both task groups in O(1); registration-order links never change during retagging. */
  retag(owner: IRegistrationOwner<T, R, V>, taskId: string | undefined): void {
    if (!owner.committed || !owner.active || taskId === owner.currentTaskId) return
    this.#removeTask(owner, owner.currentTaskId)
    this.#addTask(owner, taskId)
  }

  /** Inserts one task membership and creates its group only when the first owner arrives. */
  #addTask(owner: IRegistrationOwner<T, R, V>, taskId: string | undefined): void {
    if (taskId === undefined) return
    /** The registry removes empty task groups immediately. */
    let matching = this.#taskOwners.get(taskId)
    if (!matching) this.#taskOwners.set(taskId, (matching = new Set()))
    matching.add(owner)
  }

  /** Removes one task membership and releases the key when its final owner leaves. */
  #removeTask(owner: IRegistrationOwner<T, R, V>, taskId: string | undefined): void {
    if (taskId === undefined) return
    /** The exact membership group is found directly rather than rebuilt for selection. */
    const matching = this.#taskOwners.get(taskId)
    matching?.delete(owner)
    if (matching?.size === 0) this.#taskOwners.delete(taskId)
  }

  /** Clears membership in O(n), detaching every node and both identity indexes. */
  clear(): void {
    if (this.#count > 0) this.#epoch += 1
    /** Cursor saves each successor before unlinking its owner. */
    let current = this.#first
    while (current) {
      /** Successor remains reachable only until the next loop step. */
      const next = current.next
      current.active = false
      current.previous = undefined
      current.next = undefined
      current = next
    }
    this.#first = undefined
    this.#last = undefined
    this.#count = 0
    this.#uniqueOwners?.clear()
    this.#listenerOwners?.clear()
    this.#taskOwners.clear()
  }
}
