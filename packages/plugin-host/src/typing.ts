import { asyncDisposeKey, disposeKey } from './symbols.js'
import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type {
  IFeatureOutput,
  IFeatureReference,
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureRecordRequiredExpose
} from './feature-types.js'

/** Values accepted at every asynchronous plugin lifecycle boundary. */
export type IPluginAwaitable<T> = T | PromiseLike<T>
/** Plugin resource cleanup callback; a thenable is assimilated by the owning lifecycle scope. */
export type IPluginDisposer = () => IPluginAwaitable<void>
export type IPluginResource =
  | IPluginDisposer
  | { [asyncDisposeKey](): IPluginAwaitable<void> }
  | { [disposeKey](): void }

/** Generic structured detail carried by a PluginHost boundary error. */
export type IPluginHostErrorDetail = Readonly<Record<string, unknown>>

/**
 * Structured install-failure detail. Synchronous installation publishes an immutable snapshot; its
 * completion resolves to the final immutable rollback detail without mutating the published error,
 * so a translator can await cleanup deterministically.
 */
export type IPluginInstallFailureDetail = {
  readonly failedName: string
  readonly rollbackErrors: readonly unknown[]
  readonly completion?: Promise<IPluginInstallFailureDetail>
}

export type IPluginConfig = Record<string, unknown>

/** Functional installer signature carrying the Host pipeline payload axis. */
export type IPluginInstaller<
  TCore extends object,
  TExtension extends Record<string, unknown>,
  TValue = never,
  TConfig extends IPluginConfig = IPluginConfig
> = (
  core: TCore & IPluginHostCore<TValue, Record<PropertyKey, unknown>, TConfig>
) => IPluginAwaitable<TExtension>

/** Recursive readonly view exposed by the lazy configuration proxy. */
export type IReadonlyConfig<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: IReadonlyConfig<T[K]> }
    : T

export type IPluginLifecycleConfig<TConfig extends IPluginConfig = IPluginConfig> = {
  get(): IReadonlyConfig<TConfig>
}

/** Operation-scoped cancellation and deadline exposed to one plugin hook invocation. */
export type IPluginOperationContext = {
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
}

/** Registration-scoped lifetime signal that remains valid until logical revocation. */
export type IPluginRegistrationContext = {
  readonly signal: IAbortSignal
}

/** Disposal context passed to a V2 plugin dispose hook. */
export type IPluginDisposalContext = Readonly<{
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
}>

/** Plugin-facing config capability; TConfig is fixed by the plugin declaration. */
export type IPluginLifecycleCore<TConfig extends IPluginConfig = IPluginConfig> = {
  readonly config: IPluginLifecycleConfig<TConfig>
  readonly operation: IPluginOperationContext
  readonly lifecycle: IPluginRegistrationContext
}

/**
 * 错误码已迁至 `./error-code.ts`（`docs/contracts/error-codes.md` §3.5 要求每包在 `src/error-code.ts` 单点声明）。此处
 * re-export 仅为保持既有导入路径可用，码值未变；新代码请直接从 `./error-code` 导入。
 */
export { PluginHostErrorCode, type IPluginHostErrorCode } from './error-code.js'

// 本文件自身也引用该类型（见 IPluginHostOptions.diagnostic）；re-export 不会把名字带进本地作用域。
import type { IPluginHostErrorCode } from './error-code.js'
import { PluginHostPipelineMode } from './state-constants.js'
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED
} from '@migaia/middleware-pipeline'
import type { IMiddlewarePipelineContext } from '@migaia/middleware-pipeline'

export type IPipelineMode = (typeof PluginHostPipelineMode)[keyof typeof PluginHostPipelineMode]
export type IPipelineConfig = { mode?: IPipelineMode }
/** Explicit generator return value for a final `undefined` payload. */
/**
 * Generator signals are re-exported from middleware-pipeline so adapters and runners share
 * identity.
 */
export { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED }
type IGeneratorUndefinedSignal<TValue> = undefined extends TValue
  ? typeof GENERATOR_UNDEFINED
  : never

/** 同步 stage。next() 必须在 stage 返回前调用；延迟调用会被忽略并告警。 */
export type ISyncPipelineStage<TValue> = (
  value: TValue,
  next: (value: TValue) => void,
  context?: IMiddlewarePipelineContext
) => void

export type IAsyncPipelineStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>,
  context?: IMiddlewarePipelineContext
) => void | Promise<void>

/** Generator stage yields zero or more intermediate values; last yielded value continues. */
export type IGeneratorPipelineStage<TValue> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => Generator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>

/** Async-generator stage：串行 drain 每个 stage，中间 yield 不会提前进入下一 stage。 */
export type IAsyncGeneratorPipelineStage<TValue> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => AsyncGenerator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>

/** 通用插件契约；具体应用通过 TCore 暴露自己的领域能力。 */
export type IPlugin<
  TCore,
  TExt extends Record<string, unknown> = Record<string, never>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = {
  readonly name: string
  readonly config?: TConfig
  readonly features?: TFeatures
  readonly featureExpose?: TExpose | ((core: TCore & IPluginLifecycleCore<TConfig>) => TExpose)
  readonly activation?: 'eager' | 'lazy'
  install: (
    core: TCore &
      IPluginLifecycleCore<TConfig> &
      Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>
  ) => IPluginAwaitable<TExt>
  update?: (
    next: IReadonlyConfig<TConfig>,
    core: TCore &
      IPluginLifecycleCore<TConfig> &
      Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>
  ) => IPluginAwaitable<void>
  /** Notification fired after installation and each later transition into the enabled state. */
  onEnable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  /** Notification fired after a transition into the disabled state; it owns no cleanup. */
  onDisable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  onDependencyReplaced?: (
    name: string,
    outputs: Readonly<Record<string, object>>
  ) => IPluginAwaitable<void>
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  [disposeKey]?: () => void
} & (TShared extends object ? unknown : never)

/** 用于约束插件元组，同时保留每个插件自身的精确泛型。 */
export type IPluginConstraint<
  TCore,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = {
  readonly name: string
  readonly config?: unknown
  readonly features?: TFeatures
  readonly featureExpose?: TExpose | ((core: TCore & IPluginLifecycleCore<any>) => TExpose)
  readonly activation?: 'eager' | 'lazy'
  install: (
    core: TCore &
      IPluginLifecycleCore<any> &
      Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>
  ) => IPluginAwaitable<Record<string, unknown>>
  update?: (
    next: never,
    core: TCore &
      IPluginLifecycleCore<any> &
      Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>
  ) => IPluginAwaitable<void>
  onEnable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  onDisable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  onDependencyReplaced?: (
    name: string,
    outputs: Readonly<Record<string, object>>
  ) => IPluginAwaitable<void>
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  [disposeKey]?: () => void
}

/** Extracts one candidate's native Feature roots without widening a tuple element. */
export type IPluginConstraintFeatures<TPlugin> =
  TPlugin extends IDefinedPluginConstraint<any, any, any, any, any, any, infer TFeatures, any>
    ? TFeatures
    : TPlugin extends { readonly features?: infer TFeatures extends IFeatureRecord }
      ? TFeatures
      : Record<never, never>

/** Extracts a candidate's expose value while preserving its concrete method surface. */
export type IPluginConstraintExpose<TPlugin> = TPlugin extends {
  readonly featureExpose: infer TExpose
}
  ? TExpose extends (...args: never[]) => infer TFactoryExpose
    ? TFactoryExpose extends object
      ? TFactoryExpose
      : never
    : TExpose extends object
      ? TExpose
      : never
  : Record<never, never>

/** Declared feature names for one concrete plugin definition. */
export type IPluginFeatureName<TPlugin> = Extract<keyof IPluginConstraintFeatures<TPlugin>, string>

