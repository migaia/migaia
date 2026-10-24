import { TrayShutdownMode } from '../state-constants.js'
import { mergeCleanupResults } from '@migaia/lifecycle'
import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraph,
  type IDynamicCapabilityGraphOptions,
  type IDynamicGraphNodeDefinition
} from '@migaia/capability/graph/dynamic'
import { CapabilityGraphNodeState, type IGraphNodeId } from '@migaia/capability/graph'
import { createEventHub } from '@migaia/event-subscriber'
import type { IEventContext } from '@migaia/event-subscriber'
import {
  readPluginDependencies,
  asyncDisposeKey,
  type IPluginConstraint,
  type IPluginAdmission,
  type IPluginDataOrderSlot,
  type IPluginHostDisposalResult,
  type IPluginDependency
} from '@migaia/plugin-host'
import { TrayErrorCode } from '../error-code.js'
import { attachTrayError, createTrayError } from '../errors.js'
import {
  TrayHostState,
  type ICreateHostOptions,
  type ITrayHostSource,
  type ITrayHostDisposalResult,
  type ITrayHostEventMap,
  type ITrayHostState,
  type ITrayPluginConstraint,
  type ITrayPluginMutationResult,
  type ITrayPluginRemovalResult,
  type ITrayPluginPhysicalCleanupResult,
  type ITrayResolvedHost,
  type IUnsubscribe
} from './typing.js'
import {
  claimArtifactCustody,
  readRuntimeBridge,
  registerRuntimeBridge,
  type ITrayArtifactCustody
} from './internal-capability.js'
import {
  createView as createRegistrationView,
  isManagedHost,
  openComposition,
  type IPluginHostCompositionIntegration,
  type IRegistrationToken,
  type IPluginHostCompositionSnapshot
} from '@migaia/plugin-host/composition'

// 宿主不再结构上包含托管协议：协议经 `openComposition` 取得，宿主类型只描述宿主自己。
type IAnyHost = ITrayHostSource
type IAnySnapshot = IPluginHostCompositionSnapshot
type IPluginBinding = ITrayPluginConstraint<IAnyHost>
type IGraphId = IGraphNodeId
type ICleanupAccumulator = {
  errors: unknown[]
  complete: boolean
  physical: Promise<ITrayPluginPhysicalCleanupResult>[]
}
type IAdmissionRecord = {
  readonly plugin: IPluginBinding
  readonly snapshot: IPluginSnapshot
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
  readonly slot: IPluginDataOrderSlot
  receipt?: IRegistrationToken
  artifactCustody?: ITrayArtifactCustody
}
type IGraph = IDynamicCapabilityGraph<IAdmissionRecord>

/** Adjust one name's nesting count; missing/last releases erase membership just as before. */
function changeNameCount(names: Map<string, number>, name: string, delta: 1 | -1): void {
  /** Zero membership, rather than a zero-valued entry, determines mutation/quiescence admission. */
  const count = (names.get(name) ?? 0) + delta
  if (count <= 0) names.delete(name)
  else names.set(name, count)
}

/** The module-local claim records the sole managed session for each concrete Host. */
const claims = new WeakMap<object, object>()
/** Monotonic private anchor sequence; anchors never enter the managed Graph namespace. */
let anchorSequence = 0

/**
 * Constructs and owns exactly one canonical PluginHost and its dynamic dependency graph. All
 * creation options except report are required. Feature providers install before consumers; missing
 * required providers leave definitions blocked. Resolves to the managed view after reconciliation.
 * Factory/admission/startup failures roll back this call's acquired claim and retain cleanup detail
 * on the primary error. Use only the facade for mutation so its publication receipt stays current.
 */
export async function createHost<
  THost extends ITrayHostSource,
  const TPlugins extends readonly ITrayPluginConstraint<THost>[]
>(options: ICreateHostOptions<THost, TPlugins>): Promise<ITrayResolvedHost<THost, TPlugins>> {
  return new HostCreation<THost, TPlugins>(options).create()
}

/** One creation attempt owns its claim, graph startup, publication receipt and rollback context. */
class HostCreation<
  THost extends ITrayHostSource,
  TPlugins extends readonly ITrayPluginConstraint<THost>[]
