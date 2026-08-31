import {
  assimilateCapturedThen,
  createGenerationController,
  createLifecycleScope,
  createProvisionalScope,
  probeThenable,
  ThenableProbeKind,
  type IAbortSignal,
  type IGenerationController,
  type IGenerationToken,
  type IReleaseContext,
  type IReleaseDescriptor
} from '@migaia/lifecycle'
import { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
import { CapabilityGraphErrorText } from './error-text.js'
import {
  createCapabilityGraphError,
  graphFailure,
  graphMessageFor,
  type ICapabilityGraphError
} from './errors.js'
import {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  type ICapabilityGraphNodeState,
  type ICapabilityGraphState
} from './state-constants.js'
import { buildCapabilityTopology, TopologyInvalidReason } from './topology.js'

export { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
export { CAPABILITY_GRAPH_SOURCE, type ICapabilityGraphError } from './errors.js'
export {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  type ICapabilityGraphNodeState,
  type ICapabilityGraphState
} from './state-constants.js'
export {
  buildCapabilityTopology,
  TopologyInvalidReason,
  type ICapabilityTopology,
  type ITopologyInvalidReason,
  type ITopologyDependency,
  type ITopologyNode
} from './topology.js'

/** Nominal node identity accepted by a graph registration. */
export type IGraphNodeId = string & { readonly __graphNodeId: unique symbol }

/** A required static provider edge. Optional/notification edges belong to later SDDs. */
export type IGraphDependency = { readonly provider: IGraphNodeId; readonly required: true }

/** The primary resource returned by a node start. Its release is owned exactly once by Graph. */
export type IGraphNodeInstance<T> = {
  readonly value: T
  readonly release: (context: IGraphReleaseContext) => void | PromiseLike<void>
}

/** Release context passed to the primary node instance. */
export type IGraphReleaseContext = {
  readonly signal: IAbortSignal
  readonly nodeId: IGraphNodeId
  readonly report: (error: unknown) => void
}

/** Startup context with direct-provider reads and provisional auxiliary ownership. */
export type IGraphStartContext = {
  readonly nodeId: IGraphNodeId
  readonly signal: IAbortSignal
  readonly get: <T = unknown>(provider: IGraphNodeId) => T
  readonly own: <T>(resource: T, descriptor: IReleaseDescriptor) => T
}

/** Static node definition admitted before the first `ready()`. */
export type IGraphNodeDefinition<T> = {
  readonly id: IGraphNodeId
  readonly kind: string
  readonly dependencies: readonly IGraphDependency[]
  readonly start: (
    context: IGraphStartContext
  ) => IGraphNodeInstance<T> | PromiseLike<IGraphNodeInstance<T>>
}

/** Terminal diagnostic snapshot for one node. */
export type IGraphNodeDiagnostic = {
  readonly id: IGraphNodeId
  readonly kind: string
  readonly state: ICapabilityGraphNodeState
  readonly value: unknown
  readonly error: unknown
  /** Optional composition binding retained by the dynamic owner. */
  readonly binding?: unknown
  /** Monotonic lifecycle generation for this node. */
  readonly generation?: number
  /** Stable registration ordinal retained across same-edge replacement. */
  readonly ordinal?: number
  /** Deterministic schedule rank retained when topology edges do not change. */
  readonly rank?: number
  /** Dependency depth retained when topology edges do not change. */
  readonly level?: number
}

/** Public Graph contract. */
export type ICapabilityGraph = {
  register<T>(node: IGraphNodeDefinition<T>): void
  ready(): Promise<void>
  nodeState(id: IGraphNodeId): IGraphNodeDiagnostic
  readonly nodes: readonly IGraphNodeId[]
  readonly state: ICapabilityGraphState
  readonly error: unknown | undefined
  dispose(): Promise<void>
  get<T = unknown>(consumer: IGraphNodeId, provider: IGraphNodeId): T
}

/** Factory options are snapshotted before any lifecycle object is constructed. */
export type ICapabilityGraphOptions = {
  readonly onError?: (error: unknown) => void
}

type IAdmittedNode = {
  readonly id: IGraphNodeId
  readonly kind: string
  readonly dependencies: readonly IGraphDependency[]
  readonly start: IGraphNodeDefinition<unknown>['start']
  readonly ordinal: number
  state: ICapabilityGraphNodeState
  value?: unknown
  error?: unknown
  token?: IGenerationToken
}

/** Creates a runtime-neutral static capability dependency graph. */
export function createCapabilityGraph(options: ICapabilityGraphOptions = {}): ICapabilityGraph {
  /** Factory-owned diagnostics sink; never changes transaction primary errors. */
  let onError: ICapabilityGraphOptions['onError']
  try {
    onError = options.onError
  } catch (error) {
    throw createCapabilityGraphError(
      CapabilityGraphErrorCode.invalidOption,
      CapabilityGraphErrorText.invalidOption,
      { cause: error }
    )
  }
  if (onError !== undefined && typeof onError !== 'function') {
    throw createCapabilityGraphError(
      CapabilityGraphErrorCode.invalidOption,
      CapabilityGraphErrorText.invalidOption
    )
  }

  /** Frozen-registry lookup used by admission, startup, and direct-edge reads. */
  const nodesById = new Map<string, IAdmittedNode>()
  /** Registration-ordinal sequence; topology derives schedule from this order. */
  const nodeOrder: IAdmittedNode[] = []
  /** Graph transaction state; node state remains a separate diagnostic axis. */
  let graphState: ICapabilityGraphState = CapabilityGraphState.open
  /** Primary graph error retained across terminal and failed transitions. */
  let graphError: unknown
  /** Canonical readiness promise shared by every caller. */
  let readyPromise: Promise<void> | undefined
  /** Canonical disposal promise shared by every caller. */
  let disposePromise: Promise<void> | undefined
  /** Synchronous lifecycle callback guard for same-graph reentrancy. */
  let activeCallback = false
  /** Whether readiness settlement has already selected its canonical reason. */
  let readinessSettled = false
  /** Rejection identity reused by cold-terminal readiness calls. */
  let readyReason: unknown
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void

  const reportError = (error: unknown): void => {
    if (!onError) return
    try {
      const result = onError(error)
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch(() => undefined)
    } catch {
      // The diagnostic sink is the final boundary and cannot invalidate Graph state.
    }
  }

  const root = createLifecycleScope({ errorPolicy: 'throw', report: reportError })
  const generations: IGenerationController = createGenerationController({
    onSuperseded: reportError
  })
  let currentGraphToken!: IGenerationToken
  let currentGraphSignal!: IAbortSignal

  const fail = (
    code: ICapabilityGraphErrorCode,
    detail?: Readonly<Record<string, unknown>>
  ): ICapabilityGraphError => createCapabilityGraphError(code, graphMessageFor(code), { detail })

  const assertMutationOpen = (): void => {
    if (graphState === CapabilityGraphState.terminal)
      throw fail(CapabilityGraphErrorCode.graphDisposed)
    if (graphState === CapabilityGraphState.quiescing)
      throw fail(CapabilityGraphErrorCode.admissionClosed)
    if (graphState !== CapabilityGraphState.open) throw fail(CapabilityGraphErrorCode.graphFrozen)
  }

  const readNode = <T>(input: IGraphNodeDefinition<T>, ordinal: number): IAdmittedNode => {
    let id: unknown
    let kind: unknown
    let dependencies: unknown
    let start: unknown
    try {
      id = input.id
      kind = input.kind
      dependencies = input.dependencies
      start = input.start
    } catch (error) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
    }
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      typeof kind !== 'string' ||
      kind.length === 0 ||
      typeof start !== 'function' ||
      !Array.isArray(dependencies)
    )
      throw fail(CapabilityGraphErrorCode.invalidNode)
    const edges: IGraphDependency[] = []
    const seenProviders = new Set<string>()
    let length: number
    try {
      length = dependencies.length
    } catch (error) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
    }
    if (!Number.isSafeInteger(length) || length < 0)
      throw fail(CapabilityGraphErrorCode.invalidNode)
    for (let index = 0; index < length; index += 1) {
      let raw: unknown
      try {
        raw = dependencies[index]
      } catch (error) {
        throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
      }
      let provider: unknown
      let required: unknown
      try {
        provider = (raw as { provider?: unknown }).provider
        required = (raw as { required?: unknown }).required
      } catch (error) {
        throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
      }
      if (typeof provider !== 'string' || required !== true)
        throw fail(CapabilityGraphErrorCode.invalidNode)
      if (seenProviders.has(provider))
        throw fail(CapabilityGraphErrorCode.duplicateEdge, { id, provider })
      seenProviders.add(provider)
      edges.push(Object.freeze({ provider: provider as IGraphNodeId, required: true }))
    }
    return {
      id: id as IGraphNodeId,
      kind,
      dependencies: Object.freeze(edges),
      start: start as IAdmittedNode['start'],
      ordinal,
      state: CapabilityGraphNodeState.registered
    }
  }

  const assertKnownAndAcyclic = (): IAdmittedNode[] => {
    const topology = buildCapabilityTopology(
      nodeOrder,
      (nodeId, provider) => {
        throw fail(CapabilityGraphErrorCode.unknownProvider, { nodeId, provider })
      },
      (path) => {
        throw fail(CapabilityGraphErrorCode.dependencyCycle, { path })
      },
      (reason, nodeId) => {
        const code =
          reason === TopologyInvalidReason.duplicateNode
            ? CapabilityGraphErrorCode.duplicateNode
            : CapabilityGraphErrorCode.invalidNode
        throw fail(code, nodeId === undefined ? undefined : { nodeId })
      }
    )
    const admittedById = new Map<string, IAdmittedNode>(nodeOrder.map((node) => [node.id, node]))
    return topology.ordered.map((node) => admittedById.get(node.id)!)
  }

  const releaseLateResult = (
    node: IAdmittedNode,
    result: IGraphNodeInstance<unknown>,
    release: (context: IGraphReleaseContext) => void | PromiseLike<void>,
    signal: IAbortSignal
  ): void => {
    try {
      const releaseResult = release({ nodeId: node.id, signal, report: reportError })
      const probe = probeThenable(releaseResult)
      if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, releaseResult).catch(reportError)
      else if (probe.kind === ThenableProbeKind.failed) reportError(probe.error)
    } catch (error) {
      reportError(error)
    }
  }

  const startNode = async (node: IAdmittedNode, releaseOrder: number): Promise<void> => {
    node.state = CapabilityGraphNodeState.starting
    const requestToken = currentGraphToken
    const requestSignal = currentGraphSignal
    node.token = requestToken
    const provisional = createProvisionalScope({ parentSignal: requestSignal })
    const declared = new Set(node.dependencies.map((dependency) => dependency.provider))
    const auxiliaryResources: unknown[] = []
    let contextActive = true
    const assertContextActive = (): void => {
      if (
        !contextActive ||
        graphState !== CapabilityGraphState.starting ||
        !generations.isCurrent(requestToken)
      )
        throw fail(CapabilityGraphErrorCode.admissionClosed, { nodeId: node.id })
    }
    const invokeLifecycleCallback = <T>(callback: () => T): T => {
      activeCallback = true
      try {
        return callback()
      } finally {
        activeCallback = false
      }
    }
    const ownAuxiliary = <T>(resource: T, descriptor: IReleaseDescriptor): T => {
      const orderedDescriptor = Object.defineProperties({} as IReleaseDescriptor, {
        syncSafe: { get: () => descriptor.syncSafe },
        order: { value: releaseOrder, enumerable: true },
        graceful: {
          get: () => {
            const graceful = descriptor.graceful
            return typeof graceful === 'function'
              ? (context: Parameters<typeof graceful>[0]) =>
                  invokeLifecycleCallback(() => graceful(context))
              : graceful
          }
        },
        gracefulTimeoutMs: { get: () => descriptor.gracefulTimeoutMs },
        force: {
          get: () => {
            const force = descriptor.force
            return (context: Parameters<typeof force>[0]) =>
              invokeLifecycleCallback(() => force(context))
          }
        },
        gcFallback: { get: () => descriptor.gcFallback },
        custom: {
          get: () => {
            const custom = descriptor.custom
            return typeof custom === 'function'
              ? (context: Parameters<typeof custom>[0]) =>
                  invokeLifecycleCallback(() => custom(context))
              : custom
          }
        }
      })
      const owned = provisional.own(resource, orderedDescriptor)
      auxiliaryResources.push(resource)
      return owned
    }
    const context: IGraphStartContext = {
      nodeId: node.id,
      signal: requestSignal,
      get: <T>(provider: IGraphNodeId): T => {
        assertContextActive()
        if (!declared.has(provider))
          throw fail(CapabilityGraphErrorCode.providerUnavailable, { nodeId: node.id, provider })
        const providerNode = nodesById.get(provider)
        if (!providerNode || providerNode.state !== CapabilityGraphNodeState.ready)
          throw fail(CapabilityGraphErrorCode.providerUnavailable, { nodeId: node.id, provider })
        return providerNode.value as T
      },
      own: <T>(resource: T, descriptor: IReleaseDescriptor): T => {
        assertContextActive()
        try {
          return ownAuxiliary(resource, descriptor)
        } catch (error) {
          throw graphFailure(CapabilityGraphErrorCode.admissionClosed, error, { nodeId: node.id })
        }
      }
    }
    try {
      activeCallback = true
      let started: IGraphNodeInstance<unknown> | PromiseLike<IGraphNodeInstance<unknown>>
      try {
        started = node.start(context)
      } finally {
        activeCallback = false
      }
      const probe = probeThenable(started)
      let result: IGraphNodeInstance<unknown>
      if (probe.kind === ThenableProbeKind.thenable) {
        result = await assimilateCapturedThen<IGraphNodeInstance<unknown>>(probe.thenFn, started)
      } else if (probe.kind === ThenableProbeKind.failed) {
        throw probe.error
      } else {
        result = started as IGraphNodeInstance<unknown>
      }
      let release: unknown
      let value: unknown
      try {
        release = result.release
        value = result.value
      } catch (admissionError) {
        throw graphFailure(CapabilityGraphErrorCode.invalidNode, admissionError, {
          nodeId: node.id
        })
      }
      if (result === null || typeof result !== 'object' || typeof release !== 'function')
        throw fail(CapabilityGraphErrorCode.invalidNode, { nodeId: node.id })
      const releaseMethod = release as IGraphNodeInstance<unknown>['release']
      if (auxiliaryResources.some((resource) => resource === value))
        throw fail(CapabilityGraphErrorCode.invalidNode, { nodeId: node.id })
      if (!generations.isCurrent(requestToken) || graphState !== CapabilityGraphState.starting) {
        await provisional.rollback()
        releaseLateResult(node, result, releaseMethod, requestSignal)
        node.state = CapabilityGraphNodeState.rolledBack
        return
      }
      await provisional.commitTo(root)
      root.own(result, {
        order: releaseOrder,
        force: (releaseContext: IReleaseContext) => {
          let releaseResult: void | PromiseLike<void>
          try {
            releaseResult = invokeLifecycleCallback(() =>
              releaseMethod({ nodeId: node.id, signal: releaseContext.signal, report: reportError })
            )
          } catch (error) {
            node.error = error
            node.state = CapabilityGraphNodeState.failed
            throw error
          }
          const releaseProbe = probeThenable(releaseResult)
          if (releaseProbe.kind === ThenableProbeKind.failed) {
            node.error = releaseProbe.error
            node.state = CapabilityGraphNodeState.failed
            throw releaseProbe.error
          }
          if (releaseProbe.kind === ThenableProbeKind.thenable) {
            return assimilateCapturedThen(releaseProbe.thenFn, releaseResult).then(
              () => {
                node.state = CapabilityGraphNodeState.released
              },
              (error: unknown) => {
                node.error = error
                node.state = CapabilityGraphNodeState.failed
                throw error
              }
            )
          }
          node.state = CapabilityGraphNodeState.released
          return releaseResult
        }
      })
      node.value = value
      node.state = CapabilityGraphNodeState.ready
    } catch (error) {
      try {
        await provisional.rollback()
      } catch (cleanupError) {
        reportError(cleanupError)
      }
      if (!generations.isCurrent(requestToken) || graphState !== CapabilityGraphState.starting) {
        node.state = CapabilityGraphNodeState.rolledBack
        reportError(error)
        return
      }
      node.error = graphFailure(CapabilityGraphErrorCode.startFailed, error, { nodeId: node.id })
      node.state = CapabilityGraphNodeState.failed
      throw node.error
    } finally {
      contextActive = false
    }
  }

  const startGraph = async (): Promise<void> => {
    graphState = CapabilityGraphState.starting
    let ordered: IAdmittedNode[]
    try {
      ordered = assertKnownAndAcyclic()
      const request = generations.begin()
      currentGraphToken = request.token
      currentGraphSignal = request.signal
      for (const [index, node] of ordered.entries()) {
        if (graphState !== CapabilityGraphState.starting)
          throw fail(CapabilityGraphErrorCode.admissionClosed)
        const blocked = node.dependencies.some(
          (edge) => nodesById.get(edge.provider)?.state !== CapabilityGraphNodeState.ready
        )
        if (blocked) {
          node.state = CapabilityGraphNodeState.blocked
          throw fail(CapabilityGraphErrorCode.providerUnavailable, { nodeId: node.id })
        }
        await startNode(node, index + 1)
      }
      if (graphState !== CapabilityGraphState.starting)
        throw fail(CapabilityGraphErrorCode.admissionClosed)
      graphState = CapabilityGraphState.ready
      resolveReady()
    } catch (error) {
      const currentState: ICapabilityGraphState = graphState
      const terminalStates: readonly string[] = [
        CapabilityGraphState.quiescing,
        CapabilityGraphState.terminal
      ]
      if (!terminalStates.includes(currentState)) {
        graphError = error
      } else if (graphError === undefined) {
        graphError = error
      }
      try {
        await root.dispose()
      } catch (cleanupError) {
        reportError(cleanupError)
      }
      if (!terminalStates.includes(currentState)) graphState = CapabilityGraphState.failed
      for (const node of nodeOrder) {
        if (node.state === CapabilityGraphNodeState.registered) {
          node.state = CapabilityGraphNodeState.blocked
        } else if (
          node.state === CapabilityGraphNodeState.ready ||
          node.state === CapabilityGraphNodeState.released
        ) {
          node.state = CapabilityGraphNodeState.rolledBack
        }
      }
      if (!readinessSettled) rejectReady(error)
    } finally {
      readinessSettled = true
    }
  }

  const ready = (): Promise<void> => {
    if (activeCallback) throw fail(CapabilityGraphErrorCode.reentrantOperation)
    if (readyPromise) return readyPromise
    if (
      graphState === CapabilityGraphState.terminal ||
      graphState === CapabilityGraphState.quiescing
    ) {
      const reason =
        readyReason ??
        graphError ??
        fail(
          graphState === CapabilityGraphState.terminal
            ? CapabilityGraphErrorCode.graphDisposed
            : CapabilityGraphErrorCode.admissionClosed
        )
      readyReason = reason
      readyPromise = Promise.reject(reason)
      void readyPromise.catch(() => undefined)
      return readyPromise
    }
    if (graphState === CapabilityGraphState.failed) return Promise.reject(graphError)
    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void startGraph()
    return readyPromise
  }

  const dispose = (): Promise<void> => {
    if (activeCallback) throw fail(CapabilityGraphErrorCode.reentrantOperation)
    if (disposePromise) return disposePromise
    if (graphState === CapabilityGraphState.terminal) return Promise.resolve()
    graphState = CapabilityGraphState.quiescing
    for (const node of nodeOrder) node.value = undefined
    let generationError: unknown
    try {
      generations.dispose(CapabilityGraphErrorText.disposed)
    } catch (error) {
      generationError = error
      reportError(error)
    }
    if (!readinessSettled && readyPromise) {
      graphError = fail(CapabilityGraphErrorCode.admissionClosed)
      rejectReady(graphError)
      readinessSettled = true
    }
    const currentDisposePromise = root.dispose().then(
      () => {
        graphState = CapabilityGraphState.terminal
        if (generationError !== undefined) {
          graphError = graphFailure(CapabilityGraphErrorCode.disposeFailed, generationError)
          readyReason ??= graphError
          throw graphError
        }
      },
      (error: unknown) => {
        graphState = CapabilityGraphState.terminal
        graphError = graphFailure(CapabilityGraphErrorCode.disposeFailed, error)
        readyReason ??= graphError
        throw graphError
      }
    )
    disposePromise = currentDisposePromise
    return currentDisposePromise
  }

  return {
    register<T>(node: IGraphNodeDefinition<T>) {
      assertMutationOpen()
      const admitted = readNode(node, nodeOrder.length)
      if (nodesById.has(admitted.id))
        throw fail(CapabilityGraphErrorCode.duplicateNode, { id: admitted.id })
      nodesById.set(admitted.id, admitted)
      nodeOrder.push(admitted)
    },
    ready,
    nodeState(id) {
      const node = nodesById.get(id)
      if (!node) throw fail(CapabilityGraphErrorCode.unknownNode, { id })
      return Object.freeze({
        id: node.id,
        kind: node.kind,
        state: node.state,
        value:
          graphState === CapabilityGraphState.ready && node.state === CapabilityGraphNodeState.ready
            ? node.value
            : undefined,
        error: node.error
      })
    },
    get<T>(consumer: IGraphNodeId, provider: IGraphNodeId): T {
      const consumerNode = nodesById.get(consumer)
      if (graphState === CapabilityGraphState.starting)
        throw fail(CapabilityGraphErrorCode.admissionClosed)
      if (graphState === CapabilityGraphState.quiescing)
        throw fail(CapabilityGraphErrorCode.admissionClosed)
      if (graphState === CapabilityGraphState.terminal)
        throw fail(CapabilityGraphErrorCode.graphDisposed)
      if (!consumerNode || !consumerNode.dependencies.some((edge) => edge.provider === provider))
        throw fail(CapabilityGraphErrorCode.providerUnavailable, { consumer, provider })
      const providerNode = nodesById.get(provider)
      if (!providerNode || providerNode.state !== CapabilityGraphNodeState.ready)
        throw fail(CapabilityGraphErrorCode.providerUnavailable, { consumer, provider })
      return providerNode.value as T
    },
    get nodes() {
      return Object.freeze(nodeOrder.map((node) => node.id))
    },
    get state() {
      return graphState
    },
    get error() {
      return graphError
    },
    dispose
  }
}
