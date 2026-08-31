import { asyncDisposeKey, disposeKey } from './symbols.js'
import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type { PluginHostError } from './error-text.js'

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
  TShared extends object = Record<string, never>
> = {
  readonly name: string
  readonly config?: TConfig
  /** 声明跨插件共享能力。共享函数优先使用箭头函数，确保它被提取、缓存或传递后 仍绑定当前插件实例；只有明确不访问插件实例状态时才使用普通函数。 */
  shared?: (core: TCore & IPluginLifecycleCore<TConfig>) => TShared
  install: (core: TCore & IPluginLifecycleCore<TConfig>) => IPluginAwaitable<TExt>
  update?: (
    next: IReadonlyConfig<TConfig>,
    core: TCore & IPluginLifecycleCore<TConfig>
  ) => IPluginAwaitable<void>
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  [disposeKey]?: () => void
}

/** 用于约束插件元组，同时保留每个插件自身的精确泛型。 */
export type IPluginConstraint<TCore> = {
  readonly name: string
  readonly config?: unknown
  shared?: (core: TCore & IPluginLifecycleCore<any>) => object
  install: (core: TCore & IPluginLifecycleCore<any>) => IPluginAwaitable<Record<string, unknown>>
  update?: (next: never, core: TCore & IPluginLifecycleCore<any>) => IPluginAwaitable<void>
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  [disposeKey]?: () => void
}

/** Opaque compile-time provenance carried by definitions made through `definePlugin`. */
declare const definedPluginBrand: unique symbol
export type IDefinedPluginConstraint<
  TCore extends object = object,
  TValue = never,
  TExtension extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  TName extends string = string
> = IPlugin<any, TExtension, TConfig, TShared> &
  Readonly<{
    readonly name: TName
    /** Required only in declarations; runtime authority remains the private WeakMap. */
    readonly [definedPluginBrand]: { readonly core: TCore; readonly value: TValue }
  }>

/** Functional setup context supplied only while Core construction is current. */
export type IHostSetupContext = Readonly<{
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
  onDispose(resource: IPluginResource): void
}>

/** Public structural view returned by asynchronous setup. */
export type ISetupHostOptions<
  TCore extends object,
  TPlugins extends readonly IDefinedPluginConstraint<TCore, TValue>[],
  TValue = never
> = Readonly<{
  readonly host: IPluginHostOptions
  readonly setupTimeoutMs: number | false
  readonly signal?: IAbortSignal
  readonly core: (context: IHostSetupContext) => IPluginAwaitable<TCore>
  readonly plugins?: TPlugins
}>

/** Structural Host surface exposed by setupHost; concrete runtime class stays private. */
export type ISetupPluginHost<TCore extends object, TValue = never> = Readonly<{
  readonly pipelineMode: IPipelineMode
  readonly revision: number
  getShared(key: PropertyKey): unknown
  getCurrentView(): IPluginHostDynamicView<ISetupPluginHost<TCore, TValue>>
  use<const TPlugins extends readonly IDefinedPluginConstraint<TCore, TValue>[]>(
    ...plugins: TPlugins
  ): Promise<IPluginHostView<ISetupPluginHost<TCore, TValue>, TPlugins>>
  usePipeline(stage: ISyncPipelineStage<TValue>): ISetupPluginHost<TCore, TValue>
  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): ISetupPluginHost<TCore, TValue>
  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): ISetupPluginHost<TCore, TValue>
  useAsyncGeneratorPipeline(
    stage: IAsyncGeneratorPipelineStage<TValue>
  ): ISetupPluginHost<TCore, TValue>
  dispose(): Promise<IPluginHostDisposalResult>
}>

/** Fully active immutable setup publication with explicit and ERM disposal. */
export type ISetupHostView<
  THost,
  _TCore extends object = object,
  _TValue = never,
  TPlugins extends readonly any[] = readonly []
> = Readonly<{
  readonly host: THost
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  readonly config: IPluginHostConfigFor<TPlugins>
  getShared(key: PropertyKey): unknown
  dispose(): Promise<IPluginHostDisposalResult>
  [asyncDisposeKey](): Promise<void>
}> &
  IPluginHostView<THost, TPlugins & readonly IPluginConstraint<any>[]>

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

export type IExtractPluginShared<TPlugin> =
  TPlugin extends IPlugin<infer _TCore, infer _TExt, infer _TConfig, infer TShared>
    ? TShared
    : Record<string, never>

/** 把一组插件声明的 shared 对象合并成交叉类型。 */
export type IMergePluginShared<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginShared<TPlugins[number]>
> &
  object

/**
 * Interface required so fluent capabilities can use polymorphic `this` returns.
 *
 * PluginHost 向插件和业务宿主提供的通用能力。
 *
 * 业务侧只需将自己的领域字段与此类型做交叉，避免重复声明 shared 读取、资源清理、配置和 pipeline 等宿主约定。
 */
