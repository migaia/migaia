import type { IPipelineDefinitions } from './pipeline-spec.js'
import { readDefinedPluginDefinition } from './define-plugin.js'
import { PluginHost as RuntimePluginHost } from './host-runtime.js'
import type { IPluginHostRuntimeExtensions, IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostOptions } from './host-options-types.js'

/** The original constructor's optional slots are published only by its canonical extension owner. */
type IRuntimeHostConstructor = new <
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
>(
  options: IPluginHostOptions<TPipelines>,
  trustedDefinitionReader?: ConstructorParameters<typeof RuntimePluginHost>[1]
) => RuntimePluginHost<TDomainCore, TValue, TInstalled, TPipelines> &
  IPluginHostRuntimeExtensions<TInstalled>

/** The value is the same runtime constructor; this type adds no wrapper or phantom instance state. */
const RuntimeHost: IRuntimeHostConstructor = RuntimePluginHost

/**
 * Class entry for the canonical plugin runtime, with trusted definePlugin admission enabled.
 * Subclass it for domain capabilities or use defineHost() for a frozen owner handle. Mutations
 * retain the inherited FIFO, rollback, handle and bounded-cleanup contracts.
 */
export class PluginHost<
  TDomainCore extends object,
  TValue = never,
  TInstalled extends readonly import('./plugin-definition-types.js').IPluginConstraint<any>[] =
    readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> extends RuntimeHost<TDomainCore, TValue, TInstalled, TPipelines> {
  /**
   * Creates an empty Host. options.execution budgets default to 5000 ms each and may be overridden.
   * Invalid budgets/options fail before plugin hooks run; no plugin is installed by construction.
   * Own the resulting Host until its shared dispose() completion has been observed.
   */
  constructor(options: import('./host-options-types.js').IPluginHostOptions<TPipelines> = {}) {
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
export type { IPluginHostRuntimeExtensions } from './plugin-definition-types.js'
export {
  defineHost,
  type IDefineHostOptions,
  type IHostCoreConstructionRequest,
  type IHostDomainCoreRequest,
  type IHostHandle
} from './define-host.js'
export type { IPluginHostInstalledPlugins } from './host-runtime.js'
export type { IPluginHostIdentity } from './host-identity-types.js'
export {
  PluginHostStatus,
  PluginHostRegistrationLifecycle,
  type IPluginHostStatus,
  type IPluginHostRegistrationLifecycle
} from './state-constants.js'

export { PluginHostErrorCode } from './error-code.js'
export { default as ERROR_TEXT, PluginHostError } from './error-text.js'
export type {
  IExtractPluginExt,
  IExtractPluginConfig,
  IMergePluginExts,
  IPluginConstraintTuple,
  IPluginFeatureCore,
  IPluginFeatureName,
  IPluginFeatureOutput,
  IPluginFeatureOptions,
  IExcludePluginByName
} from './plugin-inference-types.js'
export type {
  IPlugin,
  IPluginConstraint,
  IDefinedPluginConstraint
} from './plugin-definition-types.js'
export type {
  IPluginConfig,
  IPluginDisposer,
  IPluginAwaitable,
  IPluginResource,
  IPluginLifecycleConfig,
  IPluginLifecycleCore,
  IPluginOperationContext,
  IPluginRegistrationContext,
  IPluginDisposalContext,
  IPluginBeforeReleaseContext,
  IPluginSetup,
  IPluginSetupContext,
  IPluginSetupOperation,
  IPluginHostDisposalResult,
  IPluginHostPhysicalCleanupResult
} from './plugin-lifecycle-types.js'
export type {
  IPluginHandle,
  IPluginHandleConfig,
  IPluginHandleTuple,
  IPluginRemoval,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginHostConfigFor,
  IPluginEnablement,
  IPluginDisableToken
} from './plugin-handle-types.js'
export type {
  IPluginInstaller,
  IPluginHostCore,
  IPluginHostCoreFor,
  IPluginHostCoreTypeInfo
} from './plugin-core-types.js'
export type { IPluginHostErrorCode } from './error-code.js'
export type { IPluginHostErrorDetail } from './error-types.js'
export type {
  IPluginInstallFailureDetail,
  IPluginHostOptions,
  IPluginHostDiagnostic,
  IPipelineConfig
} from './host-options-types.js'
export type {
  IPluginDataOrderSlot,
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginPreparedAdmissions,
  IRegistrationToken,
  IRegistrationView,
  IPluginPreparedRemovalBatch,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginBatchRemovalLeaf
} from './composition-types.js'
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

/** Public domain identity for errors emitted by plugin host lifecycle operations. */
export { PLUGIN_HOST_SOURCE } from './error-code.js'

export { pipelineSpec } from './pipeline-spec.js'
export type {
  IPipelineDefinitions,
  IPipelineSpecOptions,
  IPipelineSpec,
  IPipelinePayload,
  IPipelineMode,
  IPipelineStage,
  IPipelineRegistration,
  IPipelineScope,
  IPipelineStageHandle,
  IPipelineOwner,
  IPipelineRunResult
} from './pipeline-spec.js'
