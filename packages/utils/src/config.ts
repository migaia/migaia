/** Canonical config public entry: ownership, paths, readonly projection and the snapshot owner. */
export { CONFIG_DELETE, ConfigProfile } from './internal/config-contract.ts'
export type {
  IConfigProfile,
  IConfigRecord,
  IOwnedConfig,
  IConfigLimits,
  IOwnConfigOptions,
  IConfigPatch,
  IConfigPatchOptions,
  IConfigReadResult,
  IConfigMergeStrategies,
  IConfigConflictDecision,
  IConfigConflictContext,
  IConfigPathRule,
  IConfigCombineOptions
} from './internal/config-contract.ts'
export { parseConfigPath, readConfigPath } from './internal/config-path.ts'

export { ownConfig, patchConfig, combineConfig } from './internal/config-owned.ts'
export { readonlyConfig } from './internal/config-readonly.ts'
export { ConfigOwner } from './config-owner.ts'
export type {
  IConfigAsyncSource,
  IConfigDiffEntry,
  IConfigOwnerAsyncOptions,
  IConfigOwnerEnvOptions,
  IConfigOwnerOptions,
  IConfigOwnerParseOptions,
  IConfigOwnerPath,
  IConfigOwnerPathValue,
  IConfigOwnerWriteValue,
  IConfigSource,
  IConfigValidator,
  IConfigView,
  IMergedConfig
} from './config-owner.ts'
