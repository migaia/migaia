/** Shared scalar budgets and diagnostics survive independently of obsolete wire profiles. */
/** A forward chain admits sixteen forwarding hosts after its originating node. */
const maxForwardHops = 16
/** Bounds untrusted identifiers, handshake input, and relative durations. */
export const RpcWireLimit = {
  /** Maximum configurable number of forwarding hosts, separate from the logical target. */
  maxForwardHops,
  /** Origin plus every forwarding host appear in one admitted forward route. */
  maxForwardRouteNodes: maxForwardHops + 1,
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

/** Shape errors retain the established bounded non-reflecting detail path. */
export const REMOTE_SHAPE_DETAIL_PATH_CHARS = 256
/** Directory method count retains the original aggregate catalog bound. */
export const RPC_DIRECTORY_METHOD_LIMIT = 4096
/** The existing remote segment spelling remains canonical for described method names. */
export const REMOTE_NAME_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,39}$'

/** Actual described method capabilities retain the original public domain. */
export const RuntimeApiMode = {
  /** Scalar invocation returning an application result. */ request: 'request',
  /** Notification whose Promise covers local sending. */ notify: 'notify',
  /** Iterable invocation with caller-owned iteration cleanup. */ stream: 'stream'
} as const
/** One admitted described route capability. */
export type RuntimeApiMode = (typeof RuntimeApiMode)[keyof typeof RuntimeApiMode]
/** Description records preserve whether capabilities were declared or generated. */
export const RuntimeApiModeSource = {
  declared: 'declared',
  generatedRoutes: 'generated-routes'
} as const
/** Origin of the actual described mode declaration. */
export type RuntimeApiModeSource = (typeof RuntimeApiModeSource)[keyof typeof RuntimeApiModeSource]

/** Preserve the original fixed placeholder without reflecting malformed declaration keys. */
export const RPC_INVALID_DECLARATION_SEGMENT = '<invalid-key>'
/** Retain the established provider identifier domain after removing its obsolete stream alias. */
export const RPC_PROVIDER_METHOD_MAX_CHARS = 100
/** Existing provider admission reserves this library-owned namespace independently of wire kinds. */
export const RPC_PROVIDER_RESERVED_NAMESPACE = 'migaia.remote.'
