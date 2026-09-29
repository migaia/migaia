/** Identifies the language-neutral wire protocol independently of the package version. */
export const RpcProtocol = { id: 'migaia.rpc', major: 1, minor: 0 } as const

/** Names the semantic envelope forms that protocol 1.0 can carry. */
export const RpcEnvelopeKind = {
  request: 'request',
  response: 'response',
  discovery: 'discovery',
  variation: 'variation'
} as const
export type RpcEnvelopeKind = keyof typeof RpcEnvelopeKind

/** Keeps handshake messages outside the ordinary envelope namespace. */
export const RpcReservedKind = { handshake: 'handshake' } as const

/** Owns the control subtype names shared by contract and core. */
export const RpcControl = {
  abort: 'abort',
  ping: 'ping',
  pong: 'pong',
  close: 'close'
} as const
export type RpcControl = keyof typeof RpcControl

/** Negotiated capabilities allow senders to avoid features peers cannot understand. */
export const RpcCapability = {
  abort: 'abort@1',
  ping: 'ping@1',
  close: 'close@1',
  deadline: 'deadline@1',
  idempotency: 'idempotency@1',
  trace: 'trace@1'
} as const

/** JSON is the mandatory codec available to every protocol 1.0 peer. */
export const RpcCodecId = { json: 'json' } as const

/** Common runtime labels aid diagnostics; the wire accepts other valid labels. */
export const RpcPeerRuntime = {
  node: 'node',
  bun: 'bun',
  deno: 'deno',
  electron: 'electron',
  python: 'python',
  rust: 'rust',
  go: 'go',
  java: 'java'
} as const

/** The data field holds one contract-owned route under this stable key. */
export const RpcRouteKey = 'route'

/** Distinguishes RPC routing metadata from application payload records. */
export const RpcRouteProfile = 'migaia.rpc.route'

/** The route type selects the legal optional fields in the contract validator. */
export const RpcRouteType = {
  request: 'request',
  response: 'response',
  discoveryQuery: 'discovery-query',
  discoveryResponse: 'discovery-response',
  variation: 'variation'
} as const
export type RpcRouteType = (typeof RpcRouteType)[keyof typeof RpcRouteType]

/** Names every recognized route property for schema and validator agreement. */
export const RpcRouteField = {
  profile: 'profile',
  type: 'type',
  applicationVersion: 'applicationVersion',
  senderId: 'senderId',
  targetId: 'targetId',
  sentAt: 'sentAt',
  receiverId: 'receiverId',
  dispatchOnly: 'dispatchOnly',
  method: 'method',
  manual: 'manual',
  resolvedTargetId: 'resolvedTargetId',
  platform: 'platform',
  accepted: 'accepted',
  message: 'message',
  operation: 'operation',
  variation: 'variation',
  timeoutMs: 'timeoutMs',
  idempotencyKey: 'idempotencyKey',
  trace: 'trace'
} as const

/** Bounds untrusted identifiers, handshake input, and relative durations. */
export const RpcWireLimit = {
  maxIdentifierChars: 128,
  maxTraceChars: 256,
  maxIdempotencyKeyChars: 128,
  maxDurationMs: 2_147_483_647,
  maxHandshakeBytes: 65_536,
  maxVersions: 8,
  maxCodecs: 16,
  maxCapabilities: 64
} as const

/** Stable violation values let peers and tests identify the first envelope failure. */
export const RpcEnvelopeViolation = {
  read: 'read',
  type: 'type',
  unknownKind: 'unknownKind',
  required: 'required',
  unknownField: 'unknownField',
  route: 'route',
  payload: 'payload',
  error: 'error'
} as const
export type RpcEnvelopeViolation = keyof typeof RpcEnvelopeViolation

/** Negotiation rejects incompatible protocol identities or version sets. */
export const RpcHandshakeReason = { protocol: 'protocol', version: 'version' } as const
export type RpcHandshakeReason = keyof typeof RpcHandshakeReason

/** First-message roles are disjoint from ordinary envelope kinds. */
export const RpcHandshakeStep = {
  hello: 'hello',
  accept: 'accept',
  reject: 'reject'
} as const
export type RpcHandshakeStep = keyof typeof RpcHandshakeStep

/** Stable failure fields identify which untrusted handshake boundary failed. */
export const RpcHandshakeViolation = {
  read: 'read',
  encoding: 'encoding',
  bytes: 'bytes',
  type: 'type',
  required: 'required',
  step: 'step',
  baseline: 'baseline',
  duplicate: 'duplicate',
  mismatch: 'mismatch'
} as const
export type RpcHandshakeViolation = keyof typeof RpcHandshakeViolation
