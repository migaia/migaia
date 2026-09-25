import type { IQuiescenceTracker } from '@migaia/lifecycle'
import type { IMiddlewarePipelineMode, IMiddlewarePipelineStage } from '@migaia/middleware-pipeline'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'

/** One exact stage registration; identical function objects still have independent lifetimes. */
export type IStageEntry<TValue> = {
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  alive: boolean
}

/** Stable name slot whose visible owner changes only at publication or retirement. */
export type IStageOwnerSegment = {
  readonly kind: 'owner'
  readonly ordinal: bigint
  owner?: object
  retired: boolean
}

/** Host stages occupy their own allocation position between plugin slots. */
type IHostSegment<TValue> = {
  readonly kind: 'host'
  readonly ordinal: bigint
  readonly entry: IStageEntry<TValue>
}

/** Frozen stages and the exact generation keys retained by one execution. */
export type IStageSnapshot<TValue> = Readonly<{
  readonly stages: readonly IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
  readonly ownerKeys: readonly object[]
}>

/** Append-only allocation-order lane with one cached immutable execution snapshot per version. */
export class StageLanes<TValue> {
  /** Host entries and stable plugin slots in allocation order. */
  #segments: Array<IHostSegment<TValue> | IStageOwnerSegment> = []
  /** Retired empty slots left as tombstones until amortized compaction. */
  #dead = 0
  /** Cached version, invalidated only when visible execution can change. */
  #snapshot: IStageSnapshot<TValue> | undefined

  /** Invalidates the cached execution version after a visible mutation. */
  invalidate(): void {
    this.#snapshot = undefined
  }

  /** Allocates the segment as soon as its opaque data-order slot is created. */
  ensureSlot(slot: IDataOrderSlotState): IStageOwnerSegment {
    if (slot.segment) return slot.segment
    /** One append preserves the slot's allocation position without insertion or sorting. */
    const segment: IStageOwnerSegment = {
      kind: 'owner',
      ordinal: slot.ordinal,
      retired: false
    }
    slot.segment = segment
    this.#segments.push(segment)
    return segment
  }

  /** Appends a host-owned stage at its allocation position. */
  appendHost(
    stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>,
    ordinal: bigint
  ): void {
    this.#segments.push({ kind: 'host', ordinal, entry: { stage, alive: true } })
    this.invalidate()
  }

  /** Records a candidate stage on its exact registration, invisible until publication. */
  registerOwner<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    slot: IDataOrderSlotState,
    stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  ): void {
    registration.segment = this.ensureSlot(slot)
    /** Disposer toggles only its own occurrence, even when another owner uses the same function. */
    const entry: IStageEntry<TValue> = { stage, alive: true }
    registration.stageEntries.push(entry)
    registration.pipelineDisposers.push(() => {
      if (!entry.alive) return
      entry.alive = false
      if (registration.segment?.owner === registration) this.invalidate()
    })
  }

  /** Switches a slot to the committed generation at the publication point. */
  bindOwner<TDomainCore extends object>(registration: IRegistration<TDomainCore, TValue>): void {
    if (!registration.segment) return
    registration.segment.owner = registration
    this.invalidate()
  }

  /** Detaches visibility before sealing the old generation's lease key. */
  retireLeaseOwner<TDomainCore extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    leases: IQuiescenceTracker<object>
  ): void {
    const segment = registration.segment
    if (segment?.owner === registration) {
      segment.owner = undefined
      this.invalidate()
      if (segment.retired) {
        this.#dead += 1
        this.#compactIfNeeded()
      }
    }
    leases.seal(registration.pipelineOwnerKey)
  }

  /** Retires an opaque slot without disturbing an owner that is still committed. */
  retireSlot(slot: IDataOrderSlotState): void {
    const segment = slot.segment
    if (!segment || segment.retired) return
    segment.retired = true
    if (!segment.owner) {
      this.#dead += 1
      this.#compactIfNeeded()
    }
  }

  /** Removes tombstones only when the scan can be charged to earlier retirements. */
  #compactIfNeeded(): void {
    if (this.#segments.length < 64 || this.#dead <= this.#segments.length / 2) return
    this.#segments = this.#segments.filter(
      (segment) => segment.kind === 'host' || !segment.retired || !!segment.owner
    )
    this.#dead = 0
  }

  /** Freezes the visible stage list and generation keys once for this lane version. */
  snapshot(): IStageSnapshot<TValue> {
    if (this.#snapshot) return this.#snapshot
    /** Visible stages in the same allocation order as their segments. */
    const stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[] = []
    /** Lease keys belonging to registrations that contribute visible stages. */
    const ownerKeys: object[] = []
    for (const segment of this.#segments) {
      if (segment.kind === 'host') {
        if (segment.entry.alive) stages.push(segment.entry.stage)
        continue
      }
      const owner = segment.owner as IRegistration<object, TValue> | undefined
      if (!owner || !owner.enabled || owner.suspended) continue
      let contributed = false
      for (const entry of owner.stageEntries) {
        if (!entry.alive) continue
        stages.push(entry.stage)
        contributed = true
      }
      if (contributed) ownerKeys.push(owner.pipelineOwnerKey)
    }
    this.#snapshot = Object.freeze({
      stages: Object.freeze(stages),
      ownerKeys: Object.freeze(ownerKeys)
    })
    return this.#snapshot
  }

  /** Retains the global key and only the generation keys present in this snapshot. */
  retainLeases(
    leases: IQuiescenceTracker<object>,
    pipelineKey: object,
    ownerKeys: readonly object[]
  ): () => void {
    const releases = [leases.retain(pipelineKey)]
    for (const key of ownerKeys) releases.push(leases.retain(key))
    return () => {
      for (const release of releases) release()
    }
  }

  /** Clears every segment when the host reaches terminal disposal. */
  clear(): void {
    this.#segments.length = 0
    this.#dead = 0
    this.invalidate()
  }
}
