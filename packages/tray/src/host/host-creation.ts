/**
 * Owns one managed Host creation session, its composition/Graph bridge and failed-start rollback.
 * Admission algorithms and managed mutation publication retain their separate module owners.
 */
import { TrayShutdownMode } from '../state-constants.ts'
import { mergeCleanupResults } from '@migaia/lifecycle'
import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraphOptions
} from '@migaia/capability/graph/dynamic'
import { type IPluginConstraint, type IPluginHostDisposalResult } from '@migaia/plugin-host'
import { TrayErrorCode } from '../error-code.ts'
import { attachTrayError, createTrayError } from '../errors.ts'
import type {
  ICreateHostOptions,
  ITrayHostSource,
  ITrayPluginConstraint,
  ITrayPluginPhysicalCleanupResult,
  ITrayResolvedHost
} from './typing.ts'
import { registerRuntimeBridge } from './internal-capability.ts'
import {
  createView as createRegistrationView,
  isManagedHost,
  openComposition,
  type IPluginHostCompositionIntegration,
  type IRegistrationToken
} from '@migaia/plugin-host/composition'
import { ManagedTrayHost } from './managed-host.ts'
import {
  admitTrayPlugin,
  computeReadyAdmissions,
  orderAdmissions,
  releaseGraphValue,
  toGraphNode
} from './admission.ts'
import { LogicalCleanupWait } from './cleanup-wait.ts'
import { claims, createAnchorName } from './host-claims.ts'
import { HostCreationDetailKey, HostCreationPhase } from './constants.ts'
import type {
  IAdmissionRecord,
  IAnyHost,
  IAnySnapshot,
  ICleanupAccumulator,
  IGraph,
  IGraphId,
  IPluginBinding
} from './host-context.ts'

/** Adjust one name's nesting count; missing/last releases erase membership just as before. */
function changeNameCount(names: Map<string, number>, name: string, delta: 1 | -1): void {
  /** Zero membership, rather than a zero-valued entry, determines mutation/quiescence admission. */
  const count = (names.get(name) ?? 0) + delta
  if (count <= 0) names.delete(name)
  else names.set(name, count)
}

