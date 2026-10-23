/**
 * Main `@migaia/serialize` entry combining core, plugins, and registry exports.
 *
 * Core does not import this entry, preventing a dependency cycle. The registry depends on core and
 * lifecycle.
 */
export * from './core.js'
export * from './plugins.js'
export type {
  ICodec,
  ICodecEncodedType,
  ICodecValue,
  IPortableWalkerStrategy,
  IPortableBinaryResult
} from './codec.js'
export { createPortableWalker } from './codec.js'
export { emitOutput } from './output.js'
export { chunkToBytes, chunkToText, createSerializeRegistry } from './registry.js'
export type {
  ISerializeCleanupError,
  ISerializeRegistryOptions,
  ISerializeTimeoutDiagnostic
} from './registry.js'
export {
  SerializeChunkKind,
  SerializeOutput,
  SerializeTextFormat,
  SerializePhase,
  SerializeCleanupPolicy,
  SerializeCleanupKind,
  SerializePluginType,
  type ISerializeChunkKind,
  type ISerializeOutputFormat,
  type ISerializeTextFormat,
  type ISerializePhase,
  type ISerializeCleanupPolicy,
  type ISerializeCleanupKind,
  type ISerializePluginType
} from './format-constants.js'
