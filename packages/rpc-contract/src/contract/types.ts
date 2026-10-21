import type { ERROR_SOURCE, IRpcContractErrorCode } from './error-code.js'

/** Stable component descriptor shared by protocol, codec, and framer identities. */
export type IRpcDescriptor<TId extends string, TVersion extends number> = Readonly<{
  /** Stable lowercase component token; independent of the npm package version. */
  id: TId
  /** Positive safe-integer component revision agreed by its implementation. */
  version: TVersion
}>

/** Portable binary value represented without runtime-specific typed arrays. */
export type IRpcPortableBytes = Readonly<{
  /** Reserved portable binary discriminator; ordinary records cannot reuse this tag shape. */
  $rpc: 'bytes'
  /** Canonical unpadded base64url for the visible Uint8Array bytes. */
  base64url: string
}>
/** Codec-facing legacy wire values never contain a raw native buffer or view. */
export type IRpcWirePortableValue =
  | null
  | boolean
  | number
  | string
  | IRpcPortableBytes
  | readonly IRpcWirePortableValue[]
  | Readonly<{ [key: string]: IRpcWirePortableValue }>
/** Plain record domain after normalization; strict wire snapshots use frozen null-prototype copies. */
export type IRpcPortableRecord = Readonly<{ [key: string]: IRpcPortableValue }>
/** Normalized business-value domain; native leaves require independently negotiated binary support. */
export type IRpcPortableValue =
  | null
  | boolean
  | number
  | string
  /** Native values exist only inside the independently negotiated portable-binary profile. */
  | ArrayBuffer
  | Uint8Array
  | IRpcPortableBytes
  | readonly IRpcPortableValue[]
  | IRpcPortableRecord

/** Serialized error graph retained across realm and transport boundaries. */
export type IRpcSerializedError = Readonly<{
  /** Original semantic owner, or the unknown fallback for an unclassified thrown value. */
  source: string
  /** Stable semantic code, kept separate from presentation text. */
  code: string
  /** Original error class name used when reconstructing a supported native Error family. */
  name: string
  /** Bounded display message; callers must not parse it for control decisions. */
  message: string
  /** Sender stack retained across the boundary, rather than regenerated at the receiver. */
  stack: string
  /** Optional recursively serialized primary cause. */
  cause?: IRpcSerializedError
  /** Optional nonempty ordered child list for aggregate failures. */
  errors?: readonly IRpcSerializedError[]
  /** Optional admitted portable diagnostic data, without native backing references. */
  data?: IRpcWirePortableValue
  /** Bounded node-only route diagnostics accompany transparent-forward failures. */
  route?: readonly string[]
  /** Present when some original graph or text content could not fit or be safely represented. */
  truncated?: true
}>

/** Unknown field policy used while validating a received error tree. */
export type IRpcWireErrorOptions = Readonly<{
  /** Defaults to reject; ignore permits additive fields while omitting them from the result. */
  unknownFields?: 'reject' | 'ignore'
  /** Optional observer of additive fields; receives the JSON pointer and field name. */
  onUnknownField?: (pointer: string, field: string) => void
}>

/** Original failure retained when a hostile property or portable value cannot be read. */
export type IRpcWireErrorFailure = Readonly<{
  /** JSON pointer locating the field whose read or portable projection failed. */
  pointer: string
  /** Field involved in this reported failure, not a count of every truncation. */
  field: string
  /** Exact original failure retained for local diagnostics. */
  error: unknown
}>

/** Required sink for failures that the serializer can omit from a bounded payload. */
export type IRpcSerializeErrorOptions = Readonly<{
  /** Required observer of failed reads/projections; byte/text truncation need not call it. */
  report: (failure: IRpcWireErrorFailure) => void
}>

/** Presentation policy for one Error reference held by a protocol implementation. */
export type IRpcErrorWireSummary = Readonly<{
  /** Public-facing semantic code selected for this exact Error reference. */
  code: string
  /** Public-facing bounded message replacing internal presentation. */
  message: string
  /** Keep this node's existing serialized descendants instead of selecting the five-field summary. */
  preserveSerializedError?: true
}>

/** Caller-owned data maps select error presentation and diagnostics; they grant no runtime rights. */
export type IRpcErrorWireMetadata = Readonly<{
  /** Optional caller-owned presentation lookup; omission uses ordinary error projection. */
  summaries?: Pick<WeakMap<Error, IRpcErrorWireSummary>, 'get'>
  /** Optional route lookup for exact Error references; it grants no forwarding authority. */
  routes?: Pick<WeakMap<Error, readonly string[]>, 'get'>
}>

/** A deserializer can retain admitted routes in this actual map supplied by its caller. */
export type IRpcErrorWireRouteStore = Pick<WeakMap<Error, readonly string[]>, 'set'>

/** JSON-RPC error object carrying the canonical error payload in its data. */
export type IRpcJsonRpcErrorObject = Readonly<{
  /** JSON-RPC integer error code, independent of the semantic code inside the extension. */
  code: number
  /** Display message exposed by the JSON-RPC error object. */
  message: string
  /** Optional portable data, including the canonical migaiaWireError extension when present. */
  data?: IRpcWirePortableValue
}>

