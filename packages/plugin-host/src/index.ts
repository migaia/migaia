import { readDefinedPluginDefinition } from './define-plugin.js'
import { PluginHost as RuntimePluginHost } from './host-runtime.js'

/** Root functional Host configures the canonical runtime with trusted definition admission. */
export abstract class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly import('./typing.js').IPluginConstraint<any>[] = readonly []
> extends RuntimePluginHost<TDomainCore, TValue, TInstalled> {
  /** Installs the trusted reader while preserving the canonical Host runtime implementation. */
  constructor(options: import('./typing.js').IPluginHostOptions) {
    super(options, readDefinedPluginDefinition)
  }
}

export {
  PluginHostDisposalNodeKind,
  readPluginHostDisposalProvenance,
  type IPluginHostDisposalNodeKind,
  type IPluginHostDisposalProvenance
} from './host-runtime.js'
export { definePlugin } from './define-plugin.js'
export { setupHost } from './setup-host.js'
export type { IPluginHostInstalledPlugins } from './host-runtime.js'
export {
  PluginHostStatus,
  PluginHostPipelineMode,
  PluginHostRegistrationLifecycle,
  PluginHostPipelineViolation,
  type IPluginHostStatus,
  type IPluginHostPipelineMode,
  type IPluginHostRegistrationLifecycle,
  type IPluginHostPipelineViolation
} from './state-constants.js'
export { PluginHostErrorCode } from './typing.js'
export { default as ERROR_TEXT, PluginHostError } from './error-text.js'
export type { ILocaleKey } from './error-text.js'
export type {
  IExtractPluginExt,
  IExtractPluginConfig,
  IMergePluginExts,
  IMergePluginShared,
  IExtractPluginShared,
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginDisposer,
  IPluginAwaitable,
  IPluginInstaller,
  IDefinedPluginConstraint,
  IHostSetupContext,
  ISetupHostOptions,
  ISetupHostView,
  ISetupPluginHost,
  IPluginResource,
  IPluginHostConfigFor,
  IPluginLifecycleConfig,
  IPluginLifecycleCore,
  IPluginHostErrorCode,
  IPluginHostErrorDetail,
  IPluginInstallFailureDetail,
  IPluginHostCore,
  IPluginHostOptions,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IPluginDisposalContext,
  IPluginHostView,
  IPluginHostDynamicView,
  IPluginRemovalResult,
  IPluginHostDisposalResult,
  IPluginHostPhysicalCleanupResult,
  IPluginDataOrderSlot,
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginPreparedAdmissions,
  IPluginRegistrationReceipt,
  IPluginPreparedRemovalBatch,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginBatchRemovalLeaf,
  IPluginHostCompositionIntegration,
  IPipelineMode,
  IPipelineConfig,
  ISyncPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IAsyncGeneratorPipelineStage
} from './typing.js'
export { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing.js'
export {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator
} from './pipeline.js'
export { disposeKey, asyncDisposeKey } from './symbols.js'
export { invokeCaptured } from './invocation.js'
