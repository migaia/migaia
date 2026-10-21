/** Identifies the language-neutral wire protocol independently of the package version. */
export const RpcProtocol = {
  /** Stable protocol identity sent during negotiation. */
  id: 'migaia.rpc',
  /** Current incompatible wire generation; shared-major selection is required. */
  major: 1,
  /** Current additive wire revision advertised independently of package releases. */
  minor: 1
} as const

/** Names the semantic envelope forms that protocol 1.1 can carry. */
export const RpcEnvelopeKind = {
  /** Business invocation awaiting its matching response unless dispatched only. */
  request: 'request',
  /** Correlated success or failure of an ordinary request. */
  response: 'response',
  /** Application discovery query or response, distinguished by its route. */
  discovery: 'discovery',
  /** Control-subtype envelope whose payload is interpreted by its owner. */
  variation: 'variation',
  /** Credit-driven stream event envelope, separate from transport fragments. */
  stream: 'stream'
} as const
export type RpcEnvelopeKind = keyof typeof RpcEnvelopeKind

/** Keeps handshake messages outside the ordinary envelope namespace. */
export const RpcReservedKind = {
  /** Negotiation control, never an ordinary business envelope. */
  handshake: 'handshake'
} as const

/** Owns the control subtype names shared by contract and core. */
export const RpcControl = {
  /** Requests cancellation of correlated work when negotiated. */
  abort: 'abort',
  /** Requests a liveness response without a business invocation. */
  ping: 'ping',
  /** Replies to the corresponding liveness request. */
  pong: 'pong',
  /** Announces negotiated graceful connection closure. */
  close: 'close'
} as const
export type RpcControl = keyof typeof RpcControl

/** Negotiated capabilities allow senders to avoid features peers cannot understand. */
export const RpcCapability = {
  /** Permits remote cancellation messages when both peers offer support. */
  abort: 'abort@1',
  /** Permits the ping/pong liveness control pair. */
  ping: 'ping@1',
  /** Permits graceful close control independently of physical transport closure. */
  close: 'close@1',
  /** Permits bounded relative operation deadlines. */
  deadline: 'deadline@1',
  /** Permits ordinary request idempotency metadata. */
  idempotency: 'idempotency@1',
  /** Permits trace metadata without granting routing authority. */
  trace: 'trace@1',
  /** Permits the credit-driven stream protocol. */
  stream: 'stream@1',
  /** Enables the symmetric application directory only when both actual offers contain it. */
  runtimeApi: 'runtime-api@1',
  /** Independently negotiates signed Host routes and synchronous transparent-forward loop checks. */
  forwardRoute: 'forward-route@1',
  /**
   * Runtime tasks fence the accepted execution/session generation; declaration alone never enables
   * it.
   */
  generation: 'generation@1',
  /**
   * Provider-owned arrival ordering is available only after the complete shared admission port is
   * installed.
   */
  order: 'order@1',
  /**
   * A single task reserves all request steps before any provider starts; physical batch is
   * independent.
   */
  group: 'group@1',
  /**
   * The final provider arbitrates cancellation before its actual execution start in every supported
   * mode.
   */
  cancelBeforeStart: 'cancel-before-start@1',
  /** The final provider's original idempotency store exposes read-only pending/done/unknown lookup. */
  outcome: 'outcome@1',
  /** Restores Uint8Array/ArrayBuffer through the closed portable-binary manifest codec. */
  portableBinary: 'portable-binary@1',
  /** Complete native backing integrity is validated before the original auth replay commit. */
  nativeBinary: 'native-binary-authenticated-manifest@1',
  /** Actual clone-transfer carriers transfer only the caller's explicit original backings. */
  transfer: 'transfer@1',
  /** Optional physical grouping; it never introduces a semantic envelope kind. */
  batch: 'batch@1'
} as const

/** Physical wrapper fields are shared by native carriers and the negotiated JSON-RPC bridge. */
export const RpcBatchPhysical = {
  /** Outer physical wrapper discriminator, not a semantic envelope kind. */
  kind: 'batch',
  /** Field containing independently validated semantic members. */
  members: 'envelopes',
  /** Default complete physical-frame ceiling in bytes, including wrapper overhead. */
  maxBytes: 16 * 1024 * 1024
} as const

/** JSON is the mandatory codec available to every protocol 1.0 peer. */
export const RpcCodecId = {
  /** Mandatory interoperable codec baseline, even when optional codecs are offered. */
  json: 'json'
} as const

/** Common runtime labels aid diagnostics; the wire accepts other valid labels. */
export const RpcPeerRuntime = {
  /** Diagnostic label for Node.js peers. */
  node: 'node',
  /** Diagnostic label for Bun peers. */
  bun: 'bun',
  /** Diagnostic label for Deno peers. */
  deno: 'deno',
  /** Diagnostic label for Electron peers. */
  electron: 'electron',
  /** Diagnostic label for Python peers. */
  python: 'python',
  /** Diagnostic label for Rust peers. */
  rust: 'rust',
  /** Diagnostic label for Go peers. */
  go: 'go',
  /** Diagnostic label for Java peers. */
  java: 'java'
} as const

/** The data field holds one contract-owned route under this stable key. */
export const RpcRouteKey = 'route'

/** Distinguishes RPC routing metadata from application payload records. */
export const RpcRouteProfile = 'migaia.rpc.route'

