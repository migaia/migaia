/** Source configuration and connection direction are separate local query axes. */
export const RpcMemberSourceKind = {
  /** Local source acquired through an owned launch operation. */ spawn: 'spawn',
  /** Local source acquired by connecting. */ connect: 'connect',
  /** Local source acquired by accepting connections. */ listen: 'listen'
} as const
/** Local source acquisition mode. */
export type RpcMemberSourceKind = (typeof RpcMemberSourceKind)[keyof typeof RpcMemberSourceKind]

/** Automatic children report the trusted bootstrap direction, never a guessed parent role. */
export const RpcMemberConnectionDirection = {
  /** This owner launched the remote unit. */ spawned: 'spawned',
  /** This owner is connected through the launching parent bootstrap. */ spawnedBy: 'spawned-by',
  /** This side initiated a connection. */ connect: 'connect',
  /** This side accepted a connection. */ listen: 'listen'
} as const
/** Actual native/bootstrap direction of this connection. */
export type RpcMemberConnectionDirection =
  (typeof RpcMemberConnectionDirection)[keyof typeof RpcMemberConnectionDirection]

/** Query absence is explicit and portable across all supported output formats. */
export const RpcMemberQueryStatus = {
  /** The actual owner cannot supply this fact. */ unavailable: 'unavailable',
  /** The connection is currently accepted and usable. */ ready: 'ready',
  /** The original owner completed terminal close. */ closed: 'closed',
  /** The accepted connection generation left. */ departed: 'departed'
} as const

/** These reasons identify absent owner facts without exposing configuration or native errors. */
export const RpcMemberQueryReason = {
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
export const RpcMemberResourceKind = { cpuTime: 'cpu-time', elu: 'elu' } as const

/** Metric denominators remain explicit instead of silently attributing endpoint totals to a peer. */
export const RpcMemberMetricScope = {
  client: 'endpoint-client',
  unit: 'execution-unit',
  process: 'process',
  thread: 'thread'
} as const
/** CPU microseconds and ELU milliseconds remain separate dimensions; ratios are never CPU time. */
export const RpcMemberMetricUnit = {
  calls: 'calls',
  bytes: 'bytes',
  microseconds: 'microseconds',
  milliseconds: 'milliseconds',
  ratio: 'ratio',
  checks: 'checks',
  restarts: 'restarts'
} as const

/** Registration departure is a channel fact; it does not fabricate a native exit status. */
export const RpcMemberRecentKind = { departed: 'departed' } as const
/** Passive management events come only from original lifecycle and successful liquidation facts. */
export const RpcMemberEventName = {
  /** A genuine connection generation became ready. */ ready: 'ready',
  /** An original execution unit exited. */ exit: 'exit',
  /** The original supervisor reported degradation. */ degraded: 'degraded',
  /** The original supervisor recorded a restart. */ restart: 'restart',
  /** The original supervisor entered a terminal state. */ terminal: 'terminal',
  /** Original control authority completed explicit liquidation. */ liquidated: 'liquidated'
} as const
/** Passive original lifecycle event name. */
export type RpcMemberEventName = (typeof RpcMemberEventName)[keyof typeof RpcMemberEventName]
/** Original scheduler timestamps are monotonic milliseconds, not wall-clock epoch time. */
export const RpcMemberQueryClock = { scheduler: 'scheduler' } as const

/** Original watch overflow and departure history share the prescribed100-record bound. */
export const RpcMemberQueryLimit = { recent: 100 } as const

/** Native capability family determines only the existing stop-signal option domain. */
export const RpcNativeMemberKind = {
  process: 'process',
  thread: 'thread',
  coroutine: 'coroutine'
} as const
export type RpcNativeMemberKind = (typeof RpcNativeMemberKind)[keyof typeof RpcNativeMemberKind]
/** The process launch owner supports only its existing graceful native signal. */
export const RpcMemberStopSignal = 'SIGTERM'
