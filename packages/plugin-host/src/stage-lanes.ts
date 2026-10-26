import { createQuiescenceTracker, type IQuiescenceTracker } from '@migaia/lifecycle'
import type {
  IAsyncMiddlewareStage,
  ISyncMiddlewareStage,
  IMiddlewarePipelineMode,
  IMiddlewarePipelineStage
} from '@migaia/middleware-pipeline'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'

/** Runner forms derived once from one canonical stage registration. */
export type IStageForms<TValue> = Readonly<{
  /** Original synchronous stage; absence prevents synchronous entry. */
  syncStage?: ISyncMiddlewareStage<TValue>
  /** Ordinary async form; generator modes keep their existing runner path. */
  asyncStage?: IAsyncMiddlewareStage<TValue>
}>

/** One exact stage registration; identical function objects still have independent lifetimes. */
export type IStageEntry<TValue> = IStageForms<TValue> & {
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  alive: boolean
}

/** Stable name slot whose visible owner changes only at publication or retirement. */
export type IStageOwnerSegment = {
  readonly kind: 'owner'
  readonly ordinal: bigint
  /** Contribution currently included in the global visible count. */
  visibleCount: number
  /** Contribution currently preventing synchronous entry. */
  visibleAsyncCount: number
  owner?: object
  retired: boolean
  /** Counted as a tombstone exactly once: set when the segment is retired and ownerless. */
  dead?: boolean
}

/** Host stages occupy their own allocation position between plugin slots. */
type IHostSegment<TValue> = {
  readonly kind: 'host'
  readonly ordinal: bigint
  /** Host-owned stages belong to exactly one declared pipeline. */
  readonly key: PropertyKey
  readonly entry: IStageEntry<TValue>
}

/** One original data-order slot owns all of its sparse pipeline contributions. */
type IStageSlotAllocation = {
  readonly kind: 'owner'
  readonly slot: IDataOrderSlotState
  /** Derived live segment count permits exact retirement without scanning other pipelines. */
  owners: number
}

/** The shared order contains each allocated slot once, plus actual host-owned stage occurrences. */
type IStageAllocation = IHostSegment<any> | IStageSlotAllocation

/** One insertion-ordered index preserves original ordinals without dense per-pipeline reservation. */
class StageAllocationOrder {
  /** Original slot ordinals are unique within this Host and remain stable through replacement. */
  readonly #allocations = new Map<bigint, IStageAllocation>()

  /** A slot enters once at its original allocation time, independently of its eventual pipelines. */
  ensureSlot(slot: IDataOrderSlotState): void {
    if (!this.#allocations.has(slot.ordinal))
      this.#allocations.set(slot.ordinal, { kind: 'owner', slot, owners: 0 })
  }

  /** Host-owned stages occupy their original allocation position and only their declared lane. */
  appendHost(key: PropertyKey, ordinal: bigint, entry: IStageEntry<any>): void {
    this.#allocations.set(ordinal, { kind: 'host', ordinal, key, entry })
  }

  /** Deletes one exact host occurrence from the original allocation index in O(1). */
  removeHost(ordinal: bigint): void {
    this.#allocations.delete(ordinal)
  }

  /** Binding the first current generation adds one actual visible pipeline owner to its slot. */
  bindOwner(ordinal: bigint): void {
    /** The original slot was reserved before any candidate could register its first stage. */
    const allocation = this.#allocations.get(ordinal) as IStageSlotAllocation
    allocation.owners += 1
  }

  /** Existing visibility retirement releases its exact segment and its last retired slot in O(1). */
  releaseOwner(ordinal: bigint): void {
    /** Exact segment-owner checks at the caller prevent stale generation cleanup from decrementing. */
    const allocation = this.#allocations.get(ordinal) as IStageSlotAllocation
    allocation.owners -= 1
    if (allocation.owners === 0 && allocation.slot.retired) this.#allocations.delete(ordinal)
  }

  /** Explicit slot retirement removes only an ownerless original slot; live stages remain visible. */
  retireSlot(slot: IDataOrderSlotState): void {
    /** Retirement follows the existing slot flag and never creates a second lifecycle. */
    const allocation = this.#allocations.get(slot.ordinal)
    if (allocation?.kind === 'owner' && allocation.slot === slot && allocation.owners === 0)
      this.#allocations.delete(slot.ordinal)
  }

  /** Snapshot compilation traverses one canonical allocation order and selects this lane's entries. */
  values(): IterableIterator<IStageAllocation> {
    return this.#allocations.values()
  }

  /** Host terminal disposal drops the original order index after all lane snapshots are retired. */
  clear(): void {
    this.#allocations.clear()
  }
}

/** Frozen stages and the exact generation keys retained by one execution. */
export type IStageSnapshot<TValue> = Readonly<{
  readonly stages: readonly IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
  readonly ownerKeys: readonly object[]
  /** Original synchronous stage forms in this version's canonical order. */
  readonly syncStages: readonly ISyncMiddlewareStage<TValue>[]
  /** Async stage forms derived from those same registrations. */
  readonly asyncStages: readonly IAsyncMiddlewareStage<TValue>[]
}>

/** Append-only allocation-order lane with one cached immutable execution snapshot per version. */
export class StageLanes<TValue> {
  /** One lifecycle tracker owns execution, version, and generation leases. */
  readonly leases: IQuiescenceTracker<object>
  /** One declared pipeline owns this lane's registration entries and snapshot order. */
  readonly #key: PropertyKey
  /** Reverse traversal is compiled once with the immutable snapshot. */
  readonly #reverse: boolean
  /** A plugin-owned lane pins its defining generation in each nonempty snapshot. */
  readonly #ownerKey: object | undefined
  /** All declared lanes borrow the same original data-order index. */
  readonly #order: StageAllocationOrder
  /** Visible stage count maintained at mutation boundaries for the empty fast path. */
  #size = 0
  /** Visible asynchronous count maintained without scanning stages on execution. */
  #asyncStageCount = 0
  /** Cached version, invalidated only when visible execution can change. */
  #snapshot: IStageSnapshot<TValue> | undefined
  /** Retires the cached version's owner pins after its last execution releases. */
  #retireSnapshot: (() => void) | undefined

