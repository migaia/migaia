import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import {
  createGenerationController,
  createLifecycleScope,
  createProvisionalScope,
  type IGenerationController,
  type IGenerationToken,
  type IReleaseContext,
  type IReleaseDescriptor
} from '@migaia/lifecycle'
import { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
import { invokeCapabilityReporter } from '../reporter.js'
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
  GraphBlockedReason,
  type ICapabilityGraphNodeState,
  type ICapabilityGraphState
} from './state-constants.js'
import { buildCapabilityTopology, TopologyInvalidReason } from './topology.js'

export { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
export { CAPABILITY_GRAPH_SOURCE, type ICapabilityGraphError } from './errors.js'
export {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  GraphBlockedReason,
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

/** A declared direct provider; static graphs admit required edges only. */
export type IGraphDependency = {
  /** Registered provider ID whose startup must finish before this consumer starts. */
  readonly provider: IGraphNodeId
  /** Must be true; optional edges belong to the dynamic graph entry. */
  readonly required: true
}

/** The primary resource returned by a node start. Its release is owned exactly once by Graph. */
export type IGraphNodeInstance<T> = {
  /** Published payload; its identity and mutability remain owned by the application. */
  readonly value: T
  /** Releases the primary resource after dependents; failures remain observable during disposal. */
  readonly release: (context: IGraphReleaseContext) => void | PromiseLike<void>
}

/** Release context passed to the primary node instance. */
export type IGraphReleaseContext = {
  /** Lifecycle-owned release signal; cleanup should cooperate with its cancellation state. */
  readonly signal: IAbortSignal
  /** Identity of the resource being released. */
  readonly nodeId: IGraphNodeId
  /** Sends secondary cleanup diagnostics without replacing the primary graph outcome. */
  readonly report: (error: unknown) => void
}

/** Startup context with direct-provider reads and provisional auxiliary ownership. */
export type IGraphStartContext = {
  /** Identity of the node whose start is currently running. */
  readonly nodeId: IGraphNodeId
  /** Graph-generation signal, cancelled by disposal; startup must cooperate to stop work. */
  readonly signal: INativeAbortSignal
  /** Reads a ready, declared direct provider while this start remains active; otherwise throws. */
  readonly get: <T = unknown>(provider: IGraphNodeId) => T
  /**
   * Provisionally owns an auxiliary resource, returning it unchanged. Startup failure rolls it
   * back; success transfers it to graph cleanup after the primary instance. The primary value must
   * not be the same resource. Invalid descriptors fail with GRAPH_INVALID_OPTION.
   */
  readonly own: <T>(resource: T, descriptor: IReleaseDescriptor) => T
}

/** Static node definition admitted before the first `ready()`. */
export type IGraphNodeDefinition<T> = {
  /** Unique nonempty ID, captured at registration. */
  readonly id: IGraphNodeId
  /** Nonempty application classification used in diagnostics, not dependency routing. */
  readonly kind: string
  /** Required direct-provider edges, snapshotted before startup and checked for duplicates. */
  readonly dependencies: readonly IGraphDependency[]
  /**
   * Creates one primary instance after providers are ready. Throws and rejections fail startup and
   * roll back acquired resources; a result arriving after disposal is released, not exposed.
   */
  readonly start: (
    context: IGraphStartContext
  ) => IGraphNodeInstance<T> | PromiseLike<IGraphNodeInstance<T>>
}

/**
 * Node diagnostic projection; static and dynamic graph owners define their own visibility and
 * snapshot behavior.
 */
export type IGraphNodeDiagnostic = {
  /** Registered node identity. */
  readonly id: IGraphNodeId
  /** Captured application classification. */
  readonly kind: string
  /** Resource lifecycle state; distinct from the whole graph's state. */
  readonly state: ICapabilityGraphNodeState
  /** Payload projection; static graphs expose it only while the whole graph is ready. */
  readonly value: unknown
  /** Retained node failure, or undefined when no failure is recorded. */
  readonly error: unknown
  /** Cause for a blocked node when dependency availability is responsible. */
  readonly reason?: GraphBlockedReason
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

/** Fixed dependency registry with one shared startup transaction and terminal resource cleanup. */
export type ICapabilityGraph = {
  /** Captures a node while open; malformed, duplicate, or post-ready registration throws. */
  register<T>(node: IGraphNodeDefinition<T>): void
  /**
   * Freezes registration and starts provider levels in order, with same-level starts concurrent.
   * Shares one Promise; failure rolls back acquired resources without implicit retry.
   */
  ready(): Promise<void>
  /**
   * Returns a frozen diagnostic record, retaining payload identity; unknown IDs throw
   * GRAPH_UNKNOWN_NODE.
   */
  nodeState(id: IGraphNodeId): IGraphNodeDiagnostic
  /**
   * Read the same value projection as nodeState without allocating a diagnostic. Existing nodes
   * return undefined until the whole graph is ready and after disposal; undefined is valid data. An
   * unknown id retains GRAPH_UNKNOWN_NODE. Payload identity and mutability stay caller-owned.
   */
  readValue<T = unknown>(id: IGraphNodeId): T | undefined
  /** Frozen registration-order ID snapshot; retained for diagnostics after disposal. */
  readonly nodes: readonly IGraphNodeId[]
  /** Whole-graph admission/startup/cleanup phase, independent of per-node state. */
  readonly state: ICapabilityGraphState
  /** Retained graph startup or disposal failure, otherwise undefined. */
  readonly error: unknown | undefined
  /**
   * Closes admission and value visibility immediately, then releases in reverse topology order.
   * Shares one Promise, including while pending. Release failures reject with traceable graph
   * errors, retaining existing graph-owned codes. A non-cooperative start can finish later and its
   * result is still released.
   */
  dispose(): Promise<void>
  /**
   * Reads a declared ready direct provider for a registered consumer. Startup or quiescence rejects
   * admission; terminal graphs and unavailable or undeclared providers throw graph errors.
   */
  get<T = unknown>(consumer: IGraphNodeId, provider: IGraphNodeId): T
}

/** Factory options are snapshotted before any lifecycle object is constructed. */
export type ICapabilityGraphOptions = {
  /**
   * Optional secondary diagnostic sink, captured once; reporter failure does not replace graph
   * results.
   */
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

/**
 * Creates a runtime-neutral static dependency owner; options default to an empty record and the
 * diagnostic sink is omitted by default. Register definitions before ready starts their resources.
 * Topology errors precede startup, startup failures roll back, and dispose permanently closes the
 * graph. Invalid or unreadable reporter options throw GRAPH_INVALID_OPTION during construction.
 */
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
    invokeCapabilityReporter(() => onError(error))
  }

  const root = createLifecycleScope({ errorPolicy: 'throw', report: reportError })
  const generations: IGenerationController = createGenerationController({
    onSuperseded: reportError
  })
  let currentGraphToken!: IGenerationToken
  let currentGraphSignal!: INativeAbortSignal

  const fail = (
    code: ICapabilityGraphErrorCode,
    detail?: Readonly<Record<string, unknown>>
  ): ICapabilityGraphError => createCapabilityGraphError(code, graphMessageFor(code), { detail })

  /** Resolve one actual registered node for the two public read-only projections. */
  const findNode = (id: IGraphNodeId): IAdmittedNode => {
    /** Unknown identifiers use the existing query error without acquiring any resource. */
    const node = nodesById.get(id)
    if (!node) throw fail(CapabilityGraphErrorCode.unknownNode, { id })
    return node
  }
  /** Visibility is shared by diagnostics and direct reads, with no mirrored value/lifecycle state. */
  const visibleValue = (node: IAdmittedNode): unknown =>
    graphState === CapabilityGraphState.ready && node.state === CapabilityGraphNodeState.ready
      ? node.value
      : undefined

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

  /** Derives ephemeral startup layers from the canonical topology's level and ordinal facts. */
  const assertKnownAndAcyclic = (): readonly (readonly IAdmittedNode[])[] => {
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
    /** Only this startup snapshot owns buckets; topology remains the edge and level authority. */
    const layers: IAdmittedNode[][] = []
    for (const node of topology.ordered) {
      const level = topology.level.get(node.id)!
      ;(layers[level] ??= []).push(admittedById.get(node.id)!)
    }
    return layers
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
    /** Identity lookup avoids rescanning every admitted auxiliary resource for the primary value. */
    const auxiliaryResources = new Set<unknown>()
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
            return typeof force === 'function'
              ? (context: Parameters<typeof force>[0]) =>
                  invokeLifecycleCallback(() => force(context))
              : force
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
      // The previous strict-equality scan never matched NaN; preserve that supported primitive case.
      if (!Number.isNaN(resource)) auxiliaryResources.add(resource)
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
          throw graphFailure(CapabilityGraphErrorCode.invalidOption, error, { nodeId: node.id })
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
      if (auxiliaryResources.has(value))
        throw fail(CapabilityGraphErrorCode.invalidNode, { nodeId: node.id })
      if (!generations.isCurrent(requestToken) || graphState !== CapabilityGraphState.starting) {
        try {
          await provisional.rollback()
        } finally {
          // Auxiliary failure cannot revoke ownership of an admitted late primary instance.
          releaseLateResult(node, result, releaseMethod, requestSignal)
        }
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

  /** Starts each level together, then settles its failures before rollback or the next level. */
  const startGraph = async (): Promise<void> => {
    graphState = CapabilityGraphState.starting
    try {
      const layers = assertKnownAndAcyclic()
      const request = generations.begin()
      currentGraphToken = request.token
      currentGraphSignal = request.signal
      /** Physical release order follows the full topology, independent of async completion. */
      let releaseOrder = 0
      for (const layer of layers) {
        if (graphState !== CapabilityGraphState.starting)
          throw fail(CapabilityGraphErrorCode.admissionClosed)
        for (const node of layer) {
          const blocked = node.dependencies.some(
            (edge) => nodesById.get(edge.provider)?.state !== CapabilityGraphNodeState.ready
          )
          if (blocked) {
            node.state = CapabilityGraphNodeState.blocked
            throw fail(CapabilityGraphErrorCode.providerUnavailable, { nodeId: node.id })
          }
        }
        /** AllSettled keeps each in-flight start observed and includes successful peers in rollback. */
        const results = await Promise.allSettled(
          layer.map((node) => startNode(node, ++releaseOrder))
        )
        /** Rejections retain ordinal order even when later nodes reject first. */
        const failures: unknown[] = []
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
        if (failures.length > 0)
          throw graphFailure(
            CapabilityGraphErrorCode.startFailed,
            attachSecondaryErrors(failures[0], failures.slice(1))
          )
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
      generations.dispose(fail(CapabilityGraphErrorCode.graphDisposed))
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
      /** Diagnostics and direct reads resolve the same canonical node. */
      const node = findNode(id)
      return Object.freeze({
        id: node.id,
        kind: node.kind,
        state: node.state,
        value: visibleValue(node),
        error: node.error
      })
    },
    /** Project data from the original node without creating or retaining a diagnostic object. */
    readValue<T>(id: IGraphNodeId): T | undefined {
      return visibleValue(findNode(id)) as T | undefined
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