/** The route type selects the legal optional fields in the contract validator. */
export const RpcRouteType = {
  /** Request route admitting dispatch, timeout, idempotency and trace metadata. */
  request: 'request',
  /** Response route requiring the original method. */
  response: 'response',
  /** Discovery query with optional manual intent. */
  discoveryQuery: 'discovery-query',
  /** Discovery response requiring the resolved target identity. */
  discoveryResponse: 'discovery-response',
  /** Control route requiring a bounded subtype token. */
  variation: 'variation',
  /** Stream-event route with an optional addressed receiver. */
  stream: 'stream'
} as const
export type RpcRouteType = (typeof RpcRouteType)[keyof typeof RpcRouteType]

/** Names every recognized route property for schema and validator agreement. */
export const RpcRouteField = {
  /** Identifies the closed routing grammar. */
  profile: 'profile',
  /** Selects the route-specific allowed fields. */
  type: 'type',
  /** Application-owned version label carried by every route. */
  applicationVersion: 'applicationVersion',
  /** Original sender identity for this route. */
  senderId: 'senderId',
  /** Intended target identity for this route. */
  targetId: 'targetId',
  /** Nonnegative safe-integer sending timestamp. */
  sentAt: 'sentAt',
  /** Optional addressed receiver identity. */
  receiverId: 'receiverId',
  /** Optional request intent without a business response. */
  dispatchOnly: 'dispatchOnly',
  /** Original method required by response routes. */
  method: 'method',
  /** Optional discovery intent. */
  manual: 'manual',
  /** Actual target resolved by discovery. */
  resolvedTargetId: 'resolvedTargetId',
  /** Optional discovery platform label. */
  platform: 'platform',
  /** Optional discovery acceptance result. */
  accepted: 'accepted',
  /** Optional response/discovery diagnostic text. */
  message: 'message',
  /** Discovery-response unregister notification. */
  operation: 'operation',
  /** Control-subtype token on a variation route. */
  variation: 'variation',
  /** Bounded relative request duration; no timer is created by this field. */
  timeoutMs: 'timeoutMs',
  /** Request identity token interpreted by the idempotency owner. */
  idempotencyKey: 'idempotencyKey',
  /** Bounded printable-ASCII request trace metadata. */
  trace: 'trace',
  /** Optional ordered origin and forwarding nodes, admitted only for runtime forward-route peers. */
  forwardRoute: 'forwardRoute'
} as const

/** Bounds untrusted identifiers, handshake input, and relative durations. */
export const RpcWireLimit = {
  /** Maximum UTF-16 length of ordinary wire identifiers. */
  maxIdentifierChars: 128,
  /** Maximum printable-ASCII trace length. */
  maxTraceChars: 256,
  /** Maximum request idempotency token length. */
  maxIdempotencyKeyChars: 128,
  /** Largest admitted relative duration in milliseconds. */
  maxDurationMs: 2_147_483_647,
  /** Maximum complete encoded handshake size before ordinary message limits apply. */
  maxHandshakeBytes: 65_536,
  /** Maximum distinct offered protocol versions. */
  maxVersions: 8,
  /** Maximum distinct offered codec identifiers. */
  maxCodecs: 16,
  /** Maximum distinct offered capability identifiers. */
  maxCapabilities: 64
} as const

/** Stable violation values let peers and tests identify the first envelope failure. */
export const RpcEnvelopeViolation = {
  /** An input property or reflection operation failed during snapshotting. */
  read: 'read',
  /** A value has the wrong structural or scalar domain. */
  type: 'type',
  /** The semantic envelope discriminator is unsupported. */
  unknownKind: 'unknownKind',
  /** A required field is absent. */
  required: 'required',
  /** A field falls outside a closed grammar. */
  unknownField: 'unknownField',
  /** Routing metadata violates its operation-specific grammar. */
  route: 'route',
  /** Business data violates portable or runtime payload policy. */
  payload: 'payload',
  /** An embedded serialized error fails its wire grammar. */
  error: 'error'
} as const
export type RpcEnvelopeViolation = keyof typeof RpcEnvelopeViolation

/** Negotiation rejects incompatible protocol identities or version sets. */
export const RpcHandshakeReason = {
  /** The protocol identity differs from the local protocol. */
  protocol: 'protocol',
  /** No compatible major-version pair can be selected. */
  version: 'version'
} as const
export type RpcHandshakeReason = keyof typeof RpcHandshakeReason

/** First-message roles are disjoint from ordinary envelope kinds. */
export const RpcHandshakeStep = {
  /** Initiator offer before ordinary traffic is admitted. */
  hello: 'hello',
  /** Responder selection from the actual offer. */
  accept: 'accept',
  /** Responder refusal with a bounded serialized reason. */
  reject: 'reject'
} as const
export type RpcHandshakeStep = keyof typeof RpcHandshakeStep

/** Stable failure fields identify which untrusted handshake boundary failed. */
export const RpcHandshakeViolation = {
  /** Reading untrusted handshake fields failed. */
  read: 'read',
  /** Input bytes are not valid handshake text or JSON. */
  encoding: 'encoding',
  /** The complete encoded handshake exceeds its byte ceiling. */
  bytes: 'bytes',
  /** A handshake field has the wrong domain. */
  type: 'type',
  /** A required handshake field is absent. */
  required: 'required',
  /** The step is unknown or inappropriate for the expected exchange. */
  step: 'step',
  /** Mandatory codec or runtime capability dependencies are missing. */
  baseline: 'baseline',
  /** An offered version, codec or capability is repeated. */
  duplicate: 'duplicate',
  /** A peer selected a value not permitted by the actual offer. */
  mismatch: 'mismatch'
} as const
export type RpcHandshakeViolation = keyof typeof RpcHandshakeViolation
