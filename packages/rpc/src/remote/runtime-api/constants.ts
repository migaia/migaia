/** New application descriptions are isolated from the unchanged v1 remote contract schema. */
export const RUNTIME_API_SCHEMA_VERSION = 2

/** Only simple runtime request/stream calls inherit this deadline; core defaults stay unchanged. */
export const RUNTIME_API_DEFAULT_TIMEOUT_MS = 30_000

/** Cold accepted-directory observations use the existing reporter, not a thrown error code. */
export const RuntimeReportKind = {
  /** A replacement changed actual installed routes on the same logical connection. */
  contractDiff: 'runtime-contract-diff'
} as const

/** Automatic provide descriptor errors are stable, non-reflecting configuration diagnostics. */
export const RuntimeApiErrorText = {
  /** Factory admission rejects this value before bootstrap or physical resource acquisition. */
  defaultTimeoutInvalid: 'Runtime defaultTimeoutMs must be a positive finite number',
  /** A foreign origin without a negotiated node cannot safely begin a native forwarding route. */
  forwardOriginUnavailable: 'RPC forwarding origin node is unavailable',
  /** Descriptor compilation cannot read accessors or accept non-own/reserved callable paths. */
  provideInvalid: 'Runtime provide must contain valid own data methods or groups',
  /** A Peer chooses one explicit source, or the platform's verified automatic bootstrap. */
  sourceInvalid: 'Runtime Peer requires exactly one connection source',
  /** Safe identity is projected from explicit configuration or the verified platform bootstrap. */
  identityInvalid: 'Runtime Peer identity is invalid',
  /** A remote directory must satisfy the negotiated versioned application schema. */
  descriptionInvalid: 'Runtime method description is invalid',
  /** Whitelist admission refuses unknown methods without reflecting arbitrary input text. */
  methodUnavailable: 'Runtime method is not provided by this peer',
  /** Only scalar result normalization, never handler failures, opts in to this payload summary. */
  resultInvalid: 'Runtime request result must be portable',
  /** Only a successfully prepared package Peer carries its accepted directory receipt. */
  peerInvalid: 'Runtime Peer is not prepared by the canonical owner',
  /** Plugin registration labels are validated before any source is opened. */
  pluginNameInvalid: 'Runtime plugin name must be a non-empty string',
  /** Exposure is a copied unique whitelist of existing managed Feature providers. */
  exposeInvalid: 'Runtime plugin expose must contain unique plugin names',
  /** Directory construction never invokes an accessor or imports arbitrary Host members. */
  featureInvalid: 'Runtime plugin exposure requires own enumerable data methods',
  /** Two Features cannot silently select a winner for the same plugin.method route. */
  featureConflict: 'Runtime plugin features contain conflicting method names',
  /** Routing takes only a logical name or library instance id, never an OS pid. */
  targetInvalid: 'Runtime outlet target must be a non-empty string',
  /** Exact contribution retirement cannot select a same-name successor through an old handle. */
  targetUnknown: 'Runtime outlet target is not a live connection',
  /** Canonical indexes preserve all matches and reject ambiguity instead of selecting one. */
  targetAmbiguous: 'Runtime outlet target identifies multiple connections',
  /** Passive subscriptions admit only the five declared lifecycle events and actual callbacks. */
  eventInvalid: 'Runtime event subscription is invalid',
  /** Native mutations require an original spawn/create lease, never a local channel ownership claim. */
  controlBorrowed: 'Runtime target does not own native execution',
  /** Invalid grace or platform signal is rejected before command queue admission. */
  stopInvalid: 'Runtime stop configuration is invalid',
  /** Filters use only canonical states, source kinds and one explicit name discriminator. */
  filterInvalid: 'Runtime query filter is invalid',
  /** Host controls require the original catalog, synchronous resolver and this exact managed Host. */
  hostControlInvalid: 'Runtime host exposure requires its managed Host catalog and resolver'
} as const

/**
 * Applications use these scalar labels to identify process/thread Plugin and query metadata. A
 * label grants no Host slot or native execution authority; those belong to held resources.
 */
export const RuntimePluginKey = Object.freeze({ process: 'process', thread: 'thread' } as const)

/** This explicit whitelist entry alone enables the original reserved Host-control operations. */
export const RuntimePluginExpose = { host: 'host' } as const

/** Routes describe actual installed call capabilities, never inferred handler return shapes. */
export const RuntimeApiMode = {
  request: 'request',
  notify: 'notify',
  stream: 'stream'
} as const
export type RuntimeApiMode = (typeof RuntimeApiMode)[keyof typeof RuntimeApiMode]

