/** Stable stage ordinals keep Core dispatch numeric; name tables serve exported diagnostics. */
export const RpcProbeStage = Object.freeze({
  /** Endpoint lifecycle and admission observations. */ peer: 0,
  /** Logical application interactions. */ message: 1,
  /** Admitted semantic protocol envelopes. */ envelope: 2,
  /** Values after the selected codec. */ encoded: 3,
  /** Framer output and acceptance observations. */ frame: 4,
  /** Authentication-protected physical values. */ protected: 5,
  /** Actual native I/O observations when the adapter exposes them. */ carrier: 6
} as const)

/** Numeric stage ordinal corresponding to RpcProbeStageName. */
export type RpcProbeStage = (typeof RpcProbeStage)[keyof typeof RpcProbeStage]

/** Stage names also define the configuration vocabulary accepted by defineProbe and setStages. */
export const RpcProbeStageName = Object.freeze([
  'peer',
  'message',
  'envelope',
  'encoded',
  'frame',
  'protected',
  'carrier'
] as const)

/** Accepted configuration stage name from the stable stage-name table. */
export type IRpcProbeStageName = (typeof RpcProbeStageName)[number]

/** Direction ordinals distinguish physical traffic from endpoint-local lifecycle events. */
export const RpcProbeDirection = Object.freeze({
  /** Traffic leaving the endpoint. */ outbound: 0,
  /** Traffic entering the endpoint. */ inbound: 1,
  /** Owner-local lifecycle or admission observation. */ local: 2
} as const)

/** Numeric outbound, inbound or local observation direction. */
export type RpcProbeDirection = (typeof RpcProbeDirection)[keyof typeof RpcProbeDirection]

/** Export-time direction names correspond exactly to RpcProbeDirection ordinals. */
export const RpcProbeDirectionName = Object.freeze(['outbound', 'inbound', 'local'] as const)

/** Interaction-kind ordinals cover logical calls, streams, control and lifecycle observations. */
export const RpcProbeKind = Object.freeze({
  /** Result-bearing scalar call. */ request: 0,
  /** Scalar reply. */ response: 1,
  /** Notification without a remote result. */ notify: 2,
  /** Stream creation. */ streamOpen: 3,
  /** Stream value delivery. */ streamChunk: 4,
  /** Stream terminal observation. */ streamClose: 5,
  /** Cancellation control. */ cancel: 6,
  /** Other protocol control traffic. */ control: 7,
  /** Endpoint or connection lifetime event. */ lifecycle: 8
} as const)

/** Numeric interaction-kind ordinal used in live probe views. */
export type RpcProbeKind = (typeof RpcProbeKind)[keyof typeof RpcProbeKind]

/** Export-time kind names correspond exactly to RpcProbeKind ordinals. */
export const RpcProbeKindName = Object.freeze([
  'request',
  'response',
  'notify',
  'streamOpen',
  'streamChunk',
  'streamClose',
  'cancel',
  'control',
  'lifecycle'
] as const)

/** Outcome ordinals distinguish progress, admission and settlement without string hot paths. */
export const RpcProbeOutcome = Object.freeze({
  /** No progress outcome applies. */ none: 0,
  /** Local work was created. */ created: 1,
  /** Local sending completed. */ sent: 2,
  /** An inbound value was observed. */ received: 3,
  /** The owner accepted the operation. */ admitted: 4,
  /** Admission refused the operation. */ rejected: 5,
  /** The operation completed normally. */ settled: 6,
  /** The observed operation failed. */ failed: 7
} as const)

/** Numeric progress or settlement outcome used in probe views. */
export type RpcProbeOutcome = (typeof RpcProbeOutcome)[keyof typeof RpcProbeOutcome]

/** Export-time outcome names correspond exactly to RpcProbeOutcome ordinals. */
export const RpcProbeOutcomeName = Object.freeze([
  'none',
  'created',
  'sent',
  'received',
  'admitted',
  'rejected',
  'settled',
  'failed'
] as const)