/** One creation attempt owns its claim, graph startup, publication receipt and rollback context. */
export class HostCreation<
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
    this.#anchorName = createAnchorName()
    /** The private anchor establishes the concrete Host baseline before plugin admission. */
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
    /** Original registration-order admissions retain canonical dependency snapshots and data slots. */
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
    /** Provider-first ordering is computed once before initial composition installation. */
    const orderedAdmissions = orderAdmissions(admissions)
    /** Only definitions whose required providers are ready enter the initial installation. */
    const initialAdmissions = computeReadyAdmissions(orderedAdmissions)
    /** The canonical composition owns this prepared transaction until commit or discard. */
    const prepared = await this.#composition!.prepareAdmissions(
      initialAdmissions.map(({ admission, slot }) => ({ admission, slot }))
    )
    /** Committed tokens are paired with the original ready admissions by their array position. */
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
    /** A single pass selects uninstalled bindings without intermediate mapped/filter arrays. */
    const missing: IAdmissionRecord[] = []
    for (const entry of entries) {
      /** Read the Graph-owned binding once, as in the original admission projection. */
      const record = entry.binding
      if (record !== undefined && !this.#receiptsByName.has(record.snapshot.name))
        missing.push(record)
    }
    if (missing.length > 0) {
      /** The canonical composition owns this prepared transaction until commit or discard. */
      const prepared = await this.#composition!.prepareAdmissions(
        missing.map(({ admission, slot }) => ({ admission, slot }))
      )
      /** Successful commit publishes exact registration tokens for this new frontier only. */
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
    /** Each result retains the original binding read, order and release function identity. */
    const started: { value: IPluginBinding; release: typeof releaseGraphValue }[] = []
    for (const entry of entries) {
      /** The Graph supplies a bound admission for every frontier result. */
      const record = entry.binding
      if (!record) throw createTrayError(TrayErrorCode.invalidEntry)
      started.push({ value: record.plugin, release: releaseGraphValue })
    }
    return started
  }
  /** Release graph frontiers in reverse dependency order with the original quiescence budget. */
  #releaseBatch: IDynamicCapabilityGraphOptions<IAdmissionRecord>['releaseBatch'] = async (
    entries,
    fence
  ) => {
    /** Graph release frontiers are consumed in reverse dependency order. */
    const cleanupOrder = [...entries].reverse()
    /** Exact registration receipts prevent removing a replacement generation by name. */
    const currentReceipts = cleanupOrder.map((entry) => {
      /** Prefer the binding token; the name index retains the existing fallback identity. */
      const receipt = entry.binding?.receipt ?? this.#receiptsByName.get(String(entry.id))
      if (!receipt) throw createTrayError(TrayErrorCode.hostMutationBypass)
      return receipt
    })
    /** One canonical batch removal retains cleanup ordering and its physical receipt. */
    const removalPromise = this.#composition!.commitPreparedUnUseBatch(
      this.#composition!.prepareUnUseBatch(currentReceipts),
      { beforeCleanup: fence }
    )
    /** Logical deadline observation never cancels or replaces the physical cleanup Promise. */
    const bounded =
      this.#captured.shutdown.mode === TrayShutdownMode['strict-drain']
        ? { complete: true as const, value: await removalPromise }
        : await new LogicalCleanupWait(removalPromise, this.#captured.quiescenceMs).promise
    if (!bounded.complete) {
      this.#cleanup.complete = false
      this.#cleanup.physical.push(mergeCleanupResults([removalPromise]))
      this.#hostSnapshot = this.#composition!.getCurrentSnapshot()
      this.#revision = this.#composition!.revision
      for (const entry of cleanupOrder) this.#receiptsByName.delete(String(entry.id))
      return
    }
    /** A winning physical removal supplies the snapshot and immediate cleanup observations. */
    const removal = bounded.value
    this.#hostSnapshot = removal.snapshot as IAnySnapshot
    this.#revision = this.#composition!.revision
    this.#cleanup.errors.push(...removal.cleanupErrors)
    this.#cleanup.complete = this.#cleanup.complete && removal.cleanupComplete
    if (removal.physicalCompletion) {
      if (this.#captured.shutdown.mode === TrayShutdownMode['strict-drain']) {
        /** Strict drain joins physical cleanup before publishing its accumulated errors. */
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
        /** Active Runtime generations retain artifact custody until their original fence settles. */
        const deferred = this.#waitForRuntimeQuiescence().then(async () => {
          /**
           * Errors raised by this binding's deferred rollback only. `cleanup.errors` is shared by
           * the whole removal, so returning it would repeat other bindings' errors here.
           */
          const bindingErrors: unknown[] = []
          try {
            await entry.binding?.artifactCustody?.rollback()
          } catch (error) {
            /** The contained cleanup error retains its original identity or cause and is reported. */
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
        /** The contained cleanup error retains its original identity or cause and is reported. */
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
        /** Acquire the exact ready Graph generation before publishing its narrow extension view. */
        const lease = this.#graph!.acquireBinding(name as IGraphId)
        /** Retain the exact canonical admission or generation selected by this operation. */
        const record = lease.value
        if (!record.receipt) {
          lease.release()
          throw createTrayError(TrayErrorCode.unavailable)
        }
        /** Only this registration token contributes extensions to the Runtime lease. */
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
    /** Immediate cleanup errors retain their original order independently of late work. */
    const cleanupErrors: unknown[] = [...this.#cleanup.errors]
    /** Physical cleanup receipts remain observable after a bounded logical result. */
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
          /** Remove only the private anchor acquired by this managed creation session. */
          const anchorRemoval = await (this.#concrete as IAnyHost).unUse(this.#anchorName)
          if ('ok' in anchorRemoval && !anchorRemoval.ok)
            cleanupErrors.push(...anchorRemoval.errors)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      try {
        /** The canonical owner settles this operation before its observation is published. */
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
    /** The original failure detail distinguishes immediate errors from physical completion. */
    const detail = Object.freeze({
      phase: this.#graph ? HostCreationPhase.setup : HostCreationPhase.factory,
      cleanupComplete:
        this.#cleanup.complete && cleanupErrors.length === 0 && physical.length === 0,
      cleanupErrors: Object.freeze(cleanupErrors),
      ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
    })
    // Foreign immutable errors and pre-existing detail remain intact on the cause chain.
    if (
      !Object.isExtensible(primary) ||
      Object.getOwnPropertyDescriptor(primary, HostCreationDetailKey)
    )
      primary = createTrayError(TrayErrorCode.invalidEntry, primary)
    Object.defineProperty(primary, HostCreationDetailKey, { value: detail, enumerable: true })
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
  /** Read the concrete Host factory once before constructing any resource. */
  const create = options.create
  /** Capture the original plugin array once before making its immutable admission snapshot. */
  const plugins = options.plugins
  /** Capture the required mutation queue wait budget before validation. */
  const mutationAdmissionMs = options.mutationAdmissionMs
  /** Capture the explicit bounded physical-cleanup wait budget before validation. */
  const quiescenceMs = options.quiescenceMs
  /** Capture the caller-owned shutdown policy without changing its observable identity. */
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
