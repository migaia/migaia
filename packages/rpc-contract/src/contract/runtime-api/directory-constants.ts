/** New application descriptions are isolated from the unchanged v1 remote contract schema. */
export const RUNTIME_API_SCHEMA_VERSION = 2

/** Routes describe actual installed call capabilities, never inferred handler return shapes. */
export const RuntimeApiMode = {
  /** Scalar invocation returning an application result. */ request: 'request',
  /** Notification whose Promise covers local sending. */ notify: 'notify',
  /** Iterable invocation with caller-owned iteration cleanup. */ stream: 'stream'
} as const
/** Actual request, notify or stream route capability. */
export type RuntimeApiMode = (typeof RuntimeApiMode)[keyof typeof RuntimeApiMode]

/** Advanced declarations narrow registration; automatic methods describe installed routes. */
export const RuntimeApiModeSource = {
  declared: 'declared',
  generatedRoutes: 'generated-routes'
} as const
export type RuntimeApiModeSource = (typeof RuntimeApiModeSource)[keyof typeof RuntimeApiModeSource]

/** Source configuration and connection direction are separate local query axes. */
export const RuntimeSourceKind = {
  /** Local source acquired through an owned launch operation. */ spawn: 'spawn',
  /** Local source acquired by connecting. */ connect: 'connect',
  /** Local source acquired by accepting connections. */ listen: 'listen'
} as const
/** Local source acquisition mode. */
export type RuntimeSourceKind = (typeof RuntimeSourceKind)[keyof typeof RuntimeSourceKind]

/** Automatic children report the trusted bootstrap direction, never a guessed parent role. */
export const RuntimeConnectionDirection = {
  /** This owner launched the remote unit. */ spawned: 'spawned',
  /** This owner is connected through the launching parent bootstrap. */ spawnedBy: 'spawned-by',
  /** This side initiated a connection. */ connect: 'connect',
  /** This side accepted a connection. */ listen: 'listen'
} as const
/** Actual native/bootstrap direction of this connection. */
export type RuntimeConnectionDirection =
  (typeof RuntimeConnectionDirection)[keyof typeof RuntimeConnectionDirection]

/** Query absence is explicit and portable across all supported output formats. */
export const RuntimeQueryStatus = {
  /** The actual owner cannot supply this fact. */ unavailable: 'unavailable',
  /** The connection is currently accepted and usable. */ ready: 'ready',
  /** The original owner completed terminal close. */ closed: 'closed',
  /** The accepted connection generation left. */ departed: 'departed'
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
  /** A genuine connection generation became ready. */ ready: 'ready',
  /** An original execution unit exited. */ exit: 'exit',
  /** The original supervisor reported degradation. */ degraded: 'degraded',
  /** The original supervisor recorded a restart. */ restart: 'restart',
  /** The original supervisor entered a terminal state. */ terminal: 'terminal',
  /** Original control authority completed explicit liquidation. */ liquidated: 'liquidated'
} as const
/** Passive original lifecycle event name. */
export type RuntimeEventName = (typeof RuntimeEventName)[keyof typeof RuntimeEventName]
/** Original scheduler timestamps are monotonic milliseconds, not wall-clock epoch time. */
export const RuntimeQueryClock = { scheduler: 'scheduler' } as const
