/** Pure portable-value, error-projection and shape-diagnostic types; no legacy protocol or framer. */
import type { ERROR_SOURCE, IRpcContractErrorCode } from '../error-code.ts'

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
  /** Caller-owned exact-reference presentation; factories may mint only into this explicit map. */
  summaries?: Pick<WeakMap<Error, IRpcErrorWireSummary>, 'get' | 'set'>
  /** Optional route lookup for exact Error references; it grants no forwarding authority. */
  routes?: Pick<WeakMap<Error, readonly string[]>, 'get' | 'set'>
}>

/** Optional warning hook for fields a protocol minor version may add later. */
export type IRpcEnvelopeOptions = Readonly<{
  /** Optional additive-field observer; omission silently ignores allowed unknown fields. */
  onUnknownField?: (pointer: string, field: string) => void
}>

/** Error shape used by callers that need a package code without replacing native Error. */
export type IRpcContractError = Error &
  Readonly<{
    /** Canonical contract-layer source, preserved alongside native Error subclasses. */
    source: typeof ERROR_SOURCE
    /** Semantic scenario from the canonical contract code table. */
    code: IRpcContractErrorCode
  }>