/** Output produced by one named feature in a concrete plugin definition. */
export type IPluginFeatureOutput<
  TPlugin,
  TName extends IPluginFeatureName<TPlugin>
> = IFeatureOutput<IPluginConstraintFeatures<TPlugin>[TName]>

/** Plugin-scoped config surface exposed by a name-addressed handle. */
export type IPluginHandleConfig<TPlugin> = Readonly<{
  get(): IReadonlyConfig<IExtractPluginConfig<TPlugin>>
  update(
    recipe: (
      previous: IReadonlyConfig<IExtractPluginConfig<TPlugin>>
    ) => Partial<IExtractPluginConfig<TPlugin>>
  ): Promise<void>
}>

/** Public name-addressed plugin handle. */
export type IPluginHandle<TPlugin extends IPluginConstraint<any>> = Readonly<{
  readonly name: TPlugin['name']
  readonly extensions: Readonly<IExtractPluginExt<TPlugin>>
  getFeature<TKey extends IPluginFeatureName<TPlugin>>(
    name: TKey
  ): IPluginFeatureOutput<TPlugin, TKey>
  readonly config: IPluginHandleConfig<TPlugin>
}>

/** Input-order-preserving handles returned from one install batch. */
export type IPluginHandleTuple<TPlugins extends readonly IPluginConstraint<any>[]> = {
  readonly [K in keyof TPlugins]: TPlugins[K] extends IPluginConstraint<any>
    ? IPluginHandle<TPlugins[K]>
    : never
}

/** Structured logical removal result; cleanup failures remain observable. */
export type IPluginRemoval =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly errors: readonly unknown[] }>

/**
 * Host diagnostic outlet. `message` stays the human-readable line; `error`, when present, is the
 * exact contained error object so reporters can walk its `cause`/`errors` chain instead of parsing
 * text. Reporter failures are contained by the Host and never replace the reported primary.
 */
export type IPluginHostDiagnostic = (
  message: string,
  code?: IPluginHostErrorCode,
  error?: unknown
) => void

/** Dependency-aware removal/disable behavior. */
export type IPluginDependencyMutationOptions = Readonly<{
  readonly policy?: import('@migaia/capability/graph/dependency').DependencyPolicy
  readonly dryRun?: boolean
}>

/** One capability planner action projected onto a PluginHost registration name. */
export type IPluginDependencyPlanStep = Readonly<{
  readonly name: string
  readonly action: import('@migaia/capability/graph/dependency').DependencyAction
}>

/** Immutable dependency mutation plan returned by dry-run operations. */
export type IPluginDependencyPlan = Readonly<{
  readonly policy: import('@migaia/capability/graph/dependency').DependencyPolicy
  readonly order: readonly string[]
  readonly steps: readonly IPluginDependencyPlanStep[]
  readonly edges: readonly Readonly<{
    readonly provider: string
    readonly consumer: string
    readonly optional: boolean
    readonly status?: 'optional-absent'
  }>[]
}>

/** Validates every candidate against its own Feature/expose shape and the Host core. */
export type IPluginConstraintTuple<TCore, TPlugins extends readonly unknown[]> = {
  readonly [K in keyof TPlugins]: [TPlugins[K]] extends [never]
    ? IPluginConstraint<TCore>
    : IPluginConstraint<
        TCore,
        IPluginConstraintFeatures<TPlugins[K]>,
        IPluginConstraintExpose<TPlugins[K]>
      > &
        (TPlugins[K] extends { readonly [definedPluginBrand]: { readonly core: infer TRequired } }
          ? TRequired extends Record<string, never>
            ? unknown
            : TCore extends TRequired
              ? unknown
              : never
          : unknown)
}

/** Rejects one install tuple when any literal plugin name appears more than once. */
export type IUniquePluginNames<
  TPlugins extends readonly unknown[],
  TSeen extends string = never
