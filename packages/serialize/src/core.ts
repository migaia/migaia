/**
 * `@migaia/serialize/core` exports chunk, codec, and parser contracts, pure transformations,
 * errors, and streams.
 *
 * Core's lifecycle dependency is limited to the cancellation leaf `@migaia/lifecycle/abort`. Timers
 * use an injected `scheduler`; encoding uses injected `ITextEncoder` and `ITextDecoder`
 * capabilities. This entry does not reexport the registry, which depends on other lifecycle leaves.
 * Packed consumers retain the required abort dependency closure and tree-shake unrelated lifecycle
 * modules.
 */
export {
  SERIALIZE_TYPE_PATTERN,
  SerializeCodecError,
  assertSerializeType,
  isChunkShape,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ITextDecoder,
  type ITextEncoder
} from './types.ts'

export {
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  type ISerializeErrorCode,
  type ISerializeTaggedError,
  type ISerializeTypeError,
  type ISerializeRangeError,
  type ISerializeLifecycleError,
  tagSerializeError,
  createSerializeError,
  createSerializeTypeError,
  createSerializeRangeError
} from './errors.ts'

export { base64ToBytes, bytesToBase64, streamBase64Chunks } from './base64.ts'
/** Portable policy consumers share the existing canonical alphabet and unused-bit checker. */
export { isCanonicalBase64url } from './base64.ts'

export {
  collectStream,
  decodeStream,
  encodeStream,
  sliceByFrameBudget,
  type ICollectStreamOptions,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions
} from './stream.ts'

export type { ISerializeChunkKind } from './format-constants.ts'