/** Advanced declarations narrow registration; automatic methods describe installed routes. */
export const RuntimeApiModeSource = {
  declared: 'declared',
  generatedRoutes: 'generated-routes'
} as const
export type RuntimeApiModeSource = (typeof RuntimeApiModeSource)[keyof typeof RuntimeApiModeSource]

/** Source configuration and connection direction are separate local query axes. */
export const RuntimeSourceKind = { spawn: 'spawn', connect: 'connect', listen: 'listen' } as const
export type RuntimeSourceKind = (typeof RuntimeSourceKind)[keyof typeof RuntimeSourceKind]

/** Automatic children report the trusted bootstrap direction, never a guessed parent role. */
export const RuntimeConnectionDirection = {
  spawned: 'spawned',
  spawnedBy: 'spawned-by',
  connect: 'connect',
  listen: 'listen'
} as const
export type RuntimeConnectionDirection =
  (typeof RuntimeConnectionDirection)[keyof typeof RuntimeConnectionDirection]

/** Query absence is explicit and portable across all supported output formats. */
export const RuntimeQueryStatus = {
  unavailable: 'unavailable',
  ready: 'ready',
  closed: 'closed',
  departed: 'departed'
} as const

/** These reasons identify absent owner facts without exposing configuration or native errors. */
export const RuntimeQueryReason = {
  localUnit: 'local-execution-unit-not-observed',
  owner: 'owner-fact-not-available',
  health: 'native-health-fact-not-available',
  restarts: 'restart-count-not-observed',
  counters: 'canonical-counter-not-available',
  resources: 'native-resource-sampling-not-connected',
  /** The query's exact native unit left while its asynchronous sampler was running. */
  retired: 'selected-execution-unit-retired',
  /** Missing native APIs and OS permissions cannot be replaced with parent aggregate values. */
  native: 'native-resource-fact-not-available'
} as const

/** The native process handle exposes only the existing graceful SIGTERM operation. */
export const RuntimeProcessSignal = { graceful: 'SIGTERM' } as const

/** Native CPU time and event-loop utilization are distinct public resource dimensions. */
export const RuntimeResourceKind = { cpuTime: 'cpu-time', elu: 'elu' } as const

/** Metric denominators remain explicit instead of silently attributing endpoint totals to a peer. */
export const RuntimeMetricScope = {
  client: 'endpoint-client',
  unit: 'execution-unit',
  process: 'process',
  thread: 'thread'
} as const
/** CPU microseconds and ELU milliseconds remain separate dimensions; ratios are never CPU time. */
export const RuntimeMetricUnit = {
  calls: 'calls',
  bytes: 'bytes',
  microseconds: 'microseconds',
  milliseconds: 'milliseconds',
  ratio: 'ratio',
  checks: 'checks',
  restarts: 'restarts'
} as const

/** Registration departure is a channel fact; it does not fabricate a native exit status. */
export const RuntimeRecentKind = { departed: 'departed' } as const
/** Passive management events come only from original lifecycle and successful liquidation facts. */
export const RuntimeEventName = {
  ready: 'ready',
  exit: 'exit',
  degraded: 'degraded',
  restart: 'restart',
  liquidated: 'liquidated'
} as const
export type RuntimeEventName = (typeof RuntimeEventName)[keyof typeof RuntimeEventName]
/** Original scheduler timestamps are monotonic milliseconds, not wall-clock epoch time. */
export const RuntimeQueryClock = { scheduler: 'scheduler' } as const
import { RpcCapability } from '../../contract/index.js'

/** Existing custom roots can offer ordinary calls without promising a private Host admission scope. */
export const RUNTIME_API_BASE_CAPABILITIES = Object.freeze([
  RpcCapability.ping,
  RpcCapability.close,
  RpcCapability.abort,
  RpcCapability.stream,
  RpcCapability.batch,
  RpcCapability.runtimeApi,
  RpcCapability.forwardRoute
])

/** Atomic semantics are offered by the canonical assembly that actually borrows the Host owner. */
export const RUNTIME_API_CAPABILITIES = Object.freeze([
  ...RUNTIME_API_BASE_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.order,
  RpcCapability.group,
  RpcCapability.cancelBeforeStart,
  RpcCapability.outcome,
  RpcCapability.deadline,
  /** The canonical assembly now restores actual ArrayBuffer/Uint8Array business values. */
  RpcCapability.portableBinary
])

/** Recent lifecycle summaries have the design's fixed 100-record capacity per original owner. */
export const RuntimeQueryLimit = { recent: 100 } as const