> {
  /** Options are captured before constructing any actual lifecycle resource. */
  #captured: ICreateHostOptions<THost, TPlugins>
  /** The factory's concrete Host is released only if this attempt acquired its claim. */
  #concrete: THost | undefined
  /** Composition is opened once for this same concrete Host lifetime. */
  #composition: IPluginHostCompositionIntegration<object> | undefined
  /** The canonical graph owns ordering and binding generations. */
  #graph: IGraph | undefined
  /** Exact claim token prevents rollback from disposing another session. */
  #session: object | undefined
  /** The private anchor is removed by this attempt or its managed disposal. */
  #anchorName: string | undefined
  /** Logical and physical cleanup outcomes remain shared with the managed facade. */
  #cleanup: ICleanupAccumulator = { errors: [], complete: true, physical: [] }
  /** Active Runtime generations fence physical binding cleanup. */
  #activeRuntimeNames = new Map<string, number>()
  /** Synchronous callbacks fence unsupported same-run mutation. */
  #callbackRuntimeNames = new Map<string, number>()
  /** Deferred physical cleanup joins the last active generation's release. */
  #runtimeQuiescenceWaiters = new Set<() => void>()
  /** Publication always pairs this snapshot with its exact composition revision. */
  #hostSnapshot: IAnySnapshot | undefined
  /** Managed reads reject when the concrete Host revision has changed externally. */
  #revision = 0
  /** Original composition receipts are indexed by admitted plugin name. */
  #receiptsByName = new Map<string, IRegistrationToken>()

  /** Snapshot public options before any concrete Host or graph resource is acquired. */
  constructor(options: ICreateHostOptions<THost, TPlugins>) {
    this.#captured = snapshotOptions(options)
  }

  /** Complete canonical startup or roll back this attempt's own claim on the original failure. */
  async create(): Promise<ITrayResolvedHost<THost, TPlugins>> {
    try {
      await this.#createConcrete()
      /** Initial definitions retain their original registration order in the graph. */
      const admissions = await this.#prepareAdmissions()
      this.#graph = createDynamicCapabilityGraph<IAdmissionRecord>({
        report: this.#report,
        mutationAdmissionMs: this.#captured.mutationAdmissionMs,
        startBatch: this.#startBatch,
        releaseBatch: this.#releaseBatch,
        releaseBinding: this.#releaseBinding
      })
      /** Mutation and Runtime views borrow this same creation session and its canonical owners. */
      const managed = new ManagedTrayHost({
        concrete: this.#concrete!,
        graph: this.#graph,
        options: this.#captured as unknown as ICreateHostOptions<
          IAnyHost,
          readonly IPluginBinding[]
        >,
        readSnapshot: this.#readSnapshot,
        writeSnapshot: this.#writeSnapshot,
        assertOwned: this.#assertOwned,
        cleanup: this.#cleanup,
        anchorName: this.#anchorName!,
        readExpectedRevision: () => this.#revision,
        activeRuntimeNames: this.#activeRuntimeNames,
        waitForRuntimeQuiescence: this.#waitForRuntimeQuiescence
      })
      for (const admission of admissions) {
        /** Each graph definition refers to its one canonical composition admission. */
        const node = toGraphNode(admission)
        await this.#graph.register(node, admission)
      }
      await this.#graph.ready()
      this.#registerBridge(managed)
      return managed as unknown as ITrayResolvedHost<THost, TPlugins>
    } catch (error) {
      return this.#rollback(error)
    }
  }

  /** Return the currently paired canonical composition snapshot. */
  #readSnapshot = (): IAnySnapshot => this.#hostSnapshot!
  /** Publish snapshot and its revision together after a concrete mutation. */
  #writeSnapshot = (snapshot: IAnySnapshot): void => {
    this.#hostSnapshot = snapshot
    this.#revision = this.#composition!.revision
  }
  /** External raw Host mutation invalidates managed observations until ownership is restored. */
  #assertOwned = (): void => {
    if (this.#composition!.revision !== this.#revision)
      throw createTrayError(TrayErrorCode.hostMutationBypass)
  }
  /** Join physical cleanup only while some Runtime generation is still active. */
  #waitForRuntimeQuiescence = (): Promise<void> => {
    if (this.#activeRuntimeNames.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.#runtimeQuiescenceWaiters.add(resolve))
  }
  /** Release every existing cleanup waiter when the final Runtime generation exits. */
  #notifyRuntimeQuiescence(): void {
    if (this.#activeRuntimeNames.size !== 0) return
    for (const resolve of this.#runtimeQuiescenceWaiters) resolve()
    this.#runtimeQuiescenceWaiters.clear()
  }

  /** Acquire only this call's managed claim and install its private anchor before admission. */
  async #createConcrete(): Promise<void> {
    this.#concrete = this.#captured.create()
    // 用登记谓词而不是 `instanceof`：名义检查在两份包副本之间会失败，也看不见工厂产出的宿主。
    if (!isManagedHost(this.#concrete) || claims.has(this.#concrete as object))
      throw createTrayError(TrayErrorCode.invalidEntry)
    this.#composition = openComposition(this.#concrete as object)
    this.#session = {}
    claims.set(this.#concrete as object, this.#session)
    await this.#concrete.use()
    this.#anchorName = `__migaia_tray_anchor_${anchorSequence++}`
    const anchor = {
      name: this.#anchorName,
      install: () => ({})
    }
    await (
      this.#concrete.use as (...plugins: readonly IPluginConstraint<any>[]) => Promise<unknown>
    )(anchor as IPluginConstraint<any>)
    this.#hostSnapshot = this.#composition!.getCurrentSnapshot()
    this.#revision = this.#composition!.revision
  }

  /** Reporting is best effort and never changes a managed lifecycle outcome. */
  #report = (error: unknown): void => {
    try {
      this.#captured.report?.(error)
    } catch {
      // Reporter failures never alter managed state.
    }
  }

  /** Prepare provider-first initial admissions, publishing their original registration receipts. */
  async #prepareAdmissions(): Promise<IAdmissionRecord[]> {
    const admissions = this.#captured.plugins.map((plugin) => {
      /** One canonical admission owns both installation and Feature dependency projection. */
      const { snapshot, admission } = admitTrayPlugin(
        plugin as unknown as IPluginBinding,
        this.#composition!
      )
      return {
        plugin: plugin as unknown as IPluginBinding,
        snapshot,
        admission,
        slot: this.#composition!.createDataOrderSlot(snapshot.name)
      }
    })
    const orderedAdmissions = orderAdmissions(admissions)
    const initialAdmissions = computeReadyAdmissions(orderedAdmissions)
    const prepared = await this.#composition!.prepareAdmissions(
      initialAdmissions.map(({ admission, slot }) => ({ admission, slot }))
    )
    let receipts: readonly IRegistrationToken[]
    try {
      receipts = this.#composition!.commitPreparedAdmissions(prepared)
    } catch (error) {
      await this.#composition!.discardPreparedAdmissions(prepared)
      throw error
    }
    this.#hostSnapshot = this.#composition!.getCurrentSnapshot()
    this.#revision = this.#composition!.revision
    initialAdmissions.forEach((entry, index) => {
      entry.receipt = receipts[index]
    })
    this.#receiptsByName = new Map(
      initialAdmissions.map((entry) => [entry.snapshot.name, entry.receipt!] as const)
    )
    return admissions
  }

  /** Start one graph frontier through the canonical composition admission protocol. */
  #startBatch: IDynamicCapabilityGraphOptions<IAdmissionRecord>['startBatch'] = async (entries) => {
    const missing: IAdmissionRecord[] = entries
      .map((entry) => entry.binding)
      .filter((entry): entry is IAdmissionRecord => entry !== undefined)
      .filter((entry) => !this.#receiptsByName.has(entry.snapshot.name))
    if (missing.length > 0) {
      const prepared = await this.#composition!.prepareAdmissions(
        missing.map(({ admission, slot }) => ({ admission, slot }))
      )
      let nextReceipts: readonly IRegistrationToken[]
      try {
        nextReceipts = this.#composition!.commitPreparedAdmissions(prepared)
      } catch (error) {
        await this.#composition!.discardPreparedAdmissions(prepared)
        throw error
      }
      missing.forEach((entry, index) => {
        entry.receipt = nextReceipts[index]
        this.#receiptsByName.set(entry.snapshot.name, nextReceipts[index])
      })
      this.#hostSnapshot = this.#composition!.getCurrentSnapshot()
      this.#revision = this.#composition!.revision
    }
    return entries.map((entry) => {
      const record = entry.binding
      if (!record) throw createTrayError(TrayErrorCode.invalidEntry)
      return { value: record.plugin, release: async () => undefined }
    })
  }
  /** Release graph frontiers in reverse dependency order with the original quiescence budget. */
  #releaseBatch: IDynamicCapabilityGraphOptions<IAdmissionRecord>['releaseBatch'] = async (
    entries,
    fence
  ) => {
    const cleanupOrder = [...entries].reverse()
    const currentReceipts = cleanupOrder.map((entry) => {
      const receipt = entry.binding?.receipt ?? this.#receiptsByName.get(String(entry.id))
      if (!receipt) throw createTrayError(TrayErrorCode.hostMutationBypass)
      return receipt
    })
    const removalPromise = this.#composition!.commitPreparedUnUseBatch(
      this.#composition!.prepareUnUseBatch(currentReceipts),
      { beforeCleanup: fence }
    )
    const bounded =
      this.#captured.shutdown.mode === TrayShutdownMode['strict-drain']
        ? { complete: true as const, value: await removalPromise }
        : await settleWithin(removalPromise, this.#captured.quiescenceMs)
    if (!bounded.complete) {
      this.#cleanup.complete = false
      this.#cleanup.physical.push(mergeCleanupResults([removalPromise]))
      this.#hostSnapshot = this.#composition!.getCurrentSnapshot()
      this.#revision = this.#composition!.revision
      for (const entry of cleanupOrder) this.#receiptsByName.delete(String(entry.id))
      return
    }
    const removal = bounded.value
    this.#hostSnapshot = removal.snapshot as IAnySnapshot
    this.#revision = this.#composition!.revision
    this.#cleanup.errors.push(...removal.cleanupErrors)
    this.#cleanup.complete = this.#cleanup.complete && removal.cleanupComplete
    if (removal.physicalCompletion) {
      if (this.#captured.shutdown.mode === TrayShutdownMode['strict-drain']) {
        const physicalResult = await removal.physicalCompletion
        this.#cleanup.errors.push(...physicalResult.cleanupErrors)
        this.#cleanup.complete = this.#cleanup.complete && physicalResult.cleanupErrors.length === 0
      } else this.#cleanup.physical.push(removal.physicalCompletion)
    }
    for (const entry of cleanupOrder) this.#receiptsByName.delete(String(entry.id))
  }
  /** Release provisional artifact custody only after active Runtime generations quiesce. */
  #releaseBinding: NonNullable<IDynamicCapabilityGraphOptions<IAdmissionRecord>['releaseBinding']> =
    async (entry) => {
      if (this.#activeRuntimeNames.has(entry.binding?.snapshot.name ?? '')) {
        this.#cleanup.complete = false
        const deferred = this.#waitForRuntimeQuiescence().then(async () => {
          /**
           * Errors raised by this binding's deferred rollback only. `cleanup.errors` is shared by
           * the whole removal, so returning it would repeat other bindings' errors here.
           */
          const bindingErrors: unknown[] = []
          try {
            await entry.binding?.artifactCustody?.rollback()
          } catch (error) {
            const cleanupError = attachTrayError(error, TrayErrorCode.artifactCleanupFailed)
            bindingErrors.push(cleanupError)
            this.#cleanup.errors.push(cleanupError)
            this.#cleanup.complete = false
            this.#report(cleanupError)
          }
          return Object.freeze({ cleanupErrors: Object.freeze(bindingErrors) })
        })
        this.#cleanup.physical.push(deferred)
        return
      }
      try {
        await entry.binding.artifactCustody?.rollback()
      } catch (error) {
        const cleanupError = attachTrayError(error, TrayErrorCode.artifactCleanupFailed)
        this.#cleanup.errors.push(cleanupError)
        this.#cleanup.complete = false
        this.#report(cleanupError)
      }
    }
  /** Register Runtime leases against the same graph and managed mutation owner. */
  #registerBridge(managed: ManagedTrayHost): void {
    registerRuntimeBridge(managed as object, {
      acquire: (name) => {
        const lease = this.#graph!.acquireBinding(name as IGraphId)
        const record = lease.value
        if (!record.receipt) {
          lease.release()
          throw createTrayError(TrayErrorCode.unavailable)
        }
        const view = createRegistrationView(record.receipt)
        return Object.freeze({
          extensions: view.extensions,
          generation: record as object,
          release: lease.release
        })
      },
      beginRun: (name) => {
        changeNameCount(this.#activeRuntimeNames, name, 1)
      },
      endRun: (name) => {
        changeNameCount(this.#activeRuntimeNames, name, -1)
        this.#notifyRuntimeQuiescence()
      },
      enterCallback: (name) => {
        changeNameCount(this.#callbackRuntimeNames, name, 1)
      },
      exitCallback: (name) => {
        changeNameCount(this.#callbackRuntimeNames, name, -1)
      },
      assertMutationAllowed: (name) => {
        if (this.#callbackRuntimeNames.has(name)) throw createTrayError(TrayErrorCode.unavailable)
      },
      selfUnUse: async (name, generation, _runId) => {
        if (this.#graph!.getBinding<IAdmissionRecord>(name as IGraphId) !== generation)
          throw createTrayError(TrayErrorCode.unavailable)
        return managed.unUse(name)
      },
      selfReplace: async (name, generation, plugin, _runId) => {
        if (this.#graph!.getBinding<IAdmissionRecord>(name as IGraphId) !== generation)
          throw createTrayError(TrayErrorCode.unavailable)
        if ((plugin as { readonly name?: unknown }).name !== name)
          throw createTrayError(TrayErrorCode.runtimeContractInvalid)
        return managed.replace(plugin as IPluginBinding)
      }
    })
  }

  /** Roll back only the claim acquired by this call, retaining the original primary failure. */
  async #rollback(error: unknown): Promise<never> {
    const cleanupErrors: unknown[] = [...this.#cleanup.errors]
    const physical: Promise<ITrayPluginPhysicalCleanupResult>[] = [...this.#cleanup.physical]
    try {
      await this.#graph?.dispose()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    // Rollback owns only this call's acquired claim, never another live managed this.#session.
    if (
      this.#concrete !== undefined &&
      this.#session !== undefined &&
      claims.get(this.#concrete as object) === this.#session
    ) {
      if (this.#anchorName !== undefined) {
        try {
          const anchorRemoval = await (this.#concrete as IAnyHost).unUse(this.#anchorName)
          if ('ok' in anchorRemoval && !anchorRemoval.ok)
            cleanupErrors.push(...anchorRemoval.errors)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      try {
        const result = (await this.#concrete.dispose()) as IPluginHostDisposalResult
        cleanupErrors.push(...result.cleanupErrors)
        if (result.physicalCompletion)
          physical.push(mergeCleanupResults([result.physicalCompletion]))
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      claims.delete(this.#concrete as object)
    }
    /** Classify first so a frozen factory failure remains reachable without masking it. */
    let primary = attachTrayError(error, TrayErrorCode.invalidEntry)
    const detail = Object.freeze({
      phase: this.#graph ? 'setup' : 'factory',
      cleanupComplete:
        this.#cleanup.complete && cleanupErrors.length === 0 && physical.length === 0,
      cleanupErrors: Object.freeze(cleanupErrors),
      ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
    })
    // Foreign immutable errors and pre-existing detail remain intact on the cause chain.
    if (!Object.isExtensible(primary) || Object.getOwnPropertyDescriptor(primary, 'detail'))
      primary = createTrayError(TrayErrorCode.invalidEntry, primary)
    Object.defineProperty(primary, 'detail', { value: detail, enumerable: true })
    throw primary
  }
}

/** Snapshots creation options before constructing any lifecycle state. */
function snapshotOptions<
  THost extends ITrayHostSource,
  TPlugins extends readonly ITrayPluginConstraint<THost>[]
>(options: ICreateHostOptions<THost, TPlugins>): ICreateHostOptions<THost, TPlugins> {
  if (options === null || typeof options !== 'object')
    throw createTrayError(TrayErrorCode.invalidEntry)
  const create = options.create
  const plugins = options.plugins
  const mutationAdmissionMs = options.mutationAdmissionMs
  const quiescenceMs = options.quiescenceMs
  const shutdown = options.shutdown
  if (
    typeof create !== 'function' ||
    !Array.isArray(plugins) ||
    !Number.isFinite(mutationAdmissionMs) ||
    mutationAdmissionMs < 0 ||
    !Number.isFinite(quiescenceMs) ||
    quiescenceMs < 0 ||
    !shutdown ||
    (shutdown.mode !== TrayShutdownMode.bounded &&
      shutdown.mode !== TrayShutdownMode['strict-drain'])
  )
    throw createTrayError(TrayErrorCode.invalidEntry)
  return Object.freeze({
    create,
    plugins: Object.freeze([...plugins]) as ICreateHostOptions<THost, TPlugins>['plugins'],
    mutationAdmissionMs,
    quiescenceMs,
    shutdown,
    report: options.report
  })
}

/** Converts one Tray descriptor into the sole Graph lifecycle node projection. */
function toGraphNode(admission: IAdmissionRecord): IDynamicGraphNodeDefinition<unknown> {
  const id = admission.snapshot.name as IGraphId
  return {
    id,
    kind: 'plugin',
    dependencies: admission.snapshot.dependencies.map(({ provider, required }) => ({
      provider: provider as IGraphId,
      required
    })),
    start: async () => {
      return {
        value: admission.plugin,
        release: async () => undefined
      }
    }
  }
}

/** One batch index records the earliest admission wave of each dependency-satisfied record. */
type IAdmissionLevels = {
  readonly levels: ReadonlyMap<IAdmissionRecord, number>
  readonly readyNames: ReadonlySet<string>
  readonly presentNames: ReadonlySet<string>
}

/** Resolve dependency edges once in O(records + dependencies), preserving duplicate-name readiness. */
function resolveAdmissionLevels(
  records: readonly IAdmissionRecord[],
  requiredOnly: boolean
): IAdmissionLevels {
  /** Presence is distinct from readiness; absent optional providers never delay admission. */
  const presentNames = new Set(records.map((record) => record.snapshot.name))
  /** Each provider name wakes its dependents once, even when several records share that name. */
  const dependents = new Map<string, IAdmissionRecord[]>()
  /** Pending counts include repeated edges, whose corresponding adjacency entries release them. */
  const pending = new Map<IAdmissionRecord, number>()
  /** A record's wave is one after its latest required present provider. */
  const levels = new Map<IAdmissionRecord, number>()
  /** Deferred wave candidates accumulate while the record still has unresolved dependencies. */
  const candidates = new Map<IAdmissionRecord, number>()
  /** Cursor processing preserves breadth-first provider waves without shift or re-sorting. */
  const queue: IAdmissionRecord[] = []
  /** Original name readiness is fulfilled by the first eligible record of that name. */
  const readyNames = new Set<string>()
  for (const record of records) {
    /** Missing required providers remain unresolved only in the initial-ready projection. */
    let count = 0
    for (const { provider, required } of record.snapshot.dependencies) {
      if (requiredOnly && !required) continue
      if (!presentNames.has(provider)) {
        if (requiredOnly) count++
        continue
      }
      count++
      /** One adjacency entry corresponds to one counted dependency edge. */
      const waiting = dependents.get(provider) ?? []
      waiting.push(record)
      dependents.set(provider, waiting)
    }
    pending.set(record, count)
    if (count === 0) {
      levels.set(record, 0)
      queue.push(record)
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    /** FIFO work guarantees that a name's first admitted record has its earliest wave. */
    const record = queue[cursor]!
    /** Later duplicate records do not announce the same provider a second time. */
    const name = record.snapshot.name
    if (readyNames.has(name)) continue
    readyNames.add(name)
    for (const dependent of dependents.get(name) ?? []) {
      /** All present providers of this record contribute to its final wave. */
      const nextLevel = Math.max(candidates.get(dependent) ?? 0, levels.get(record)! + 1)
      candidates.set(dependent, nextLevel)
      /** Release exactly this adjacency entry. */
      const remaining = pending.get(dependent)! - 1
      pending.set(dependent, remaining)
      if (remaining === 0) {
        levels.set(dependent, nextLevel)
        queue.push(dependent)
      }
    }
  }
  return { levels, readyNames, presentNames }
}

/** Preserve original per-wave input order with stable buckets instead of repeated global scans. */
function orderAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  /** Every present provider, including optional providers, precedes its consumers. */
  const { levels, presentNames } = resolveAdmissionLevels(records, false)
  /** At most one new wave per record, so bucket traversal is linear in record count. */
  const waves: IAdmissionRecord[][] = []
  /**
   * Cyclic remnants retain their original insertion order for the existing missing-provider
   * fallback.
   */
  const remaining: IAdmissionRecord[] = []
  for (const record of records) {
    /** A missing level identifies a record still blocked by a present dependency cycle. */
    const level = levels.get(record)
    if (level === undefined) remaining.push(record)
    else (waves[level] ??= []).push(record)
  }
  /** Flattening walks each record once and retains original ordering inside a wave. */
  const ordered = waves.flat()
  if (remaining.length > 0) {
    if (
      !remaining.some((record) =>
        record.snapshot.dependencies.some(
          ({ provider, required }) => required && !presentNames.has(provider)
        )
      )
    )
      throw createTrayError(TrayErrorCode.invalidEntry)
    ordered.push(...remaining)
  }
  return ordered
}

/** Select definitions whose complete required-provider closure is present, in original input order. */
function computeReadyAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  /** Optional dependencies do not block this initial-ready projection. */
  const { readyNames } = resolveAdmissionLevels(records, true)
  return records.filter((record) => readyNames.has(record.snapshot.name))
}

/** Immutable references lent to one managed session; each resource retains its canonical owner. */
type IManagedTrayHostContext = {
  readonly concrete: IAnyHost
  readonly graph: IGraph
  readonly options: ICreateHostOptions<IAnyHost, readonly IPluginBinding[]>
  readonly readSnapshot: () => IAnySnapshot
  readonly writeSnapshot: (snapshot: IAnySnapshot) => void
  readonly assertOwned: () => void
  readonly cleanup: ICleanupAccumulator
  readonly anchorName: string
  readonly readExpectedRevision: () => number
  readonly activeRuntimeNames: ReadonlyMap<string, number>
  readonly waitForRuntimeQuiescence: () => Promise<void>
}

/** One managed Host owns publication state, mutation admission and its cached disposal receipt. */
class ManagedTrayHost {
  /** References point to the same concrete Host, Graph and startup session. */
  #context: IManagedTrayHostContext
  /** The original concrete Host alone owns plugin installation and data slots. */
  #composition: IPluginHostCompositionIntegration<object>
  /** Managed mutation admission stops synchronously when disposal starts. */
  #state: ITrayHostState = TrayHostState.active
  /** Terminal failure remains available without replacing its identity. */
  #terminalError: unknown
  /** Reentrant disposal observers receive this exact shared promise. */
  #disposal: Promise<ITrayHostDisposalResult> | undefined
  /** Reads fail closed while Host and Graph generations converge. */
  #publicationPending = false
  /** One event hub publishes settled mutation and disposal outcomes. */
  #hub: ReturnType<typeof createEventHub<ITrayHostEventMap>>

  /** Borrow canonical owners after startup has acquired its sole managed claim. */
  constructor(context: IManagedTrayHostContext) {
    this.#context = context
    this.#composition = openComposition(context.concrete as object)
    this.#hub = createEventHub<ITrayHostEventMap>({
      report: ({ error }) => {
        try {
          context.options.report?.(error)
        } catch {
          /* Reporting cannot alter a settled mutation. */
        }
      }
    })
  }

  /** Read the currently owned graph names only after publication converges. */
  get plugins() {
    this.#assertReadable()
    return Object.freeze([...this.#context.graph.nodes].map(String))
  }
  /** Project only graph nodes in the canonical ready state. */
  get readyPlugins() {
    this.#assertReadable()
    return Object.freeze(
      [...this.#context.graph.nodes]
        .filter((id) => this.#context.graph.nodeState(id).state === CapabilityGraphNodeState.ready)
        .map(String)
    )
  }
  /** Expose managed admission state without granting mutation authority. */
  get state() {
    return this.#state
  }
  /** Report whether managed mutations may still be admitted. */
  get isActive() {
    return this.#state === TrayHostState.active
  }
  /** Retain the original terminal failure for diagnostic callers. */
  get error() {
    return this.#terminalError
  }
  /** Expose extensions from the exact current composition snapshot. */
  get extensions() {
    this.#assertReadable()
    return this.#context.readSnapshot().extensions
  }
  /** Lend the current config projection while publishing its next composition revision after writes. */
  get config() {
    this.#assertReadable()
    const config = this.#context.readSnapshot().config
    return {
      get: (path: string) => config.get(path),
      update: async (
        name: string,
        recipe: (previous: Readonly<Record<string, unknown>>) => Record<string, unknown>
      ) => {
        await config.update(name, recipe as never)
        this.#context.writeSnapshot(this.#context.readSnapshot())
      }
    }
  }
  /** Map canonical graph state to the existing absent-node blocked result. */
  pluginState = (name: string) => {
    this.#assertReadable()
    try {
      return this.#context.graph.nodeState(name as IGraphId).state
    } catch {
      return CapabilityGraphNodeState.blocked
    }
  }
  /** Subscribe through the one managed event hub, preserving listener settlement. */
  on = <TKey extends keyof ITrayHostEventMap>(
    type: TKey,
    listener: (event: IEventContext<ITrayHostEventMap[TKey]>) => void | PromiseLike<void>
  ): IUnsubscribe => {
    return this.#hub.subscribe(type, listener as never)
  }
  /** Register one canonical admission and publish only its settled graph outcome. */
  use = async (
    plugin: IPluginBinding
  ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    /** Validate and capture before entering the graph mutation result channel. */
    const { snapshot, admission } = admitTrayPlugin(plugin, this.#composition)
    const name = snapshot.name
    const existedBefore = this.#context.graph.nodes.some((id) => String(id) === name)
    let candidate: IAdmissionRecord | undefined
    try {
      this.#resetCleanup()
      candidate = this.#createAdmissionRecord(plugin, snapshot, admission)
      this.#publicationPending = true
      const result = await this.#context.graph.register(toGraphNode(candidate), candidate)
      this.#publicationPending = false
      const output = mutationResult(
        'use',
        name,
        result.affected.map(String),
        result.topologyChanged,
        this,
        this.#context.cleanup
      )
      this.#hub.publish('use', output as never)
      this.#hub.publish('registered', output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      const committed =
        candidate !== undefined &&
        !existedBefore &&
        this.#context.graph.getBinding(name as IGraphId) === candidate
      if (candidate && !committed) {
        this.#composition!.retireDataOrderSlot(candidate.slot)
        await candidate.artifactCustody?.rollback()
      }
      const failure = mutationFailure('use', name, error, this, committed)
      this.#hub.publish('mutationFailed', {
        operation: 'use',
        name,
        error: failure.error
      })
      return failure
    }
  }
  /** Remove one exact generation after enforcing Runtime reentrancy and ownership fences. */
  unUse = async (name: string): Promise<ITrayPluginRemovalResult<unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    const runtimeBridge = readRuntimeBridge(this)
    try {
      runtimeBridge?.assertMutationAllowed?.(name)
    } catch (error) {
      const failure = removalFailure(name, error, this)
      this.#hub.publish('mutationFailed', { operation: 'unUse', name, error: failure.error })
      return failure
    }
    if (!this.#context.graph.nodes.some((id) => String(id) === name))
      return removalMissing(name, this)
    const target = this.#context.graph.getBinding<IAdmissionRecord>(name as IGraphId)
    try {
      this.#resetCleanup()
      this.#publicationPending = true
      const result = await this.#context.graph.remove(name as IGraphId)
      this.#publicationPending = false
      if (target) this.#composition!.retireDataOrderSlot(target.slot)
      const output = removalResult(name, result.affected.map(String), this, this.#context.cleanup)
      this.#hub.publish('unUse', output as never)
      this.#hub.publish('removed', output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      const committed = !this.#context.graph.nodes.some((id) => String(id) === name)
      const failure = removalFailure(name, error, this, committed)
      this.#hub.publish('mutationFailed', { operation: 'unUse', name, error: failure.error })
      return failure
    }
  }
  /** Replace a captured admission without weakening the existing generation on admission failure. */
  replace = async (
    plugin: IPluginBinding
  ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    /** Invalid replacements reject while their existing generation still serves. */
    const { snapshot, admission } = admitTrayPlugin(plugin, this.#composition)
    const name = snapshot.name
    const runtimeBridge = readRuntimeBridge(this)
    try {
      runtimeBridge?.assertMutationAllowed?.(name)
    } catch (error) {
      const failure = mutationFailure('replace', name, error, this)
      this.#hub.publish('mutationFailed', { operation: 'replace', name, error: failure.error })
      return failure
    }
    const previous = this.#context.graph.getBinding<IAdmissionRecord>(name as IGraphId)
    let candidate: IAdmissionRecord | undefined
    try {
      this.#resetCleanup()
      candidate = this.#createAdmissionRecord(plugin, snapshot, admission, previous?.slot)
      this.#publicationPending = true
      const result = await this.#context.graph.replace(toGraphNode(candidate), candidate)
      this.#publicationPending = false
      const output = mutationResult(
        'replace',
        name,
        result.affected.map(String),
        result.topologyChanged,
        this,
        this.#context.cleanup
      )
      this.#hub.publish('replace', output as never)
      this.#hub.publish('replaced', output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      const committed =
        candidate !== undefined && this.#context.graph.getBinding(name as IGraphId) === candidate
      const failure = mutationFailure('replace', name, error, this, committed)
      this.#hub.publish('mutationFailed', {
        operation: 'replace',
        name,
        error: failure.error
      })
      return failure
    }
  }
  /** Publish one disposal receipt before any reentrant observer can request disposal again. */
  dispose = (): Promise<ITrayHostDisposalResult> => {
    if (this.#disposal) return this.#disposal
    this.#state = TrayHostState.closing
    // Publish completion identity before invoking any reentrant disposing observer.
    this.#disposal = Promise.resolve().then(this.#disposeOnce)
    this.#hub.publish('disposing', { state: 'closing' })
    return this.#disposal
  };
  /** Join the same canonical disposal receipt for asynchronous using. */
  [asyncDisposeKey] = () => {
    return this.dispose().then(() => undefined)
  }
  /** Reject mutations after terminal admission has begun. */
  #assertActive(): void {
    if (this.#state !== TrayHostState.active) throw createTrayError(TrayErrorCode.unavailable)
  }

  /** Rejects observations that could otherwise combine different Host and Graph generations. */
  #assertReadable(): void {
    if (this.#publicationPending) throw createTrayError(TrayErrorCode.unavailable)
    this.#context.assertOwned()
  }

  /** Resets one transaction's cleanup observation before Graph reconciliation starts. */
  #resetCleanup(): void {
    this.#context.cleanup.errors = []
    this.#context.cleanup.complete = true
    this.#context.cleanup.physical = []
  }

  /** Captures one managed descriptor and its Host-owned admission handles. */
  #createAdmissionRecord(
    plugin: IPluginBinding,
    snapshot: IPluginSnapshot,
    admission: IPluginAdmission<IPluginConstraint<any>>,
    slot?: IPluginDataOrderSlot
  ): IAdmissionRecord {
    const record = {
      plugin,
      snapshot,
      admission,
      slot: slot ?? this.#composition!.createDataOrderSlot(snapshot.name),
      artifactCustody: claimArtifactCustody(plugin as object)
    }
    return record
  }
  /** Dispose graph and concrete resources while retaining primary cleanup ordering. */
  #disposeOnce = async (): Promise<ITrayHostDisposalResult> => {
    const cleanupErrors: unknown[] = []
    const physical: Promise<ITrayPluginPhysicalCleanupResult>[] = []
    try {
      this.#resetCleanup()
      const externallyMutated = this.#composition!.revision !== this.#context.readExpectedRevision()
      if (externallyMutated) {
        await this.#context.graph.dispose()
        cleanupErrors.push(...this.#context.cleanup.errors)
        physical.push(...this.#context.cleanup.physical)
        if (await this.#deferConcreteDisposal(physical)) {
          this.#state = TrayHostState.terminal
          claims.delete(this.#context.concrete as object)
          this.#hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
          return {
            state: 'terminal' as const,
            termination: 'external-host' as const,
            cleanupComplete: false,
            cleanupErrors: Object.freeze(cleanupErrors),
            physicalCompletion: mergeCleanupResults(physical)
          }
        }
        const externalResult = (await this.#context.concrete.dispose()) as IPluginHostDisposalResult
        cleanupErrors.push(...externalResult.cleanupErrors)
        if (externalResult.physicalCompletion)
          physical.push(mergeCleanupResults([externalResult.physicalCompletion]))
        this.#state = TrayHostState.terminal
        claims.delete(this.#context.concrete as object)
        const cleanupComplete =
          this.#context.cleanup.complete && externalResult.cleanupComplete && physical.length === 0
        this.#hub.publish('disposed', {
          state: 'terminal',
          cleanupComplete
        })
        return {
          state: 'terminal' as const,
          termination: 'external-host' as const,
          cleanupComplete,
          cleanupErrors: Object.freeze(cleanupErrors),
          ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
        }
      }
      await this.#context.graph.dispose()
      cleanupErrors.push(...this.#context.cleanup.errors)
      physical.push(...this.#context.cleanup.physical)
      const anchorRemoval = await this.#context.concrete.unUse(this.#context.anchorName)
      if ('ok' in anchorRemoval && !anchorRemoval.ok) cleanupErrors.push(...anchorRemoval.errors)
      if (await this.#deferConcreteDisposal(physical)) {
        this.#state = TrayHostState.terminal
        claims.delete(this.#context.concrete as object)
        this.#hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
        return {
          state: 'terminal' as const,
          termination: 'managed' as const,
          cleanupComplete: false,
          cleanupErrors: Object.freeze(cleanupErrors),
          physicalCompletion: mergeCleanupResults(physical)
        }
      }
      const result = (await this.#context.concrete.dispose()) as IPluginHostDisposalResult
      cleanupErrors.push(...result.cleanupErrors)
      if (result.physicalCompletion) physical.push(mergeCleanupResults([result.physicalCompletion]))
      const cleanupComplete =
        this.#context.cleanup.complete && result.cleanupComplete && physical.length === 0
      this.#state = TrayHostState.terminal
      claims.delete(this.#context.concrete as object)
      this.#hub.publish('disposed', {
        state: 'terminal',
        cleanupComplete
      })
      return {
        state: 'terminal' as const,
        termination: 'managed' as const,
        cleanupComplete,
        cleanupErrors: Object.freeze(cleanupErrors),
        ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
      }
    } catch (error) {
      this.#state = TrayHostState.failed
      this.#terminalError = error
      this.#hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
      return {
        state: 'terminal' as const,
        termination: 'managed' as const,
        cleanupComplete: false,
        cleanupErrors: Object.freeze([error]),
        error: error instanceof Error ? error : undefined
      }
    }
  }
  /** Defers concrete Host disposal so active Runtime callbacks retain physical custody. */
  #deferConcreteDisposal = async (
    physical: Promise<ITrayPluginPhysicalCleanupResult>[]
  ): Promise<boolean> => {
    if (this.#context.activeRuntimeNames.size === 0) return false
    const runtimeFence = this.#context.waitForRuntimeQuiescence()
    const bounded = await settleWithin(runtimeFence, this.#context.options.quiescenceMs)
    if (bounded.complete) return false
    this.#context.cleanup.complete = false
    const delayed = runtimeFence.then(
      () => this.#context.concrete!.dispose() as Promise<IPluginHostDisposalResult>
    )
    physical.push(mergeCleanupResults([delayed]))
    return true
  }
}

/** Tray stores only the graph projection of the PluginHost-owned admission. */
type IPluginSnapshot = Readonly<{
  readonly name: string
  readonly dependencies: readonly IPluginDependency[]
}>

/** Rejects stale descriptors, captures one admission and preserves producer errors on cause. */
function admitTrayPlugin(
  plugin: IPluginBinding,
  composition: IPluginHostCompositionIntegration<object>
): Readonly<{
  readonly snapshot: IPluginSnapshot
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
}> {
  if (plugin !== null && plugin !== undefined && Object.hasOwn(plugin, 'requires'))
    throw createTrayError(TrayErrorCode.invalidEntry)
  try {
    /** PluginHost validates the name and install field while capturing Feature getters once. */
    const admission = composition.createPluginAdmission<IPluginConstraint<any>>(plugin)
    /** The reader inspects that exact snapshot without touching the descriptor again. */
    const dependencies = readPluginDependencies(admission)
    return { admission, snapshot: Object.freeze({ name: plugin.name, dependencies }) }
  } catch (original) {
    throw createTrayError(TrayErrorCode.invalidEntry, original)
  }
}

/** Creates a successful settled mutation observation. */
function mutationResult(
  operation: 'use' | 'replace',
  name: string,
  affected: readonly string[],
  topologyChanged: boolean,
  view: unknown,
  cleanup: ICleanupAccumulator
): any {
  return Object.freeze({
    ok: true,
    committed: true,
    operation,
    name,
    affected: Object.freeze([...affected]),
    topologyChanged,
    view,
    cleanupComplete: cleanup.complete,
    cleanupErrors: Object.freeze([...cleanup.errors]),
    ...(cleanup.physical.length > 0
      ? { physicalCompletion: mergeCleanupResults(cleanup.physical) }
      : {})
  })
}

/** Creates a pre-commit mutation failure while retaining the prior view. */
function mutationFailure(
  operation: 'use' | 'replace',
  name: string,
  error: unknown,
  view: unknown,
  committed = false
): any {
  return Object.freeze({
    ok: false,
    committed,
    operation,
    name,
    affected: Object.freeze([name]),
    topologyChanged: false,
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([]),
    error: error instanceof Error ? error : createTrayError(TrayErrorCode.invalidEntry, error)
  })
}

/** Creates a successful committed removal observation. */
function removalResult(
  name: string,
  affected: readonly string[],
  view: unknown,
  cleanup: ICleanupAccumulator
): any {
  return Object.freeze({
    ok: true,
    committed: true,
    removed: true,
    name,
    affected: Object.freeze([...affected]),
    view,
    cleanupComplete: cleanup.complete,
    cleanupErrors: Object.freeze([...cleanup.errors]),
    ...(cleanup.physical.length > 0
      ? { physicalCompletion: mergeCleanupResults(cleanup.physical) }
      : {})
  })
}

/** Creates the no-op result for a name absent from the managed definition graph. */
function removalMissing(name: string, view: unknown): any {
  return Object.freeze({
    ok: true,
    committed: false,
    removed: false,
    name,
    affected: Object.freeze([]),
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([])
  })
}

/** Creates a failed removal observation without claiming a commit. */
function removalFailure(name: string, error: unknown, view: unknown, committed = false): any {
  return Object.freeze({
    ok: false,
    committed,
    removed: committed,
    name,
    affected: Object.freeze([name]),
    view,
    cleanupComplete: true,
    cleanupErrors: Object.freeze([]),
    error: error instanceof Error ? error : createTrayError(TrayErrorCode.invalidEntry, error)
  })
}

/** Bounds Tray's logical wait while preserving the original physical cleanup promise. */
function settleWithin<T>(
  value: Promise<T>,
  budgetMs: number
): Promise<{ readonly complete: true; readonly value: T } | { readonly complete: false }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = scheduleTimer(() => {
      if (settled) return
      settled = true
      resolve({ complete: false })
    }, budgetMs)
    value.then(
      (result) => {
        if (settled) return
        settled = true
        cancelTimer(timer)
        resolve({ complete: true, value: result })
      },
      (error) => {
        if (settled) return
        settled = true
        cancelTimer(timer)
        reject(error)
      }
    )
  })
}

/** Reads the host timer capability without coupling Tray's declarations to DOM or Node libs. */
function scheduleTimer(callback: () => void, delayMs: number): unknown {
  const timerHost = globalThis as unknown as {
    readonly setTimeout?: (handler: () => void, timeout: number) => unknown
  }
  return timerHost.setTimeout ? timerHost.setTimeout(callback, delayMs) : undefined
}

/** Cancels a timer returned by the host platform when one is available. */
function cancelTimer(timer: unknown): void {
  const timerHost = globalThis as unknown as {
    readonly clearTimeout?: (handle: unknown) => void
  }
  if (timer !== undefined) timerHost.clearTimeout?.(timer)
}