> = number extends TPlugins['length']
  ? TPlugins
  : TPlugins extends readonly [infer THead, ...infer TTail]
    ? [THead] extends [never]
      ? readonly [THead, ...IUniquePluginNames<TTail, TSeen>]
      : THead extends { readonly name: infer TName extends string }
        ? string extends TName
          ? readonly [THead, ...IUniquePluginNames<TTail, TSeen>]
          : TName extends TSeen
            ? never
            : readonly [THead, ...IUniquePluginNames<TTail, TSeen | TName>]
        : never
    : readonly []

/** Feature fields injected into Plugin hooks from selected roots and one registration expose. */
export type IPluginFeatureCore<
  TFeatures extends IFeatureRecord,
  TExpose extends object & IFeatureRecordRequiredExpose<TFeatures>
> = Readonly<{
  readonly features: IFeatureOutputs<TFeatures>
  readonly featureExpose: TExpose
}>

/** Definition-time Feature options shared by functional and object Plugin declarations. */
export type IPluginFeatureOptions<
  TCore extends object,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object & IFeatureRecordRequiredExpose<TFeatures>
> = Readonly<{
  readonly features?: TFeatures
  readonly featureExpose?: TExpose | ((core: TCore & IPluginLifecycleCore<TConfig>) => TExpose)
}>

/** Opaque compile-time provenance carried by definitions made through `definePlugin`. */
declare const definedPluginBrand: unique symbol
export type IDefinedPluginConstraint<
  TCore extends object = object,
  TValue = never,
  TExtension extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  TName extends string = string,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = IPlugin<any, TExtension, TConfig, TShared, TFeatures, TExpose> &
  Readonly<{
    readonly name: TName
    getFeature<TKey extends Extract<keyof TFeatures, string>>(
      name: TKey
    ): IFeatureReference<IFeatureOutput<TFeatures[TKey]>, false>
    getFeature<TKey extends Extract<keyof TFeatures, string>>(
      name: TKey,
      options: Readonly<{ readonly optional: true }>
    ): IFeatureReference<IFeatureOutput<TFeatures[TKey]>, true>
    /** Required only in declarations; runtime authority remains the private WeakMap. */
    readonly [definedPluginBrand]: { readonly core: TCore; readonly value: TValue }
  }>

export type IExtractPluginExt<TPlugin> =
  TPlugin extends IPlugin<infer _TCore, infer TExt, infer _TConfig, infer _TShared>
    ? TExt
    : Record<string, never>

export type IExtractPluginConfig<TPlugin> = TPlugin extends { readonly config?: infer TConfig }
  ? TConfig extends IPluginConfig
    ? TConfig
    : IPluginConfig
  : IPluginConfig

type IPluginByName<TPlugins extends readonly unknown[], TName extends string> = Extract<
  TPlugins[number],
  { readonly name: TName }
>

/** Removes every plugin with one name from a compile-time installed tuple. */
export type IExcludePluginByName<
  TPlugins extends readonly IPluginConstraint<any>[],
  TName extends string
> = TPlugins extends readonly [infer THead, ...infer TTail]
  ? TTail extends readonly IPluginConstraint<any>[]
    ? THead extends { readonly name: TName }
      ? IExcludePluginByName<TTail, TName>
      : THead extends IPluginConstraint<any>
        ? readonly [THead, ...IExcludePluginByName<TTail, TName>]
        : IExcludePluginByName<TTail, TName>
    : readonly []
  : readonly []

/** Exact-registration token returned by disable; enabling restores the original tuple type. */
export type IPluginDisableToken<
  _THost,
  TPlugin extends IPluginConstraint<any>,
  _TInstalled extends readonly IPluginConstraint<any>[],
  _TDomainCore extends object,
  _TValue
> = Readonly<{
  readonly name: TPlugin['name']
  enable(): Promise<void>
}>

