export {
  SERIALIZE_TYPE_PATTERN,
  SerializeError,
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
  type ISerializeRegistry
} from './types';

export { chunkToBytes, chunkToText, createSerializeRegistry } from './registry';

export { base64ToBytes, bytesToBase64, streamBase64Chunks } from './base64';

export {
  collectStream,
  decodeStream,
  encodeStream,
  sliceByFrameBudget,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions
} from './stream';

export { jsonParser, jsonPlugin, type IJsonPluginOptions } from './plugins/json';
