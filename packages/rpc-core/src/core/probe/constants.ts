/** Stable stage ordinals keep Core dispatch numeric; name tables serve exported diagnostics. */
export const RpcProbeStage = Object.freeze({
  peer: 0,
  message: 1,
  envelope: 2,
  encoded: 3,
  frame: 4,
  protected: 5,
  carrier: 6
} as const)

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

export type IRpcProbeStageName = (typeof RpcProbeStageName)[number]

/** Direction ordinals distinguish physical traffic from endpoint-local lifecycle events. */
export const RpcProbeDirection = Object.freeze({ outbound: 0, inbound: 1, local: 2 } as const)

export type RpcProbeDirection = (typeof RpcProbeDirection)[keyof typeof RpcProbeDirection]

/** Export-time direction names correspond exactly to RpcProbeDirection ordinals. */
export const RpcProbeDirectionName = Object.freeze(['outbound', 'inbound', 'local'] as const)

/** Interaction-kind ordinals cover logical calls, streams, control and lifecycle observations. */
export const RpcProbeKind = Object.freeze({
  request: 0,
  response: 1,
  notify: 2,
  streamOpen: 3,
  streamChunk: 4,
  streamClose: 5,
  cancel: 6,
  control: 7,
  lifecycle: 8
} as const)

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
  none: 0,
  created: 1,
  sent: 2,
  received: 3,
  admitted: 4,
  rejected: 5,
  settled: 6,
  failed: 7
} as const)

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
