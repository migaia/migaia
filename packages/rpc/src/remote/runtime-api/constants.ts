/** New application descriptions are isolated from the unchanged v1 remote contract schema. */
export const RUNTIME_API_SCHEMA_VERSION = 2

/** Automatic provide descriptor errors are stable, non-reflecting configuration diagnostics. */
export const RuntimeApiErrorText = {
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
  /** Host controls require the original catalog, synchronous resolver and this exact managed Host. */
  hostControlInvalid: 'Runtime host exposure requires its managed Host catalog and resolver'
} as const

/** Each RPC module family alone may share its canonical PluginHost extension slot. */
export const RuntimePluginFamily = {
  process: Object.freeze({}),
  thread: Object.freeze({})
} as const

/** Direct Host publication uses these canonical platform keys throughout runtime assembly. */
export const RuntimePluginKey = { process: 'process', thread: 'thread' } as const

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
  resources: 'native-resource-sampling-not-connected'
} as const

/** Registration departure is a channel fact; it does not fabricate a native exit status. */
export const RuntimeRecentKind = { departed: 'departed' } as const
/** Original scheduler timestamps are monotonic milliseconds, not wall-clock epoch time. */
export const RuntimeQueryClock = { scheduler: 'scheduler' } as const
import { RpcCapability } from '../../contract/wire-constants.js'

/** Only these genuinely composed shared endpoint capabilities enter native bootstrap offers. */
export const RUNTIME_API_CAPABILITIES = Object.freeze([
  RpcCapability.ping,
  RpcCapability.close,
  RpcCapability.abort,
  RpcCapability.stream,
  RpcCapability.batch,
  RpcCapability.runtimeApi,
  RpcCapability.forwardRoute
])

/** Recent lifecycle summaries have the design's fixed 100-record capacity per original owner. */
export const RuntimeQueryLimit = { recent: 100 } as const
