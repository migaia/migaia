import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraph
} from '@migaia/capability/graph/dynamic'
import type { IGraphNodeDefinition, IGraphNodeId } from '@migaia/capability/graph'
import { createEventHub } from '@migaia/event-subscriber'
import type { IEventContext } from '@migaia/event-subscriber'
import {
  PluginHost,
  asyncDisposeKey,
  type IPluginConstraint,
  type IPluginAdmission,
  type IPluginDataOrderSlot,
  type IPluginRegistrationReceipt,
  type IPluginHostCompositionIntegration,
  type IPluginHostDisposalResult,
  type IPluginHostView
} from '@migaia/plugin-host'
import { TrayErrorCode } from '../error-code.js'
import { attachTrayError, createTrayError } from '../errors.js'
import {
  TrayHostState,
  type ICreateHostOptions,
  type ITrayHost,
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
import { createView as createRegistrationView } from '@migaia/plugin-host/composition'

type IAnyHost = PluginHost<any, any, any> &
  IPluginHostCompositionIntegration<PluginHost<any, any, any>>
type IAnyView = IPluginHostView<IAnyHost, readonly IPluginConstraint<any>[]>
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
  receipt?: IPluginRegistrationReceipt
  artifactCustody?: ITrayArtifactCustody
}
type IGraph = IDynamicCapabilityGraph<IAdmissionRecord>

/** The module-local claim records the sole managed session for each concrete Host. */
const claims = new WeakMap<object, object>()
/** Monotonic private anchor sequence; anchors never enter the managed Graph namespace. */
let anchorSequence = 0

/** Creates one Tray-owned managed Host and resolves only after its graph is active. */
export async function createHost<
  THost extends PluginHost<any, any, any>,
  const TPlugins extends readonly ITrayPluginConstraint<THost>[]