/** Optional warning hook for fields a protocol minor version may add later. */
export type IRpcEnvelopeOptions = Readonly<{
  /** Optional additive-field observer; omission silently ignores allowed unknown fields. */
  onUnknownField?: (pointer: string, field: string) => void
}>

/** Runtime protocol descriptor that normalizes untrusted semantic input. */
export type IRpcProtocol<
  TEnvelope extends object,
  TId extends string,
  TVersion extends number
> = IRpcDescriptor<TId, TVersion> &
  Readonly<{
    /** Validates/snapshots a semantic value or throws its contract owner's classified failure. */
    normalize: (value: unknown, options?: IRpcEnvelopeOptions) => TEnvelope
  }>

/** Encoded representation category used for codec/framer compatibility admission. */
export type IRpcEncodedType = 'unknown' | 'string' | 'uint8array'

/** Generic framing boundary; semantic contracts do not depend on a transport. */
export type IRpcFramer<
  TEncoded,
  TFrame,
  TId extends string,
  TVersion extends number
> = IRpcDescriptor<TId, TVersion> &
  Readonly<{
    /** Representation accepted before this framer cuts physical fragments. */
    inputEncodedType: IRpcEncodedType
    /** Representation emitted to the carrier; unknown may include native fragment records. */
    outputEncodedType: IRpcEncodedType
    /** Frames one encoded message, preserving context identity and enforcing construction limits. */
    frame: (value: TEncoded, context: IRpcFrameContext) => readonly TFrame[]
    /** Admits one fragment and returns pending, complete or a classified rejection. */
    accept: (frame: TFrame, context: IRpcFrameContext) => IRpcFrameAcceptResult<TEncoded>
    /** Releases retained assemblies/timers; later admission follows the framer's terminal rules. */
    close: (reason?: unknown) => void
  }>

/** Carrier-supplied assembly identity; it does not authenticate a remote sender by itself. */
export type IRpcFrameContext = Readonly<{
  /** Original connection/source namespace used to isolate otherwise equal message ids. */
  source: string
  /** Message identifier for framing and whole-message ingress correlation. */
  messageId: string
}>
/** Pure admission outcome; rejected carries an Error rather than throwing that framing failure. */
export type IRpcFrameAcceptResult<TEncoded> =
  | Readonly<{
      /** Assembly is retained but not yet complete. */
      status: 'pending'
    }>
  | Readonly<{
      /** All required fragments have been admitted in order. */
      status: 'complete'
      /** Reassembled encoded value, still awaiting semantic decoding/validation. */
      value: TEncoded
    }>
  | Readonly<{
      /** This physical message was rejected. */
      status: 'rejected'
      /** Classified framing/limit/expiry error for the caller to handle. */
      error: Error
    }>

/** Stable string fragment wire shape; `source` is supplied by the transport boundary. */
export type IRpcStringFrame = Readonly<{
  /** Fragment grammar discriminator; distinct from a semantic envelope kind. */
  kind: 'rpc.frame.v1'
  /** Stable message identifier shared by every fragment. */
  messageId: string
  /** Zero-based fragment position; native reassembly requires ordered delivery. */
  index: number
  /** Total fragment count, bounded before assembly retention. */
  count: number
  /** Complete string length in UTF-16 code units, matching the native string-framer quota. */
  length: number
  /** This fragment's string slice, not a separately encoded JSON document. */
  data: string
}>

/** Stable binary fragment wire shape used by binary transports. */
export type IRpcBinaryFrame = Readonly<{
  /** Native fragment grammar discriminator. */
  kind: 'rpc.frame.v1'
  /** Identifier shared by all fragments within one source namespace. */
  messageId: string
  /** Zero-based ordered fragment position. */
  index: number
  /** Bounded total fragment count. */
  count: number
  /** Complete message byte length declared before reassembly. */
  length: number
  /** This fragment's byte slice. */
  data: Uint8Array
}>

/** Resource limits applied before a framer allocates or retains fragment state. */
export type IRpcFramerOptions = Readonly<{
  /** Defaults to 16384 units: UTF-16 code units for strings, bytes for Uint8Array messages. */
  chunkBytes?: number
  /** Defaults to 16777216 units, with the same string/byte distinction as chunkBytes. */
  maxMessageBytes?: number
  /** Defaults to 4096 fragments per message; must be a positive safe integer. */
  maxChunks?: number
  /** Defaults to 67108864 retained units across assemblies; at least maxMessageBytes. */
  maxBufferedBytes?: number
  /** Defaults to 256 simultaneous source/message assemblies. */
  maxConcurrentMessages?: number
  /** Defaults to 30000 ms; positive safe-integer retention lifetime for an incomplete assembly. */
  assemblyTimeoutMs?: number
  /** Retained configuration option; current assembly expiry is driven by schedule, not this clock. */
  now?: () => number
  /** Optional timer admission callback; omission uses the host timeout path. */
  schedule?: (callback: () => void, delayMs: number) => unknown
  /** Optional cancellation for scheduled handles; omission uses the host timeout cancellation. */
  cancel?: (handle: unknown) => void
}>

/** Error shape used by callers that need a package code without replacing native Error. */
export type IRpcContractError = Error &
  Readonly<{
    /** Canonical contract-layer source, preserved alongside native Error subclasses. */
    source: typeof ERROR_SOURCE
    /** Semantic scenario from the canonical contract code table. */
    code: IRpcContractErrorCode
  }>
