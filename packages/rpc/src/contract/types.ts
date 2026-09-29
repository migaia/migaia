import type { ERROR_SOURCE, IRpcContractErrorCode } from './error-code.js'

/** Stable component descriptor shared by protocol, codec, and framer identities. */
export type IRpcDescriptor<TId extends string, TVersion extends number> = Readonly<{
  id: TId
  version: TVersion
}>

/** Portable binary value represented without runtime-specific typed arrays. */
export type IRpcPortableBytes = Readonly<{ $rpc: 'bytes'; base64url: string }>
export type IRpcPortableRecord = Readonly<{ [key: string]: IRpcPortableValue }>
export type IRpcPortableValue =
  | null
  | boolean
  | number
  | string
  | IRpcPortableBytes
  | readonly IRpcPortableValue[]
  | IRpcPortableRecord

/** Serialized error graph retained across realm and transport boundaries. */
export type IRpcSerializedError = Readonly<{
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: IRpcSerializedError
  errors?: readonly IRpcSerializedError[]
  data?: IRpcPortableValue
  truncated?: true
}>

/** Unknown field policy used while validating a received error tree. */
export type IRpcWireErrorOptions = Readonly<{
  unknownFields?: 'reject' | 'ignore'
  onUnknownField?: (pointer: string, field: string) => void
}>

/** Original failure retained when a hostile property or portable value cannot be read. */
export type IRpcWireErrorFailure = Readonly<{
  pointer: string
  field: string
  error: unknown
}>

/** Required sink for failures that the serializer can omit from a bounded payload. */
export type IRpcSerializeErrorOptions = Readonly<{
  report: (failure: IRpcWireErrorFailure) => void
}>

/** JSON-RPC error object carrying the canonical error payload in its data. */
export type IRpcJsonRpcErrorObject = Readonly<{
  code: number
  message: string
  data?: IRpcPortableValue
}>

/** Runtime protocol descriptor that normalizes untrusted semantic input. */
export type IRpcProtocol<
  TEnvelope extends IRpcPortableValue,
  TId extends string,
  TVersion extends number
> = IRpcDescriptor<TId, TVersion> & Readonly<{ normalize: (value: unknown) => TEnvelope }>

export type IRpcEncodedType = 'unknown' | 'string' | 'uint8array'

/** Generic framing boundary; semantic contracts do not depend on a transport. */
export type IRpcFramer<
  TEncoded,
  TFrame,
  TId extends string,
  TVersion extends number
> = IRpcDescriptor<TId, TVersion> &
  Readonly<{
    inputEncodedType: IRpcEncodedType
    outputEncodedType: IRpcEncodedType
    frame: (value: TEncoded, context: IRpcFrameContext) => readonly TFrame[]
    accept: (frame: TFrame, context: IRpcFrameContext) => IRpcFrameAcceptResult<TEncoded>
    close: (reason?: unknown) => void
  }>

export type IRpcFrameContext = Readonly<{
  source: string
  messageId: string
}>
export type IRpcFrameAcceptResult<TEncoded> =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'complete'; value: TEncoded }>
  | Readonly<{ status: 'rejected'; error: Error }>

/** Stable string fragment wire shape; `source` is supplied by the transport boundary. */
export type IRpcStringFrame = Readonly<{
  kind: 'rpc.frame.v1'
  messageId: string
  index: number
  count: number
  length: number
  data: string
}>

/** Stable binary fragment wire shape used by binary transports. */
export type IRpcBinaryFrame = Readonly<{
  kind: 'rpc.frame.v1'
  messageId: string
  index: number
  count: number
  length: number
  data: Uint8Array
}>

/** Resource limits applied before a framer allocates or retains fragment state. */
export type IRpcFramerOptions = Readonly<{
  chunkBytes?: number
  maxMessageBytes?: number
  maxChunks?: number
  maxBufferedBytes?: number
  maxConcurrentMessages?: number
  assemblyTimeoutMs?: number
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}>

/** Error shape used by callers that need a package code without replacing native Error. */
export type IRpcContractError = Error &
  Readonly<{
    source: typeof ERROR_SOURCE
    code: IRpcContractErrorCode
  }>
