/**
 * Main `@migaia/serialize` entry combining core, plugins, and registry exports.
 *
 * Core does not import this entry, preventing a dependency cycle. The registry depends on core and
 * lifecycle.
 */
export * from './core.ts'
export * from './plugins.ts'
export type {
  ICodec,
  ICodecEncodedType,
  ICodecValue,
  IPortableWalkerStrategy,
  IPortableBinaryResult
} from './codec.ts'
export { createPortableWalker } from './codec.ts'
export { emitOutput } from './output.ts'
export { chunkToBytes, chunkToText, createSerializeRegistry } from './registry.ts'
export type {
  ISerializeCleanupError,
  ISerializeRegistryOptions,
  ISerializeTimeoutDiagnostic
} from './registry.ts'
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
} from './format-constants.ts'