>(options: ICreateHostOptions<THost, TPlugins>): Promise<ITrayResolvedHost<THost, TPlugins>> {
  const captured = snapshotOptions(options)
  let concrete: THost | undefined
  let graph: IGraph | undefined
  let session: object | undefined
  let anchorName: string | undefined
  const cleanup: ICleanupAccumulator = { errors: [], complete: true, physical: [] }
  /** Counts active Runtime callbacks by plugin name to fence same-run mutation. */
  const activeRuntimeNames = new Map<string, number>()
  /** Tracks only the synchronous callback turn for unsupported raw-Host mutation rejection. */
  const callbackRuntimeNames = new Map<string, number>()
  /** Resolves deferred physical cleanup when all Runtime generation leases are released. */
  const runtimeQuiescenceWaiters = new Set<() => void>()
  const waitForRuntimeQuiescence = (): Promise<void> => {
    if (activeRuntimeNames.size === 0) return Promise.resolve()
    return new Promise((resolve) => runtimeQuiescenceWaiters.add(resolve))
  }
  const notifyRuntimeQuiescence = (): void => {
    if (activeRuntimeNames.size !== 0) return
    for (const resolve of runtimeQuiescenceWaiters) resolve()
    runtimeQuiescenceWaiters.clear()
  }
  try {
    concrete = captured.create()
    if (!(concrete instanceof PluginHost) || claims.has(concrete as object))
      throw createTrayError(TrayErrorCode.invalidEntry)
    session = {}
    claims.set(concrete as object, session)
    const baselineView = (await concrete.use()) as unknown as IAnyView
    anchorName = `__migaia_tray_anchor_${anchorSequence++}`
    const anchor = {
      name: anchorName,
      install: () => ({})
    }
    let hostView = (await baselineView.use(anchor as never)) as unknown as IAnyView
    let receipt = (concrete as IAnyHost).revision
    const report = (error: unknown): void => {
      try {
        captured.report?.(error)
      } catch {
        // Reporter failures never alter managed state.
      }
    }
    const admissions = captured.plugins.map((plugin) => {
      const snapshot = snapshotTrayPlugin(plugin as unknown as IPluginBinding)
      return {
        plugin: plugin as unknown as IPluginBinding,
        snapshot,
        admission: concrete!.createPluginAdmission<IPluginConstraint<any>>(
          plugin as IPluginConstraint<any>
        ),
        slot: concrete!.createDataOrderSlot(snapshot.name)
      }
    })
    const orderedAdmissions = orderAdmissions(admissions)
    const initialAdmissions = computeReadyAdmissions(orderedAdmissions)
    const prepared = await concrete.prepareAdmissions(
      initialAdmissions.map(({ admission, slot }) => ({ admission, slot }))
    )
    let receipts: readonly IPluginRegistrationReceipt[]
    try {
      receipts = concrete.commitPreparedAdmissions(prepared)
    } catch (error) {
      await concrete.discardPreparedAdmissions(prepared)
      throw error
    }
    hostView = concrete.getCurrentView() as unknown as IAnyView
    receipt = concrete.revision
    initialAdmissions.forEach((entry, index) => {
      entry.receipt = receipts[index]
    })
    const receiptsByName = new Map(
      initialAdmissions.map((entry) => [entry.snapshot.name, entry.receipt!] as const)
    )
    graph = createDynamicCapabilityGraph<IAdmissionRecord>({
      report,
      mutationAdmissionMs: captured.mutationAdmissionMs,
      startBatch: async (entries) => {
        const missing: IAdmissionRecord[] = entries
          .map((entry) => entry.binding)
          .filter((entry): entry is IAdmissionRecord => entry !== undefined)
          .filter((entry) => !receiptsByName.has(entry.snapshot.name))
        if (missing.length > 0) {
          const prepared = await concrete!.prepareAdmissions(
            missing.map(({ admission, slot }) => ({ admission, slot }))
          )
          let nextReceipts: readonly IPluginRegistrationReceipt[]
          try {
            nextReceipts = concrete!.commitPreparedAdmissions(prepared)
          } catch (error) {
            await concrete!.discardPreparedAdmissions(prepared)
            throw error
          }
          missing.forEach((entry, index) => {
            entry.receipt = nextReceipts[index]
            receiptsByName.set(entry.snapshot.name, nextReceipts[index])
          })
          hostView = concrete!.getCurrentView() as unknown as IAnyView
          receipt = concrete!.revision
        }
        return entries.map((entry) => {
          const record = entry.binding
          if (!record) throw createTrayError(TrayErrorCode.invalidEntry)
          return { value: record.plugin, release: async () => undefined }
        })
      },
      releaseBatch: async (entries, fence) => {
        const cleanupOrder = [...entries].reverse()
        const currentReceipts = cleanupOrder.map((entry) => {
          const receipt = entry.binding?.receipt ?? receiptsByName.get(String(entry.id))
          if (!receipt) throw createTrayError(TrayErrorCode.hostMutationBypass)
          return receipt
        })
        const removalPromise = concrete!.commitPreparedUnUseBatch(
          concrete!.prepareUnUseBatch(currentReceipts),
          { beforeCleanup: fence }
        )
        const bounded =
          captured.shutdown.mode === 'strict-drain'
            ? { complete: true as const, value: await removalPromise }
            : await settleWithin(removalPromise, captured.quiescenceMs)
        if (!bounded.complete) {
          cleanup.complete = false
          cleanup.physical.push(observePhysical(removalPromise))
          hostView = concrete!.getCurrentView() as unknown as IAnyView
          receipt = concrete!.revision
          for (const entry of cleanupOrder) receiptsByName.delete(String(entry.id))
          return
        }
        const removal = bounded.value
        hostView = removal.view as unknown as IAnyView
        receipt = concrete!.revision
        cleanup.errors.push(...removal.cleanupErrors)
        cleanup.complete = cleanup.complete && removal.cleanupComplete
        if (removal.physicalCompletion) {
          if (captured.shutdown.mode === 'strict-drain') {
            const physicalResult = await removal.physicalCompletion
            cleanup.errors.push(...physicalResult.cleanupErrors)
            cleanup.complete = cleanup.complete && physicalResult.cleanupErrors.length === 0
          } else cleanup.physical.push(removal.physicalCompletion)
        }
        for (const entry of cleanupOrder) receiptsByName.delete(String(entry.id))
      },
      releaseBinding: async (entry) => {
        if (activeRuntimeNames.has(entry.binding?.snapshot.name ?? '')) {
          cleanup.complete = false
          const deferred = waitForRuntimeQuiescence().then(async () => {
            try {
              await entry.binding?.artifactCustody?.rollback()
            } catch (error) {
              const cleanupError = attachTrayError(error, TrayErrorCode.artifactCleanupFailed)
              cleanup.errors.push(cleanupError)
              cleanup.complete = false
              report(cleanupError)
            }
            return Object.freeze({ cleanupErrors: Object.freeze([...cleanup.errors]) })
          })
          cleanup.physical.push(deferred)
          return
        }
        try {
          await entry.binding.artifactCustody?.rollback()
        } catch (error) {
          const cleanupError = attachTrayError(error, TrayErrorCode.artifactCleanupFailed)
          cleanup.errors.push(cleanupError)
          cleanup.complete = false
          report(cleanupError)
        }
      }
    })
    const managed = createManagedHost(
      concrete,
      graph,
      captured as unknown as ICreateHostOptions<IAnyHost, readonly IPluginBinding[]>,
      () => hostView,
      (next) => {
        hostView = next
        receipt = (concrete as IAnyHost).revision
      },
      () => {
        if ((concrete as IAnyHost).revision !== receipt)
          throw createTrayError(TrayErrorCode.hostMutationBypass)
      },
      session,
      cleanup,
      anchorName,
      () => receipt,
      activeRuntimeNames,
      waitForRuntimeQuiescence
    )
    for (const admission of admissions) {
      const node = toGraphNode(admission)
      await graph.register(node, admission)
    }
    await graph.ready()
    registerRuntimeBridge(managed as object, {
      acquire: (name) => {
        const lease = graph!.acquireBinding(name as IGraphId)
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
        activeRuntimeNames.set(name, (activeRuntimeNames.get(name) ?? 0) + 1)
      },
      endRun: (name) => {
        const count = activeRuntimeNames.get(name) ?? 0
        if (count <= 1) activeRuntimeNames.delete(name)
        else activeRuntimeNames.set(name, count - 1)
        notifyRuntimeQuiescence()
      },
      enterCallback: (name) => {
        callbackRuntimeNames.set(name, (callbackRuntimeNames.get(name) ?? 0) + 1)
      },
      exitCallback: (name) => {
        const count = callbackRuntimeNames.get(name) ?? 0
        if (count <= 1) callbackRuntimeNames.delete(name)
        else callbackRuntimeNames.set(name, count - 1)
      },
      assertMutationAllowed: (name) => {
        if (callbackRuntimeNames.has(name)) throw createTrayError(TrayErrorCode.unavailable)
      },
      selfUnUse: async (name, generation, _runId) => {
        if (graph!.getBinding<IAdmissionRecord>(name as IGraphId) !== generation)
          throw createTrayError(TrayErrorCode.unavailable)
        return managed.unUse(name)
      },
      selfReplace: async (name, generation, plugin, _runId) => {
        if (graph!.getBinding<IAdmissionRecord>(name as IGraphId) !== generation)
          throw createTrayError(TrayErrorCode.unavailable)
        if ((plugin as { readonly name?: unknown }).name !== name)
          throw createTrayError(TrayErrorCode.runtimeContractInvalid)
        return managed.replace(plugin as IPluginBinding)
      }
    })
    return managed as ITrayResolvedHost<THost, TPlugins>
  } catch (error) {
    const cleanupErrors: unknown[] = [...cleanup.errors]
    const physical: Promise<ITrayPluginPhysicalCleanupResult>[] = [...cleanup.physical]
    try {
      await graph?.dispose()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    if (concrete !== undefined) {
      if (anchorName !== undefined) {
        try {
          const anchorRemoval = await (concrete as IAnyHost).getCurrentView().unUse(anchorName)
          cleanupErrors.push(...anchorRemoval.cleanupErrors)
          if (anchorRemoval.physicalCompletion)
            physical.push(observePhysical(anchorRemoval.physicalCompletion))
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      try {
        const result = (await concrete.dispose()) as IPluginHostDisposalResult
        cleanupErrors.push(...result.cleanupErrors)
        if (result.physicalCompletion) physical.push(observePhysical(result.physicalCompletion))
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      claims.delete(concrete as object)
    }
    const primary =
      error instanceof Error ? error : createTrayError(TrayErrorCode.invalidEntry, error)
    const detail = Object.freeze({
      phase: graph ? 'setup' : 'factory',
      cleanupComplete: cleanup.complete && cleanupErrors.length === 0 && physical.length === 0,
      cleanupErrors: Object.freeze(cleanupErrors),
      ...(physical.length > 0 ? { physicalCompletion: settlePhysical(physical) } : {})
    })
    Object.defineProperty(primary, 'detail', { value: detail, enumerable: true })
    throw attachTrayError(primary, TrayErrorCode.invalidEntry)
  }
}

/** Snapshots creation options before constructing any lifecycle state. */
function snapshotOptions<
  THost extends PluginHost<any, any, any>,
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
    (shutdown.mode !== 'bounded' && shutdown.mode !== 'strict-drain')
  )
    throw createTrayError(TrayErrorCode.invalidEntry)
  return Object.freeze({
    create,
    plugins: Object.freeze([...plugins]) as TPlugins,
    mutationAdmissionMs,
    quiescenceMs,
    shutdown,
    report: options.report
  })
}

/** Converts one Tray descriptor into the sole Graph lifecycle node projection. */
function toGraphNode(admission: IAdmissionRecord): IGraphNodeDefinition<unknown> {
  const id = admission.snapshot.name as IGraphId
  const requires = admission.snapshot.requires
  return {
    id,
    kind: 'plugin',
    dependencies: requires.map((provider) => ({
      provider: provider as IGraphId,
      required: true as const
    })),
    start: async () => {
      return {
        value: admission.plugin,
        release: async () => undefined
      }
    }
  }
}

/** Orders admissions by available required providers while preserving input order ties. */
function orderAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  const byName = new Map(records.map((record) => [record.snapshot.name, record] as const))
  const remaining = new Set(records)
  const ordered: IAdmissionRecord[] = []
  while (remaining.size > 0) {
    const ready = records.filter(
      (record) =>
        remaining.has(record) &&
        record.snapshot.requires.every(
          (provider) =>
            !byName.has(provider) || ordered.some((item) => item.snapshot.name === provider)
        )
    )
    if (ready.length === 0) {
      if (
        [...remaining].some((record) =>
          record.snapshot.requires.some((provider) => !byName.has(provider))
        )
      ) {
        ordered.push(...remaining)
        break
      }
      throw createTrayError(TrayErrorCode.invalidEntry)
    }
    for (const record of ready) {
      remaining.delete(record)
      ordered.push(record)
    }
  }
  return ordered
}

/** Selects only definitions whose complete required-provider closure is initially present. */
function computeReadyAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  const names = new Set(records.map((record) => record.snapshot.name))
  const ready = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const record of records) {
      if (
        !ready.has(record.snapshot.name) &&
        record.snapshot.requires.every((provider) => names.has(provider) && ready.has(provider))
      ) {
        ready.add(record.snapshot.name)
        changed = true
      }
    }
  }
  return records.filter((record) => ready.has(record.snapshot.name))
}

