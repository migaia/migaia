/**
 * `@migaia/serialize/core`：chunk/codec/parser contract、纯变换、错误类型、stream。
 *
 * 零包依赖、零 lifecycle、零宿主全局；timer 经 `scheduler` 注入、Encoding 经 `ITextEncoder`/`ITextDecoder` 注入（见 R-4）。
 * 本入口不 re-export registry（`createSerializeRegistry` 依赖 lifecycle）。
 */
export {
  SERIALIZE_TYPE_PATTERN,
  SerializeCodecError,
  assertSerializeType,
  isChunkShape,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeChunkType,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeScheduler,
  type ITextDecoder,
  type ITextEncoder
} from './types.js'

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
} from './errors.js'

export { base64ToBytes, bytesToBase64, streamBase64Chunks } from './base64.js'

export {
  collectStream,
  decodeStream,
  encodeStream,
  sliceByFrameBudget,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions
} from './stream.js'
