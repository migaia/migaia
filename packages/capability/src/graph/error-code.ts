/** Stable source for capability graph errors and their registry rows. */
export const ERROR_SOURCE = '@migaia/capability/graph'

/** Stable error codes owned by `@migaia/capability/graph`. */
export const CapabilityGraphErrorCode = {
  /** Graph mutation/query reaches terminal state; create a new graph. */
  graphDisposed: 'GRAPH_DISPOSED',
  /** Registration is attempted after readiness froze the static registry. */
  graphFrozen: 'GRAPH_FROZEN',
  /** A node, dependency, or start result fails structural admission. */
  invalidNode: 'GRAPH_INVALID_NODE',
  /** A second node uses an already registered ID. */
  duplicateNode: 'GRAPH_DUPLICATE_NODE',
  /** A dependency names a provider absent from the frozen registry. */
  unknownProvider: 'GRAPH_UNKNOWN_PROVIDER',
  /** A consumer repeats the same provider edge. */
  duplicateEdge: 'GRAPH_DUPLICATE_EDGE',
  /** The required dependency graph contains a self-loop or cycle. */
  dependencyCycle: 'GRAPH_DEPENDENCY_CYCLE',
  /** A direct provider lookup is not declared and ready. */
  providerUnavailable: 'GRAPH_PROVIDER_UNAVAILABLE',
  /** A node start failed and the graph entered failed state. */
  startFailed: 'GRAPH_START_FAILED',
  /** Release of one or more graph-owned node resources failed. */
  disposeFailed: 'GRAPH_DISPOSE_FAILED',
  /** Startup or new work is rejected while the graph is quiescing. */
  admissionClosed: 'GRAPH_ADMISSION_CLOSED',
  /** Diagnostic or direct value query names an absent node; correct the id before retrying. */
  unknownNode: 'GRAPH_UNKNOWN_NODE',
  /** A lifecycle callback synchronously re-enters the same graph operation. */
  reentrantOperation: 'GRAPH_REENTRANT_OPERATION',
  /**
   * Factory options or ctx.own resource descriptors fail admission. Correct the input; ownership
   * failures retain the lifecycle native error on cause rather than reporting a closed graph.
   */
  invalidOption: 'GRAPH_INVALID_OPTION',
  /** A reject-policy mutation targets a node that still has required dependents. */
  nodeHasDependents: 'GRAPH_NODE_HAS_DEPENDENTS',
  /**
   * A dynamic-graph mutation waited behind an older mutation longer than `mutationAdmissionMs` and
   * was rejected without running. The lifecycle queue timeout stays on `cause`. Check for a stuck
   * predecessor (start that never settles, leaked binding lease) or raise the budget.
   */
  mutationAdmissionTimeout: 'GRAPH_MUTATION_ADMISSION_TIMEOUT',
  /**
   * `resume()` targets a dynamic-graph node that is not suspended. A state conflict, not a bad
   * option: suspend the node first, or skip the call when the node is already running.
   */
  nodeNotSuspended: 'GRAPH_NODE_NOT_SUSPENDED'
} as const

/** Graph error values shared by static lifecycle, dynamic composition, and pure-planner validation. */
export type ICapabilityGraphErrorCode =
  (typeof CapabilityGraphErrorCode)[keyof typeof CapabilityGraphErrorCode]