/** Host-side enablement surface; string enablement keeps a dynamic view type. */
export type IPluginEnablement<
  THost,
  TInstalled extends readonly IPluginConstraint<any>[],
  TDomainCore extends object,
  TValue
> = Readonly<{
  disable(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  disable(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<
    Readonly<{ readonly token: IPluginDisableToken<THost, any, TInstalled, TDomainCore, TValue> }>
  >
  enable(name: string): Promise<void>
  disabled(): readonly string[]
}>

export type IPluginHostConfigFor<TPlugins extends readonly unknown[]> = {
  get(path: string): unknown | undefined
  update<TName extends Extract<TPlugins[number], { readonly name: string }>['name']>(
    name: TName,
    recipe: (
      previous: IReadonlyConfig<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
    ) => Partial<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
  ): Promise<void>
  update(
    name: string,
    recipe: (previous: IReadonlyConfig<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
}

type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** 把一组插件提供的实例扩展合并成交叉类型。 */
export type IMergePluginExts<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginExt<TPlugins[number]>
>

/**
 * Interface required so fluent capabilities can use polymorphic `this` returns.
 *
 * PluginHost 向插件和业务宿主提供的通用能力。
 *
 * 业务侧只需将自己的领域字段与此类型做交叉，避免重复声明资源清理、配置和 pipeline 等宿主约定。
 */
export interface IPluginHostCore<
  TValue = never,
  _TLegacyShared extends object = Record<PropertyKey, unknown>,
  TConfig extends IPluginConfig = IPluginConfig
> {
  readonly config: IPluginLifecycleConfig<TConfig>
  readonly operation: IPluginOperationContext
  readonly lifecycle: IPluginRegistrationContext
  onDispose(resource: IPluginResource): void
  usePipeline(stage: ISyncPipelineStage<TValue>): this
  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this
  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorPipelineStage<TValue>): this
}

export type IPluginHostOptions = {
  /** Optional human-readable Host identity label; uniqueness is supplied by the runtime id. */
  readonly identity?: Readonly<{ readonly name?: string }>
  /** Explicit operation and pipeline drain budgets; `false` opts into unbounded waiting. */
  readonly execution: {
    /**
     * Maximum time for one admitted install, update, or removal hook; `false` waits without a
     * deadline.
     */
    readonly mutationTimeoutMs: number | false
    /**
     * Maximum time to drain active pipeline leases before logical removal continues; `false` waits
     * until zero.
     */
    readonly pipelineDrainTimeoutMs: number | false
  }
  pipeline?: IPipelineConfig
  diagnostic?: IPluginHostDiagnostic
  /**
   * Terminal sink for failures of `diagnostic` itself (it threw or rejected). Receives the exact
   * failure object; when absent, or when it throws too, the failure goes to the runtime's
   * `globalThis.reportError` if one exists. Never affects Host control flow.
   */
  onDiagnosticFailure?: (error: unknown) => void
  /** 时间域与排程来源（默认 lifecycle `systemScheduler`）；queue watchdog / dispose timeout 共用。 */
  scheduler?: ILifecycleScheduler
  /** 队列 admission 阈值。`undefined`：只诊断不拒绝；`false`：不建 timer、不诊断、不拒绝；`number`：超时出队并 reject。 */
  queueAdmissionTimeoutMs?: number | false
  /** `queueAdmissionTimeoutMs` 未配置时的诊断阈值；`false` 关闭诊断 timer。 */
  queueAdmissionDiagnosticMs?: number | false
  /** 单个 disposer 步的最大等待时间；`false` 表示永久等待（不触发 force）。 */
  disposeStepTimeoutMs?: number | false
}

/** Physical completion detail for work that outlives bounded logical disposal. */
export type IPluginHostPhysicalCleanupResult = Readonly<{
  readonly cleanupErrors: readonly unknown[]
}>

/** Structured logical terminal result; cleanup failures never reopen or reject the Host. */
export type IPluginHostDisposalResult = Readonly<{
  readonly logicalTerminal: true
  readonly cleanupComplete: boolean
  readonly cleanupErrors: readonly unknown[]
  readonly physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
}>

/** Opaque Host-owned ordering slot; callers may retain it but cannot inspect its ordinal. */
export type IPluginDataOrderSlot = Readonly<{ readonly __pluginDataOrderSlot: unique symbol }>

/** Opaque immutable admission snapshot produced by the PluginHost canonical factory. */
declare const pluginAdmissionBrand: unique symbol
export type IPluginAdmission<TPlugin extends IPluginConstraint<any>> = Readonly<{
  readonly [pluginAdmissionBrand]?: TPlugin
}>

/** One admission request for the composition integration boundary. */
export type IPluginAdmissionRequest = Readonly<{
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
  readonly slot: IPluginDataOrderSlot
}>

/** Opaque prepared candidate admission owned by one concrete PluginHost. */
export type IPluginPreparedAdmissions = object

/** Canonical name for the opaque token accepted by composition publication. */
export type IRegistrationToken<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  object & Readonly<{ readonly __plugin?: TPlugin }>

/** @deprecated Use IRegistrationToken from `@migaia/plugin-host/composition`. */
export type IPluginRegistrationReceipt<
  TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>
> = IRegistrationToken<TPlugin>

/** Narrow extension-only view for one live registration token. */
export type IRegistrationView<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  Readonly<{ readonly extensions: Readonly<IExtractPluginExt<TPlugin>> }>

/** Opaque exact registration batch prepared for logical removal. */
export type IPluginPreparedRemovalBatch = object

/** Canonical fence supplied by Graph before Host physical cleanup begins. */
export type IPluginBatchRemovalOptions = Readonly<{ readonly beforeCleanup?: PromiseLike<void> }>

/** Result of one prepared batch removal, preserving the Host dynamic-view contract. */
export type IPluginBatchRemovalLeaf = Readonly<{
  readonly receipt: IPluginRegistrationReceipt
  readonly name: string
  readonly cleanupComplete: boolean
  readonly cleanupErrors: readonly unknown[]
  readonly physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
}>

/** Aggregate result for one all-or-nothing prepared removal commit. */
export type IPluginBatchRemovalResult<TSnapshot> = Readonly<{
  readonly ok: boolean
  readonly committed: true
  readonly snapshot: TSnapshot
  readonly leaves: readonly IPluginBatchRemovalLeaf[]
  readonly cleanupComplete: boolean
  readonly cleanupErrors: readonly unknown[]
  readonly physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
}>

/** Internal composition snapshot; ordinary Host consumers receive name-addressed handles. */
export type IPluginHostCompositionSnapshot = Readonly<{
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  readonly config: IPluginHostConfigFor<readonly IPluginConstraint<any>[]>
}>

/** Host-owned integration used by a composition owner to perform total batch publication. */
export type IPluginHostCompositionIntegration<_THost> = Readonly<{
  readonly revision: number
  getCurrentSnapshot(): IPluginHostCompositionSnapshot
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): IPluginAdmission<TPlugin>
  createDataOrderSlot(name: string): IPluginDataOrderSlot
  prepareAdmissions(
    requestsInPublicationOrder: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions>
  commitPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): readonly IPluginRegistrationReceipt[]
  discardPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): Promise<IPluginHostPhysicalCleanupResult>
  retireDataOrderSlot(slot: IPluginDataOrderSlot): void
  prepareUnUseBatch(
    receiptsInCleanupOrder: readonly IPluginRegistrationReceipt[]
  ): IPluginPreparedRemovalBatch
  commitPreparedUnUseBatch<TView>(
    prepared: IPluginPreparedRemovalBatch,
    options: IPluginBatchRemovalOptions
  ): Promise<IPluginBatchRemovalResult<TView>>
}>
