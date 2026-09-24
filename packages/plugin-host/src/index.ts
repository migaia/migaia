import { readDefinedPluginDefinition } from './define-plugin.js'
import { PluginHost as RuntimePluginHost } from './host-runtime.js'

/** Root functional Host configures the canonical runtime with trusted definition admission. */
export class PluginHost<
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
export { defineFeature } from './define-feature.js'
export {
  defineHost,
  type IDefineHostOptions,
  type IHostCoreConstructionRequest,
  type IHostDomainCoreRequest,
  type IHostHandle
} from './define-host.js'
export type { IPluginHostInstalledPlugins } from './host-runtime.js'
export type { IPluginHostIdentity } from './host-identity.js'
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
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginHandle,
  IPluginHandleConfig,
  IPluginHandleTuple,
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IDefinedPluginConstraint,
  IPluginFeatureCore,
  IPluginFeatureOptions,
  IPluginDisposer,
  IPluginAwaitable,
  IPluginInstaller,
  IPluginResource,
  IPluginHostConfigFor,
  IPluginLifecycleConfig,
  IPluginLifecycleCore,
  IPluginHostErrorCode,
  IPluginHostErrorDetail,
  IPluginInstallFailureDetail,
  IPluginHostCore,
  IPluginHostOptions,
  IPluginHostDiagnostic,
  IPluginEnablement,
  IPluginDisableToken,
  IExcludePluginByName,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IPluginDisposalContext,
  IPluginHostDisposalResult,
  IPluginHostPhysicalCleanupResult,
  IPluginDataOrderSlot,
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginPreparedAdmissions,
  IPluginRegistrationReceipt,
  IRegistrationToken,
  IRegistrationView,
  IPluginPreparedRemovalBatch,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginBatchRemovalLeaf,
  IPipelineMode,
  IPipelineConfig,
  ISyncPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IAsyncGeneratorPipelineStage
} from './typing.js'
export type {
  IFeature,
  IFeatureCore,
  IFeatureFactory,
  IFeatureInspection,
  IFeatureOutput,
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureReference,
  IFeatureDependency,
  IFeatureDependencyRecord,
  IFeatureRequiredExpose,
  IFeatureRecordRequiredExpose
} from './feature-types.js'
export { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing.js'
export {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator
} from './pipeline.js'
export { disposeKey, asyncDisposeKey } from './symbols.js'
export { invokeCaptured } from './invocation.js'
export { createRegistrationView } from './composition.js'
