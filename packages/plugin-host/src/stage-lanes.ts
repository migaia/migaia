import type { IMiddlewarePipelineMode, IMiddlewarePipelineStage } from '@migaia/middleware-pipeline'
import { registerPluginHostStage } from './pipeline-runtime.js'
import type { IQuiescenceTracker } from '@migaia/lifecycle'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'

/** The one canonical lane already lifted into the host execution mode. */
export type ILaneSet<TValue> = {
  stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
}

/** One retained plugin stage with its original within-owner registration sequence. */
type IOwnedStage<TValue> = Readonly<{
  readonly owner: object
  readonly ownerName: string
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  readonly sequence: number
}>

/** Owns the single host-mode stage lane and immutable execution snapshots. */
export class StageLanes<TValue> {
  /** Stages already lifted into the exact host mode. */
  #stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[] = []
  /** Owner provenance for committed and candidate stage functions. */
  readonly stageOwners = new WeakMap<Function, string>()
  /** Stable quiescence keys, so removal drains only the revoked plugin stages. */
  readonly pipelineOwnerKeys = new Map<string, object>()
  /** Canonical plugin-owned stages retained while an owner is temporarily inactive. */
  #owned: IOwnedStage<TValue>[] = []
  /** Monotonic within-owner registration order used when rebuilding the lane. */
  #nextSequence = 0
  /** Frozen execution snapshot reused until a committed lane mutation. */
  #snapshot: readonly IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[] | undefined

  /** Invalidates the execution snapshot after a lane mutation. */
  #invalidate(): void {
    this.#snapshot = undefined
  }

  /** Registers one stage after the host runner has lifted it into the host mode. */
  register<TDomainCore extends object>(context: {
    readonly host: object
    readonly kind: IMiddlewarePipelineMode
    readonly depth: number
    readonly stage: Function
    readonly lift: (
      stage: Function,
      kind: IMiddlewarePipelineMode
    ) => IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
    readonly owner: IRegistration<TDomainCore, TValue> | undefined
    readonly activeBatch: unknown
    readonly stageSlots: Map<string, IDataOrderSlotState>
    readonly allocateSlot: () => bigint
  }): void {
    const lifted = context.lift(context.stage, context.kind)
    this.#invalidate()
    registerPluginHostStage({
      host: context.host,
      depth: context.depth,
      stage: lifted,
      owner: context.owner,
      activeBatch: context.activeBatch,
      stages: this.#stages,
      stageSlots: context.stageSlots,
      stageOwners: this.stageOwners,
      pipelineOwnerKeys: this.pipelineOwnerKeys,
      allocateSlot: context.allocateSlot,
      readLiveStages: () => [this.#stages]
    } as never)
    if (context.owner)
      this.#owned.push({
        owner: context.owner,
        ownerName: context.owner.name,
        stage: lifted,
        sequence: this.#nextSequence++
      })
  }

  /** Rebuilds plugin-owned stages from enabled registrations without reallocating slots. */
  rebuild<TDomainCore extends object>(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    stageSlots: ReadonlyMap<string, IDataOrderSlotState>
  ): void {
    this.#invalidate()
    const enabled = new Set<object>(registrations)
    const compare = (left: IOwnedStage<TValue>, right: IOwnedStage<TValue>) => {
      const leftSlot = stageSlots.get(left.ownerName)?.ordinal ?? 1n << 100n
      const rightSlot = stageSlots.get(right.ownerName)?.ordinal ?? 1n << 100n
      return leftSlot === rightSlot ? left.sequence - right.sequence : leftSlot < rightSlot ? -1 : 1
    }
    const hostStages = this.#stages.filter((stage) => this.stageOwners.get(stage) === undefined)
    const pluginStages = this.#owned
      .filter((entry) => enabled.has(entry.owner))
      .sort(compare)
      .map((entry) => entry.stage)
    this.#stages = [...hostStages, ...pluginStages]
  }

  /** Forgets canonical stages only when their owner is actually removed. */
  removeOwner(owner: object): void {
    this.#invalidate()
    this.#owned = this.#owned.filter((entry) => entry.owner !== owner)
  }

  /** The distinct owners of a stage snapshot, for the leases one execution must retain. */
  ownersOf(stages: readonly Function[]): readonly string[] {
    const owners = new Set<string>()
    for (const stage of stages) {
      const owner = this.stageOwners.get(stage)
      if (owner !== undefined) owners.add(owner)
    }
    return [...owners]
  }

  /** Retains the global lease and each distinct owner of one immutable stage snapshot. */
  retainLeases(
    leases: IQuiescenceTracker<object>,
    pipelineKey: object,
    stages: readonly Function[]
  ): () => void {
    const releases = [leases.retain(pipelineKey)]
    for (const owner of this.ownersOf(stages)) {
      const key = this.pipelineOwnerKeys.get(owner)
      if (key !== undefined) releases.push(leases.retain(key))
    }
    return () => {
      for (const release of releases) release()
    }
  }

  /** The live lane used by candidate batches. */
  get lanes(): ILaneSet<TValue> {
    return { stages: this.#stages }
  }

  /** The immutable stages one execution will traverse. */
  snapshot(): readonly IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[] {
    if (this.#snapshot) return this.#snapshot
    this.#snapshot = Object.freeze([...this.#stages])
    return this.#snapshot
  }

  /** A fresh lane copy for a candidate install batch. */
  copy(): ILaneSet<TValue> {
    return { stages: [...this.#stages] }
  }

  /** Adopts a committed batch lane wholesale. */
  replace(next: ILaneSet<TValue>): void {
    this.#invalidate()
    this.#stages = next.stages
  }

  /** Empties the lane and retained owner ledger. */
  clear(): void {
    this.#invalidate()
    this.#stages.length = 0
    this.#owned = []
  }
}