/** Builds the managed facade over the Graph and exactly one concrete Host view. */
function createManagedHost(
  concrete: IAnyHost,
  graph: IGraph,
  options: ICreateHostOptions<IAnyHost, readonly IPluginBinding[]>,
  readView: () => IAnyView,
  writeView: (view: IAnyView) => void,
  assertOwned: () => void,
  session: object,
  cleanup: ICleanupAccumulator,
  anchorName: string,
  readExpectedRevision: () => number,
  activeRuntimeNames: ReadonlyMap<string, number>,
  waitForRuntimeQuiescence: () => Promise<void>
): ITrayHost<IAnyHost, readonly IPluginBinding[], readonly IPluginBinding[]> {
  let state: ITrayHostState = TrayHostState.active
  let terminalError: unknown
  let disposal: Promise<ITrayHostDisposalResult> | undefined
  /** Managed reads fail closed while Host and Graph publication receipts are converging. */
  let publicationPending = false
  const hub = createEventHub<ITrayHostEventMap>({
    report: ({ error }) => {
      try {
        options.report?.(error)
      } catch {
        // Observer reporting is best effort and cannot alter a settled mutation.
      }
    }
  })
  const facade = {
    get plugins() {
      assertReadable()
      return Object.freeze([...graph.nodes].map(String))
    },
    get readyPlugins() {
      assertReadable()
      return Object.freeze(
        [...graph.nodes].filter((id) => graph.nodeState(id).state === 'ready').map(String)
      )
    },
    get state() {
      return state
    },
    get isActive() {
      return state === TrayHostState.active
    },
    get error() {
      return terminalError
    },
    get extensions() {
      assertReadable()
      return readView().extensions
    },
    get config() {
      assertReadable()
      const config = readView().config
      return {
        get: (path: string) => config.get(path),
        update: async (
          name: string,
          recipe: (previous: Readonly<Record<string, unknown>>) => Record<string, unknown>
        ) => {
          await config.update(name, recipe as never)
          writeView(readView())
        }
      }
    },
    getShared(key: PropertyKey) {
      assertReadable()
      return readView().getShared(key)
    },
    pluginState(name: string) {
      assertReadable()
      try {
        return graph.nodeState(name as IGraphId).state
      } catch {
        return 'blocked'
      }
    },
    on<TKey extends keyof ITrayHostEventMap>(
      type: TKey,
      listener: (event: IEventContext<ITrayHostEventMap[TKey]>) => void | PromiseLike<void>
    ): IUnsubscribe {
      return hub.subscribe(type, listener as never)
    },
    async use(
      plugin: IPluginBinding
    ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> {
      assertActive()
      assertOwned()
      const snapshot = snapshotTrayPlugin(plugin)
      const name = snapshot.name
      const existedBefore = graph.nodes.some((id) => String(id) === name)
      let candidate: IAdmissionRecord | undefined
      try {
        resetCleanup()
        candidate = createAdmissionRecord(plugin, snapshot)
        publicationPending = true
        const result = await graph.register(toGraphNode(candidate), candidate)
        publicationPending = false
        const output = mutationResult(
          'use',
          name,
          result.affected.map(String),
          result.topologyChanged,
          facade,
          cleanup
        )
        hub.publish('use', output as never)
        hub.publish('registered', output as never)
        return output
      } catch (error) {
        publicationPending = false
        const committed =
          candidate !== undefined &&
          !existedBefore &&
          graph.getBinding(name as IGraphId) === candidate
        if (candidate && !committed) {
          concrete.retireDataOrderSlot(candidate.slot)
          await candidate.artifactCustody?.rollback()
        }
        const failure = mutationFailure('use', name, error, facade, committed)
        hub.publish('mutationFailed', {
          operation: 'use',
          name,
          error: failure.error
        })
        return failure
      }
    },
    async unUse(name: string): Promise<ITrayPluginRemovalResult<unknown, unknown>> {
      assertActive()
      assertOwned()
      const runtimeBridge = readRuntimeBridge(facade)
      try {
        runtimeBridge?.assertMutationAllowed?.(name)
      } catch (error) {
        const failure = removalFailure(name, error, facade)
        hub.publish('mutationFailed', { operation: 'unUse', name, error: failure.error })
        return failure
      }
      if (!graph.nodes.some((id) => String(id) === name)) return removalMissing(name, facade)
      const target = graph.getBinding<IAdmissionRecord>(name as IGraphId)
      try {
        resetCleanup()
        publicationPending = true
        const result = await graph.remove(name as IGraphId)
        publicationPending = false
        if (target) concrete.retireDataOrderSlot(target.slot)
        const output = removalResult(name, result.affected.map(String), facade, cleanup)
        hub.publish('unUse', output as never)
        hub.publish('removed', output as never)
        return output
      } catch (error) {
        publicationPending = false
        const committed = !graph.nodes.some((id) => String(id) === name)
        const failure = removalFailure(name, error, facade, committed)
        hub.publish('mutationFailed', { operation: 'unUse', name, error: failure.error })
        return failure
      }
    },
    async replace(
      plugin: IPluginBinding
    ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> {
      assertActive()
      assertOwned()
      const snapshot = snapshotTrayPlugin(plugin)
      const name = snapshot.name
      const runtimeBridge = readRuntimeBridge(facade)
      try {
        runtimeBridge?.assertMutationAllowed?.(name)
      } catch (error) {
        const failure = mutationFailure('replace', name, error, facade)
        hub.publish('mutationFailed', { operation: 'replace', name, error: failure.error })
        return failure
      }
      const previous = graph.getBinding<IAdmissionRecord>(name as IGraphId)
      let candidate: IAdmissionRecord | undefined
      try {
        resetCleanup()
        candidate = createAdmissionRecord(plugin, snapshot, previous?.slot)
        publicationPending = true
        const result = await graph.replace(toGraphNode(candidate), candidate)
        publicationPending = false
        const output = mutationResult(
          'replace',
          name,
          result.affected.map(String),
          result.topologyChanged,
          facade,
          cleanup
        )
        hub.publish('replace', output as never)
        hub.publish('replaced', output as never)
        return output
      } catch (error) {
        publicationPending = false
        const committed =
          candidate !== undefined && graph.getBinding(name as IGraphId) === candidate
        const failure = mutationFailure('replace', name, error, facade, committed)
        hub.publish('mutationFailed', {
          operation: 'replace',
          name,
          error: failure.error
        })
        return failure
      }
    },
    dispose(): Promise<ITrayHostDisposalResult> {
      if (disposal) return disposal
      state = TrayHostState.closing
      hub.publish('disposing', { state: 'closing' })
      disposal = (async () => {
        const cleanupErrors: unknown[] = []
        const physical: Promise<ITrayPluginPhysicalCleanupResult>[] = []
        try {
          resetCleanup()
          /** Defers concrete Host disposal so active Runtime callbacks retain physical custody. */
          const deferConcreteDisposal = async (): Promise<boolean> => {
            if (activeRuntimeNames.size === 0) return false
            const runtimeFence = waitForRuntimeQuiescence()
            const bounded = await settleWithin(runtimeFence, options.quiescenceMs)
            if (bounded.complete) return false
            cleanup.complete = false
            const delayed = runtimeFence.then(
              () => concrete!.dispose() as Promise<IPluginHostDisposalResult>
            )
            physical.push(observePhysical(delayed))
            return true
          }
          const externallyMutated = concrete.revision !== readExpectedRevision()
          if (externallyMutated) {
            await graph.dispose()
            cleanupErrors.push(...cleanup.errors)
            physical.push(...cleanup.physical)
            if (await deferConcreteDisposal()) {
              state = TrayHostState.terminal
              claims.delete(concrete as object)
              hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
              return {
                state: 'terminal' as const,
                termination: 'external-host' as const,
                cleanupComplete: false,
                cleanupErrors: Object.freeze(cleanupErrors),
                physicalCompletion: settlePhysical(physical)
              }
            }
            const externalResult = (await concrete.dispose()) as IPluginHostDisposalResult
            cleanupErrors.push(...externalResult.cleanupErrors)
            if (externalResult.physicalCompletion)
              physical.push(observePhysical(externalResult.physicalCompletion))
            state = TrayHostState.terminal
            claims.delete(concrete as object)
            const cleanupComplete =
              cleanup.complete && externalResult.cleanupComplete && physical.length === 0
            hub.publish('disposed', {
              state: 'terminal',
              cleanupComplete
            })
            return {
              state: 'terminal' as const,
              termination: 'external-host' as const,
              cleanupComplete,
              cleanupErrors: Object.freeze(cleanupErrors),
              ...(physical.length > 0 ? { physicalCompletion: settlePhysical(physical) } : {})
            }
          }
          await graph.dispose()
          cleanupErrors.push(...cleanup.errors)
          physical.push(...cleanup.physical)
          const anchorRemoval = await readView().unUse(anchorName)
          cleanupErrors.push(...anchorRemoval.cleanupErrors)
          if (anchorRemoval.physicalCompletion)
            physical.push(observePhysical(anchorRemoval.physicalCompletion))
          if (await deferConcreteDisposal()) {
            state = TrayHostState.terminal
            claims.delete(concrete as object)
            hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
            return {
              state: 'terminal' as const,
              termination: 'managed' as const,
              cleanupComplete: false,
              cleanupErrors: Object.freeze(cleanupErrors),
              physicalCompletion: settlePhysical(physical)
            }
          }
          const result = (await concrete.dispose()) as IPluginHostDisposalResult
          cleanupErrors.push(...result.cleanupErrors)
          if (result.physicalCompletion) physical.push(observePhysical(result.physicalCompletion))
          const cleanupComplete =
            cleanup.complete && result.cleanupComplete && physical.length === 0
          state = TrayHostState.terminal
          claims.delete(concrete as object)
          hub.publish('disposed', {
            state: 'terminal',
            cleanupComplete
          })
          return {
            state: 'terminal' as const,
            termination: 'managed' as const,
            cleanupComplete,
            cleanupErrors: Object.freeze(cleanupErrors),
            ...(physical.length > 0 ? { physicalCompletion: settlePhysical(physical) } : {})
          }
        } catch (error) {
          state = TrayHostState.failed
          terminalError = error
          hub.publish('disposed', { state: 'terminal', cleanupComplete: false })
          return {
            state: 'terminal' as const,
            termination: 'managed' as const,
            cleanupComplete: false,
            cleanupErrors: Object.freeze([error]),
            error: error instanceof Error ? error : undefined
          }
        }
      })()
      return disposal
    },
    [asyncDisposeKey]() {
      return facade.dispose().then(() => undefined)
    }
  }
  void session
  return facade as never

  function assertActive(): void {
    if (state !== TrayHostState.active) throw createTrayError(TrayErrorCode.unavailable)
  }

  /** Rejects observations that could otherwise combine different Host and Graph generations. */
  function assertReadable(): void {
    if (publicationPending) throw createTrayError(TrayErrorCode.unavailable)
    assertOwned()
  }

  /** Resets one transaction's cleanup observation before Graph reconciliation starts. */
  function resetCleanup(): void {
    cleanup.errors = []
    cleanup.complete = true
    cleanup.physical = []
  }

  /** Captures one managed descriptor and its Host-owned admission handles. */
  function createAdmissionRecord(
    plugin: IPluginBinding,
    snapshot: IPluginSnapshot,
    slot?: IPluginDataOrderSlot
  ): IAdmissionRecord {
    const record = {
      plugin,
      snapshot,
      admission: concrete.createPluginAdmission<IPluginConstraint<any>>(
        plugin as IPluginConstraint<any>
      ),
      slot: slot ?? concrete.createDataOrderSlot(snapshot.name),
      artifactCustody: claimArtifactCustody(plugin as object)
    }
    return record
  }
}

type IPluginSnapshot = Readonly<{ readonly name: string; readonly requires: readonly string[] }>

/** Reads and validates lifecycle edge metadata once at the Tray boundary. */
function snapshotTrayPlugin(plugin: IPluginBinding): IPluginSnapshot {
  const name = plugin?.name
  if (typeof name !== 'string' || name.length === 0 || name.includes('.'))
    throw createTrayError(TrayErrorCode.invalidEntry)
  const requires = plugin.requires
  if (requires === undefined) return Object.freeze({ name, requires: Object.freeze([]) })
  if (!Array.isArray(requires)) throw createTrayError(TrayErrorCode.invalidEntry)
  const edges = [...requires]
  if (
    edges.some(
      (provider) => typeof provider !== 'string' || provider.length === 0 || provider.includes('.')
    )
  )
    throw createTrayError(TrayErrorCode.invalidEntry)
  if (new Set(edges).size !== edges.length || edges.includes(name))
    throw createTrayError(TrayErrorCode.invalidEntry)
  return Object.freeze({ name, requires: Object.freeze(edges) })
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
    ...(cleanup.physical.length > 0 ? { physicalCompletion: settlePhysical(cleanup.physical) } : {})
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
    ...(cleanup.physical.length > 0 ? { physicalCompletion: settlePhysical(cleanup.physical) } : {})
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

/** Converts physical cleanup promises into one exact non-rejecting observation. */
function settlePhysical(values: readonly unknown[]): Promise<ITrayPluginPhysicalCleanupResult> {
  return Promise.all(
    values
      .filter((value): value is Promise<unknown> => value instanceof Promise)
      .map((value) =>
        value.then(
          (result) =>
            result &&
            typeof result === 'object' &&
            'cleanupErrors' in result &&
            Array.isArray(result.cleanupErrors)
              ? result.cleanupErrors
              : [],
          (error) => [error]
        )
      )
  ).then((groups) => Object.freeze({ cleanupErrors: Object.freeze(groups.flat()) }))
}

/** Converts one Host cleanup result or promise into the non-rejecting Tray observation. */
function observePhysical<T extends Readonly<{ readonly cleanupErrors: readonly unknown[] }>>(
  value: Promise<T>
): Promise<ITrayPluginPhysicalCleanupResult> {
  return value.then(
    async (result) => {
      const errors = [...result.cleanupErrors]
      const nested = (
        result as T & {
          readonly physicalCompletion?: Promise<
            Readonly<{ readonly cleanupErrors: readonly unknown[] }>
          >
        }
      ).physicalCompletion
      if (nested) {
        try {
          errors.push(...(await nested).cleanupErrors)
        } catch (error) {
          errors.push(error)
        }
      }
      return Object.freeze({ cleanupErrors: Object.freeze(errors) })
    },
    (error) => Object.freeze({ cleanupErrors: Object.freeze([error]) })
  )
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