export interface IPluginHostCore<
  TValue = never,
  TShared extends object = Record<PropertyKey, unknown>,
  TConfig extends IPluginConfig = IPluginConfig
> {
  readonly config: IPluginLifecycleConfig<TConfig>
  readonly operation: IPluginOperationContext
  readonly lifecycle: IPluginRegistrationContext
  getShared<TKey extends keyof TShared>(key: TKey): TShared[TKey] | undefined
  getShared(key: PropertyKey): unknown
  onDispose(resource: IPluginResource): void
  usePipeline(stage: ISyncPipelineStage<TValue>): this
  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this
  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorPipelineStage<TValue>): this
}

export type IPluginHostOptions = {
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
  diagnostic?: (message: string, code?: IPluginHostErrorCode) => void
  /** 时间域与排程来源（默认 lifecycle `systemScheduler`）；queue watchdog / dispose timeout 共用。 */
  scheduler?: ILifecycleScheduler
  /** 队列 admission 阈值。`undefined`：只诊断不拒绝；`false`：不建 timer、不诊断、不拒绝；`number`：超时出队并 reject。 */
  queueAdmissionTimeoutMs?: number | false
  /** `queueAdmissionTimeoutMs` 未配置时的诊断阈值；`false` 关闭诊断 timer。 */
  queueAdmissionDiagnosticMs?: number | false
  /** 单个 disposer 步的最大等待时间；`false` 表示永久等待（不触发 force）。 */
  disposeStepTimeoutMs?: number | false
}

/** Immutable publication view returned by V2 composition and removal operations. */
export type IPluginHostView<
  THost,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> = Readonly<{
  readonly host: THost
  readonly extensions: Readonly<IMergePluginExts<TInstalled>>
  readonly config: IPluginHostConfigFor<TInstalled>
  getShared<TKey extends keyof IMergePluginShared<TInstalled>>(
    key: TKey
  ): IMergePluginShared<TInstalled>[TKey] | undefined
  getShared(key: PropertyKey): unknown
  use<const TPlugins extends readonly IPluginConstraint<any>[]>(
    ...plugins: TPlugins
  ): Promise<IPluginHostView<THost, [...TInstalled, ...TPlugins]>>
  unUse<const TName extends IInstalledPluginName<TInstalled>>(
    name: TName
  ): Promise<IPluginRemovalResult<IPluginHostView<THost, IRemovePluginByName<TInstalled, TName>>>>
  unUse(name: string): Promise<IPluginRemovalResult<IPluginHostDynamicView<THost>>>
}>

/** Runtime-unknown view returned when a dynamic plugin name cannot be narrowed statically. */
export type IPluginHostDynamicView<THost> = Readonly<{
  readonly host: THost
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  readonly config: {
    get(path: string): unknown
    update(
      name: string,
      recipe: (previous: IReadonlyConfig<IPluginConfig>) => Partial<IPluginConfig>
    ): Promise<void>
  }
  getShared(key: PropertyKey): unknown
  use(...plugins: readonly IPluginConstraint<any>[]): Promise<IPluginHostDynamicView<THost>>
  unUse(name: string): Promise<IPluginRemovalResult<IPluginHostDynamicView<THost>>>
}>

/** Structured result for logical removal and any cleanup errors. */
export type IPluginRemovalResult<TView> =
  | Readonly<{
      ok: true
      removed: boolean
      view: TView
      cleanupComplete: boolean
      cleanupErrors: readonly unknown[]
      physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
    }>
  | Readonly<{
      ok: false
      removed: boolean
      view: TView
      error: PluginHostError
      cleanupComplete: boolean
      cleanupErrors: readonly unknown[]
      physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
    }>

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
export type IPluginBatchRemovalResult<TView> = Readonly<{
  readonly ok: boolean
  readonly committed: true
  readonly view: TView
  readonly leaves: readonly IPluginBatchRemovalLeaf[]
  readonly cleanupComplete: boolean
  readonly cleanupErrors: readonly unknown[]
  readonly physicalCompletion?: Promise<IPluginHostPhysicalCleanupResult>
}>

/** Host-owned integration used by a composition owner to perform total batch publication. */
export type IPluginHostCompositionIntegration<THost> = Readonly<{
  readonly revision: number
  getCurrentView(): IPluginHostDynamicView<THost>
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

type IInstalledPluginName<TInstalled extends readonly IPluginConstraint<any>[]> =
  TInstalled[number] extends infer TPlugin
    ? TPlugin extends { readonly name: infer TName extends string }
      ? TName
      : never
    : never

type IRemovePluginByName<
  TInstalled extends readonly IPluginConstraint<any>[],
  TName extends string
> = TInstalled extends readonly [infer THead, ...infer TTail]
  ? THead extends { readonly name: TName }
    ? TTail extends readonly IPluginConstraint<any>[]
      ? TTail
      : readonly []
    : TTail extends readonly IPluginConstraint<any>[]
      ? readonly [THead & IPluginConstraint<any>, ...IRemovePluginByName<TTail, TName>]
      : readonly []
  : readonly []
