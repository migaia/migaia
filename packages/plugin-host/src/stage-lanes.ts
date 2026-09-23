import { PluginHostPipelineMode } from './state-constants.js'
import { registerPluginHostStage } from './pipeline-runtime.js'
import type { IQuiescenceTracker } from '@migaia/lifecycle'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'

/** One lane per execution algebra; a host runs exactly one of them but holds all four. */
export type ILaneSet<TValue> = {
  syncStages: ISyncPipelineStage<TValue>[]
  asyncStages: IAsyncPipelineStage<TValue>[]
  generatorStages: IGeneratorPipelineStage<TValue>[]
  asyncGeneratorStages: IAsyncGeneratorPipelineStage<TValue>[]
}

/** One retained plugin stage with its original within-owner registration sequence. */
type IOwnedStage = Readonly<{
  readonly kind: IPipelineMode
  readonly owner: string
  readonly stage: Function
  readonly sequence: number
}>

/**
 * The four stage lanes, and the one rule about how execution reads them.
 *
 * `snapshot()` is the whole point: every mode runs over a copy, so a stage that registers or
 * removes another stage cannot change the sequence of the run it is inside. Two of the four modes
 * used to pass the live array straight to the runner, which meant the same program had two
 * different answers depending on which algebra it was configured with — a divergence with no design
 * behind it.
 */
export class StageLanes<TValue> {
  /** Sync lane; empty until a plugin registers into it. */
  #sync: ISyncPipelineStage<TValue>[] = []
  /** Async lane; empty until a plugin registers into it. */
  #async: IAsyncPipelineStage<TValue>[] = []
  /** Generator lane; empty until a plugin registers into it. */
  #generator: IGeneratorPipelineStage<TValue>[] = []
  /** Async-generator lane; empty until a plugin registers into it. */
  #asyncGenerator: IAsyncGeneratorPipelineStage<TValue>[] = []
  /** Owner provenance for committed and candidate stage functions. */
  readonly stageOwners = new WeakMap<Function, string>()
  /** Stable quiescence keys, so removal drains only the revoked plugin's stages. */
  readonly pipelineOwnerKeys = new Map<string, object>()
  /** Canonical plugin-owned stages retained while an owner is temporarily disabled. */
  #owned: IOwnedStage[] = []
  /** Monotonic within-owner registration order used when rebuilding lanes. */
  #nextSequence = 0

  /**
   * Registers one stage into its lane.
   *
   * The lanes, the slot table and the two ownership ledgers are all read by this one operation, and
   * they now live together — the host used to hand twelve separate references to it, which meant
   * the host had to keep holding all twelve for no other reason.
   */
  register<TDomainCore extends object>(context: {
    readonly host: object
    readonly hostMode: IPipelineMode
    readonly kind: IPipelineMode
    readonly depth: number
    readonly stage: Function
    readonly owner: IRegistration<TDomainCore, TValue> | undefined
    readonly activeBatch: unknown
    readonly stageSlots: Map<string, IDataOrderSlotState>
    readonly allocateSlot: () => bigint
  }): void {
    registerPluginHostStage({
      ...context,
      ...this.lanes,
      stageOwners: this.stageOwners,
      pipelineOwnerKeys: this.pipelineOwnerKeys,
      readLiveStages: () => Object.values(this.lanes)
    } as never)
    if (context.owner)
      this.#owned.push({
        kind: context.kind,
        owner: context.owner.name,
        stage: context.stage,
        sequence: this.#nextSequence++
      })
  }

  /** Rebuilds plugin-owned lanes from enabled registrations without reallocating their slots. */
  rebuild<TDomainCore extends object>(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    stageSlots: ReadonlyMap<string, IDataOrderSlotState>
  ): void {
    const enabled = new Set(registrations.map((registration) => registration.name))
    const compare = (left: IOwnedStage, right: IOwnedStage) => {
      const leftSlot = stageSlots.get(left.owner)?.ordinal ?? 1n << 100n
      const rightSlot = stageSlots.get(right.owner)?.ordinal ?? 1n << 100n
      return leftSlot === rightSlot ? left.sequence - right.sequence : leftSlot < rightSlot ? -1 : 1
    }
    const select = (kind: IPipelineMode): Function[] =>
      this.#owned
        .filter((entry) => entry.kind === kind && enabled.has(entry.owner))
        .sort(compare)
        .map((entry) => entry.stage)
    const hostSync = this.#sync.filter((stage) => this.stageOwners.get(stage) === undefined)
    const hostAsync = this.#async.filter((stage) => this.stageOwners.get(stage) === undefined)
    const hostGenerator = this.#generator.filter(
      (stage) => this.stageOwners.get(stage) === undefined
    )
    const hostAsyncGenerator = this.#asyncGenerator.filter(
      (stage) => this.stageOwners.get(stage) === undefined
    )
    this.#sync = [
      ...hostSync,
      ...(select(PluginHostPipelineMode.sync) as ISyncPipelineStage<TValue>[])
    ]
    this.#async = [
      ...hostAsync,
      ...(select(PluginHostPipelineMode.async) as IAsyncPipelineStage<TValue>[])
    ]
    this.#generator = [
      ...hostGenerator,
      ...(select(PluginHostPipelineMode.generator) as IGeneratorPipelineStage<TValue>[])
    ]
    this.#asyncGenerator = [
      ...hostAsyncGenerator,
      ...(select(PluginHostPipelineMode.asyncGenerator) as IAsyncGeneratorPipelineStage<TValue>[])
    ]
  }

  /** Forgets canonical stages only when their owner is actually removed. */
  removeOwner(name: string): void {
    this.#owned = this.#owned.filter((entry) => entry.owner !== name)
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

  /** The live arrays, for the runtimes that own registration and removal. */
  get lanes(): ILaneSet<TValue> {
    return {
      syncStages: this.#sync,
      asyncStages: this.#async,
      generatorStages: this.#generator,
      asyncGeneratorStages: this.#asyncGenerator
    }
  }

  /** The stages one execution will traverse, as a copy taken at its start. */
  snapshot(mode: IPipelineMode): readonly unknown[] {
    if (mode === PluginHostPipelineMode.sync) return [...this.#sync]
    if (mode === PluginHostPipelineMode.async) return [...this.#async]
    if (mode === PluginHostPipelineMode.generator) return [...this.#generator]
    return [...this.#asyncGenerator]
  }

  /** A fresh copy of all four lanes, for a candidate batch that builds off the current ones. */
  copy(): ILaneSet<TValue> {
    return {
      syncStages: [...this.#sync],
      asyncStages: [...this.#async],
      generatorStages: [...this.#generator],
      asyncGeneratorStages: [...this.#asyncGenerator]
    }
  }

  /** Adopts a committed batch's lanes wholesale; the batch built them off the current ones. */
  replace(next: ILaneSet<TValue>): void {
    this.#sync = next.syncStages
    this.#async = next.asyncStages
    this.#generator = next.generatorStages
    this.#asyncGenerator = next.asyncGeneratorStages
  }

  /** Empties all four lanes in place, keeping every array identity the runtimes already hold. */
  clear(): void {
    this.#sync.length = 0
    this.#async.length = 0
    this.#generator.length = 0
    this.#asyncGenerator.length = 0
    this.#owned = []
  }
}