  /** Share the Host tracker while retaining this pipeline's independent registration view. */
  constructor(
    key: PropertyKey,
    leases: IQuiescenceTracker<object>,
    reverse = false,
    order = new StageAllocationOrder(),
    ownerKey?: object
  ) {
    this.#ownerKey = ownerKey
    this.#key = key
    this.leases = leases
    this.#reverse = reverse
    this.#order = order
  }

  /** Visible stages, excluding disabled, suspended, unpublished and retired owners. */
  get size(): number {
    return this.#size
  }

  /** Stages that require the asynchronous entry in an ordinary sync/async host. */
  get asyncStageCount(): number {
    return this.#asyncStageCount
  }

  /** Applies a segment delta to the cached totals; no execution scans registrations. */
  #setContribution(segment: IStageOwnerSegment, count: number, asynchronous: number): void {
    this.#size += count - segment.visibleCount
    this.#asyncStageCount += asynchronous - segment.visibleAsyncCount
    segment.visibleCount = count
    segment.visibleAsyncCount = asynchronous
  }

  /** Refreshes only the changed owner's visible contribution and invalidates derived views. */
  refreshOwner<TDomainCore extends object>(registration: IRegistration<TDomainCore, TValue>): void {
    /** Candidates and old generations cannot alter a committed segment's counts. */
    const segment = registration.segments.get(this.#key)
    if (segment?.owner !== registration) return
    /** Live entries contributed by this exact generation. */
    let count = 0
    /** Synchronous execution requires an original sync form on every visible entry. */
    let asynchronous = 0
    if (registration.enabled && !registration.suspended) {
      for (const entry of registration.stageEntries.get(this.#key) ?? []) {
        if (!entry.alive) continue
        count += 1
        if (!entry.syncStage) asynchronous += 1
      }
    }
    this.#setContribution(segment, count, asynchronous)
    this.invalidate()
  }

  /** Invalidates the cached execution version after a visible mutation. */
  invalidate(): void {
    this.#retireSnapshot?.()
    this.#retireSnapshot = undefined
    this.#snapshot = undefined
  }

  /** Allocates the segment as soon as its opaque data-order slot is created. */
  ensureSlot(slot: IDataOrderSlotState): IStageOwnerSegment {
    const existing = slot.segments?.get(this.#key)
    if (existing) return existing
    /** One append preserves the slot's allocation position without insertion or sorting. */
    const segment: IStageOwnerSegment = {
      kind: 'owner',
      ordinal: slot.ordinal,
      visibleCount: 0,
      visibleAsyncCount: 0,
      retired: false
    }
    this.#order.ensureSlot(slot)
    ;(slot.segments ??= new Map()).set(this.#key, segment)
    return segment
  }

  /** Appends a host-owned stage at its allocation position. */
  appendHost(
    stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>,
    ordinal: bigint,
    forms: IStageForms<TValue> = {}
  ): () => void {
    /** Exact host occurrence is removed without altering another identical stage. */
    const entry: IStageEntry<TValue> = { stage, ...forms, alive: true }
    this.#order.appendHost(this.#key, ordinal, entry)
    this.#size += 1
    if (!forms.syncStage) this.#asyncStageCount += 1
    this.invalidate()
    return () => {
      if (!entry.alive) return
      entry.alive = false
      this.#order.removeHost(ordinal)
      this.#size -= 1
      if (!forms.syncStage) this.#asyncStageCount -= 1
      this.invalidate()
    }
  }

  /** Records a candidate stage on its exact registration, invisible until publication. */
  registerOwner<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    slot: IDataOrderSlotState,
    stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>,
    forms: IStageForms<TValue> = {}
  ): () => void {
    registration.segments.set(this.#key, this.ensureSlot(slot))
    /** Disposer toggles only its own occurrence, even when another owner uses the same function. */
    const entry: IStageEntry<TValue> = { stage, ...forms, alive: true }
    /** Each entry is indexed once by its pipeline, without rescanning unrelated stages. */
    let entries = registration.stageEntries.get(this.#key)
    if (!entries) registration.stageEntries.set(this.#key, (entries = []))
    entries.push(entry)
    /** The public removal handle and native cleanup share this exact idempotent disposer. */
    const remove = (): void => {
      if (!entry.alive) return
      entry.alive = false
      if (registration.segments.get(this.#key)?.owner === registration)
        this.refreshOwner(registration)
    }
    registration.pipelineDisposers.push(remove)
    return remove
  }

  /** A declared group's owner participates in the same retirement index even before adding stages. */
  bindDefinition<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    slot: IDataOrderSlotState
  ): void {
    registration.segments.set(this.#key, this.ensureSlot(slot))
    this.bindOwner(registration)
  }

  /** Switches a slot to the committed generation at the publication point. */
  bindOwner<TDomainCore extends object>(registration: IRegistration<TDomainCore, TValue>): void {
    const segment = registration.segments.get(this.#key)
    if (!segment) return
    if (!segment.owner) this.#order.bindOwner(segment.ordinal)
    segment.owner = registration
    this.refreshOwner(registration)
  }

  /** Detaches visibility before sealing the old generation's lease key. */
  retireLeaseOwner<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    leases: IQuiescenceTracker<object>
  ): void {
    const segment = registration.segments.get(this.#key)
    if (segment?.owner === registration) {
      segment.owner = undefined
      this.#setContribution(segment, 0, 0)
      this.invalidate()
      this.#order.releaseOwner(segment.ordinal)
    }
    leases.seal(registration.pipelineOwnerKey)
  }

  /** Retires the original sparse segment without disturbing a still-committed owner. */
  retireSlot(slot: IDataOrderSlotState): void {
    /** A lane that never received a stage for this slot owns no segment to retire. */
    const segment = slot.segments?.get(this.#key)
    if (segment) segment.retired = true
    this.#order.retireSlot(slot)
  }

  /** Freezes the visible stage list and generation keys once for this lane version. */
  snapshot(): IStageSnapshot<TValue> {
    if (this.#snapshot) return this.#snapshot
    /** Visible stages in the same allocation order as their segments. */
    const stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[] = []
    /** Derived sync forms preserve the same registrations and generation snapshot. */
    const syncStages: ISyncMiddlewareStage<TValue>[] = []
    /** Derived async forms reuse canonical middleware lifting rather than a second registry. */
    const asyncStages: IAsyncMiddlewareStage<TValue>[] = []
    /** Appends one visible entry to each supported runner projection. */
    const append = (entry: IStageEntry<TValue>): void => {
      stages.push(entry.stage)
      if (entry.syncStage) syncStages.push(entry.syncStage)
      if (entry.asyncStage) asyncStages.push(entry.asyncStage)
    }
    /** Lease keys belonging to registrations that contribute visible stages. */
    const ownerKeys: object[] = this.#ownerKey ? [this.#ownerKey] : []
    for (const allocation of this.#order.values()) {
      if (allocation.kind === 'host') {
        if (allocation.key === this.#key && allocation.entry.alive) append(allocation.entry)
        continue
      }
      /** Only actual stage contributions allocate a segment for this declared pipeline. */
      const segment = allocation.slot.segments?.get(this.#key)
      const owner = segment?.owner as IRegistration<object, TValue> | undefined
      if (!owner || !owner.enabled || owner.suspended) continue
      let contributed = false
      for (const entry of owner.stageEntries.get(this.#key) ?? []) {
        if (!entry.alive) continue
        append(entry)
        contributed = true
      }
      if (contributed && owner.pipelineOwnerKey !== this.#ownerKey)
        ownerKeys.push(owner.pipelineOwnerKey)
    }
    if (this.#reverse) {
      stages.reverse()
      syncStages.reverse()
      asyncStages.reverse()
    }
    /** Immutable version doubles as the lifecycle execution lease key. */
    const snapshot = Object.freeze({
      stages: Object.freeze(stages),
      syncStages: Object.freeze(syncStages),
      asyncStages: Object.freeze(asyncStages),
      ownerKeys: Object.freeze(ownerKeys)
    })
    /** Owner pins belong to the immutable version, rather than every execution. */
    const releases = ownerKeys.map((key) => this.leases.retain(key))
    /** Retired versions keep their owners alive until all executions have left. */
    const releaseOwners = (): void => {
      for (const release of releases) release()
    }
    this.#retireSnapshot = () => {
      this.leases.seal(snapshot)
      if (this.leases.count(snapshot) === 0) releaseOwners()
      else void this.leases.whenZero(snapshot).then(releaseOwners)
    }
    this.#snapshot = snapshot
    return snapshot
  }

  /** Each execution retains exactly the global key and its immutable version. */
  retainLeases(pipelineKey: object, snapshot: IStageSnapshot<TValue>): () => void {
    /** Global draining counts real executions; owner draining counts their pinned versions. */
    const releaseGlobal = this.leases.retain(pipelineKey)
    if (snapshot.ownerKeys.length === 0) return releaseGlobal
    /** The version cannot retire between snapshot capture and this synchronous retain. */
    const releaseVersion = this.leases.retain(snapshot)
    return () => {
      releaseVersion()
      releaseGlobal()
    }
  }

  /** Clears every segment when the host reaches terminal disposal. */
  clear(): void {
    this.#size = 0
    this.#asyncStageCount = 0
    this.invalidate()
  }
}

/** The default has a private symbol identity and can never collide with an application string. */
export const DEFAULT_PIPELINE_KEY = Symbol('default-pipeline')

/** One Host owns all lane visibility and a single tracker shared by every declared pipeline. */
export class StageLaneCollection<TValue> {
  /** All generation, execution and snapshot leases use the same canonical Host tracker. */
  readonly leases = createQuiescenceTracker<object>()
  /** Declared pipelines are fixed before any installation allocates a data-order slot. */
  readonly #lanes = new Map<PropertyKey, StageLanes<any>>()
  /** Allocation order belongs once to this Host, rather than once per declared pipeline. */
  readonly #order = new StageAllocationOrder()

  /** Without named configuration only the original default lane is allocated. */
  constructor() {
    this.declare(DEFAULT_PIPELINE_KEY)
  }

  /** Construction alone declares lanes; the public Host never exposes this mutation. */
  declare(key: PropertyKey, reverse = false, ownerKey?: object): StageLanes<any> {
    const existing = this.#lanes.get(key)
    if (existing) return existing
    const lanes = new StageLanes(key, this.leases, reverse, this.#order, ownerKey)
    this.#lanes.set(key, lanes)
    return lanes
  }

  /** The same entry backs legacy default methods and typed named registration. */
  get default(): StageLanes<TValue> {
    return this.#lanes.get(DEFAULT_PIPELINE_KEY)!
  }

  /** Reserve one original ordinal in O(1), independently of the number of declared pipelines. */
  ensureSlot(slot: IDataOrderSlotState): void {
    this.#order.ensureSlot(slot)
  }

  /** Availability changes only revisit the pipelines actually owned by this registration. */
  refreshOwner<TDomainCore extends object>(registration: IRegistration<TDomainCore, TValue>): void {
    for (const key of registration.segments.keys()) this.#lanes.get(key)?.refreshOwner(registration)
  }

  /** Atomic publication switches all pipeline segments to this exact candidate generation. */
  bindOwner<TDomainCore extends object>(registration: IRegistration<TDomainCore, TValue>): void {
    for (const key of registration.segments.keys()) this.#lanes.get(key)?.bindOwner(registration)
  }

  /** Withdraw every visible contribution before sealing its existing aggregate generation fence. */
  retireLeaseOwner<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    leases: IQuiescenceTracker<object>
  ): void {
    for (const key of registration.segments.keys())
      this.#lanes.get(key)?.retireLeaseOwner(registration, leases)
    leases.seal(registration.pipelineOwnerKey)
  }

  /** Exact opaque slot retirement reaches every lane without changing shared allocation order. */
  retireSlot(slot: IDataOrderSlotState): void {
    for (const key of slot.segments?.keys() ?? []) this.#lanes.get(key)?.retireSlot(slot)
    this.#order.retireSlot(slot)
  }

  /** Removes one group's lanes in a single pass over original sparse allocations. */
  remove(keys: ReadonlySet<PropertyKey>): void {
    for (const key of keys) {
      this.#lanes.get(key)?.clear()
      this.#lanes.delete(key)
    }
    for (const allocation of this.#order.values()) {
      if (allocation.kind === 'host') {
        if (keys.has(allocation.key)) {
          allocation.entry.alive = false
          this.#order.removeHost(allocation.ordinal)
        }
        continue
      }
      for (const key of allocation.slot.segments?.keys() ?? [])
        if (keys.has(key)) allocation.slot.segments!.delete(key)
    }
  }

  /** Terminal disposal releases every cached snapshot and pipeline-owned stage reference. */
  clear(): void {
    for (const lanes of this.#lanes.values()) lanes.clear()
    this.#order.clear()
  }
}
