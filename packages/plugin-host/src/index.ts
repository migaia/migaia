import type { IPipelineDefinitions } from './pipeline-spec.ts'
import { readDefinedPluginDefinition } from './define-plugin.ts'
import { PluginHost as RuntimePluginHost } from './host-runtime.ts'
import type { IPluginHostRuntimeExtensions, IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostOptions } from './host-options-types.ts'

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
  TInstalled extends readonly import('./plugin-definition-types.ts').IPluginConstraint<any>[] =
    readonly [],
  TPipelines extends IPipelineDefinitions = Record<never, never>
> extends RuntimeHost<TDomainCore, TValue, TInstalled, TPipelines> {
  /**
   * Creates an empty Host. options.execution budgets default to 5000 ms each and may be overridden.
   * Invalid budgets/options fail before plugin hooks run; no plugin is installed by construction.
   * Own the resulting Host until its shared dispose() completion has been observed.
   */
  constructor(options: import('./host-options-types.ts').IPluginHostOptions<TPipelines> = {}) {
    super(options, readDefinedPluginDefinition)
  }
}

export {
  PluginHostDisposalNodeKind,
  readPluginHostDisposalProvenance,
  type IPluginHostDisposalNodeKind,
  type IPluginHostDisposalProvenance
} from './host-runtime.ts'
export { definePlugin, isDefinedPlugin } from './define-plugin.ts'
export { defineFeature } from './define-feature.ts'
export { readPluginDependencies, type IPluginDependency } from './dependency-reader.ts'
export { getPluginRuntimeIntegration } from './core.ts'
export type {
  IPluginRuntimeIntegration,
  IPluginRuntimeSharedSlot,
  IPluginRuntimeFeatureSnapshot
} from './core.ts'
export type { IPluginHostRuntimeExtensions } from './plugin-definition-types.ts'
export {
  defineHost,
  type IDefineHostOptions,
  type IHostCoreConstructionRequest,
  type IHostDomainCoreRequest,
  type IHostHandle
} from './define-host.ts'
export type { IPluginHostInstalledPlugins } from './host-runtime.ts'
export type { IPluginHostIdentity } from './host-identity-types.ts'
export {
  PluginHostStatus,
  PluginHostRegistrationLifecycle,
  type IPluginHostStatus,
  type IPluginHostRegistrationLifecycle
} from './state-constants.ts'

export { PluginHostErrorCode } from './error-code.ts'
export { default as ERROR_TEXT, PluginHostError } from './error-text.ts'
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
} from './plugin-inference-types.ts'
export type {
  IPlugin,
  IPluginConstraint,
  IDefinedPluginConstraint
} from './plugin-definition-types.ts'
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
} from './plugin-lifecycle-types.ts'
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
} from './plugin-handle-types.ts'
export type {
  IPluginInstaller,
  IPluginHostCore,
  IPluginHostCoreFor,
  IPluginHostCoreTypeInfo
} from './plugin-core-types.ts'
export type { IPluginHostErrorCode } from './error-code.ts'
export type { IPluginHostErrorDetail } from './error-types.ts'
export type {
  IPluginInstallFailureDetail,
  IPluginHostOptions,
  IPluginHostDiagnostic,
  IPipelineConfig
} from './host-options-types.ts'
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
} from './composition-types.ts'
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
} from './feature-types.ts'
export { asyncDisposeKey } from './symbols.ts'
export { isPluginHandleCurrent } from './plugin-handle.ts'

/** Public domain identity for errors emitted by plugin host lifecycle operations. */
export { PLUGIN_HOST_SOURCE } from './error-code.ts'

export { pipelineSpec } from './pipeline-spec.ts'
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
} from './pipeline-spec.ts'
