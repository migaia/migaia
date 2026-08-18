/**
 * `@migaia/serialize` 主入口：聚合 re-export core / plugins / registry 三者。
 *
 * Core 不 import index（防循环）；registry 依赖 core + lifecycle。
 */
export * from './core.js';
export * from './plugins.js';
export { chunkToBytes, chunkToText, createSerializeRegistry } from './registry.js';
export type {
  ISerializeCleanupError,
  ISerializeRegistryOptions,
  ISerializeScheduler,
  ISerializeTimeoutDiagnostic
} from './registry.js';
export {
  SerializeChunkKind,
  SerializeOutput,
  SerializePhase,
  SerializeCleanupPolicy,
  SerializeCleanupKind,
  SerializePluginType,
  type ISerializeChunkKind,
  type ISerializeOutputFormat,
  type ISerializePhase,
  type ISerializeCleanupPolicy,
  type ISerializeCleanupKind,
  type ISerializePluginType
} from './format-constants.js';
