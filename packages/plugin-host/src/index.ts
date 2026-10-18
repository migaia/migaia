import { readDefinedPluginDefinition } from './define-plugin.js'
import { PluginHost as RuntimePluginHost } from './host-runtime.js'
import type {
  IPluginHostRuntimeExtensions,
  IPluginHostOptions,
  IPluginConstraint
} from './typing.js'

/** The original constructor's optional slots are published only by its canonical extension owner. */
type IRuntimeHostConstructor = new <
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
>(
  options: IPluginHostOptions,
  trustedDefinitionReader?: ConstructorParameters<typeof RuntimePluginHost>[1]
) => RuntimePluginHost<TDomainCore, TValue, TInstalled> & IPluginHostRuntimeExtensions<TInstalled>

/** The value is the same runtime constructor; this type adds no wrapper or phantom instance state. */
const RuntimeHost: IRuntimeHostConstructor = RuntimePluginHost

/** Root functional Host configures the canonical runtime with trusted definition admission. */
export class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly import('./typing.js').IPluginConstraint<any>[] = readonly []
> extends RuntimeHost<TDomainCore, TValue, TInstalled> {
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
export { definePlugin, isDefinedPlugin } from './define-plugin.js'
export { defineFeature } from './define-feature.js'
export { readPluginDependencies, type IPluginDependency } from './dependency-reader.js'
export { getPluginRuntimeIntegration } from './core.js'
export type {
  IPluginRuntimeIntegration,
  IPluginRuntimeSharedSlot,
  IPluginRuntimeFeatureSnapshot
} from './core.js'
export type { IPluginHostRuntimeExtensions } from './typing.js'
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
  PluginHostRegistrationLifecycle,
  type IPluginHostStatus,
  type IPluginHostRegistrationLifecycle
} from './state-constants.js'

export { PluginHostErrorCode } from './typing.js'
export { default as ERROR_TEXT, PluginHostError } from './error-text.js'
export type {
  IExtractPluginExt,
  IExtractPluginConfig,
  IMergePluginExts,
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginConstraintTuple,
  IPluginHandle,
  IPluginHandleConfig,
  IPluginHandleTuple,
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IDefinedPluginConstraint,
  IPluginFeatureCore,
  IPluginFeatureName,
  IPluginFeatureOutput,
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
  IPluginHostCoreFor,
  IPluginHostCoreTypeInfo,
  IPluginHostOptions,
  IPluginHostDiagnostic,
  IPluginEnablement,
  IPluginDisableToken,
  IExcludePluginByName,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IPluginDisposalContext,
  IPluginBeforeReleaseContext,
  IPluginSetup,
  IPluginSetupContext,
  IPluginSetupOperation,
  IPluginHostDisposalResult,
  IPluginHostPhysicalCleanupResult,
  IPluginDataOrderSlot,
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginPreparedAdmissions,
  IRegistrationToken,
  IRegistrationView,
  IPluginPreparedRemovalBatch,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginBatchRemovalLeaf,
  IPipelineConfig
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
export { asyncDisposeKey } from './symbols.js'
export { isPluginHandleCurrent } from './plugin-handle.js'
