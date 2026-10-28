/**
 * Public static graph contracts and construction; scheduling and node resources have separate
 * owners.
 */
import { StaticCapabilityGraph } from './static-graph.js'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { type IReleaseDescriptor } from '@migaia/lifecycle'
import { CapabilityGraphErrorCode } from './error-code.js'

import { CapabilityGraphErrorText } from './error-text.js'
import { createCapabilityGraphError } from './errors.js'
import {
  GraphBlockedReason,
  type ICapabilityGraphNodeState,
  type ICapabilityGraphState
} from './state-constants.js'

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

  return new StaticCapabilityGraph(onError)
}
