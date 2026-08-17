import { asyncDisposeKey, disposeKey } from './symbols.js';
import type { ILifecycleScheduler } from '@migaia/lifecycle';

/** 插件生命周期资源的清理函数。 */
export type IPluginDisposer = () => void | Promise<void>;
export type IPluginResource =
  | IPluginDisposer
  | { [asyncDisposeKey](): void | Promise<void> }
  | { [disposeKey](): void };

export type IPluginConfig = Record<string, unknown>;

export type IPluginLifecycleConfig<TConfig extends IPluginConfig = IPluginConfig> = {
  get(): Readonly<TConfig>;
};

/** Plugin-facing config capability; TConfig is fixed by the plugin declaration. */
export type IPluginLifecycleCore<TConfig extends IPluginConfig = IPluginConfig> = {
  readonly config: IPluginLifecycleConfig<TConfig>;
};

/**
 * 错误码已迁至 `./error-code.ts`（`docs/contracts/error-codes.md` §3.5 要求每包在 `src/error-code.ts` 单点声明）。此处
 * re-export 仅为保持既有导入路径可用，码值未变；新代码请直接从 `./error-code` 导入。
 */
export { PluginHostErrorCode, type IPluginHostErrorCode } from './error-code.js';

// 本文件自身也引用该类型（见 IPluginHostOptions.diagnostic）；re-export 不会把名字带进本地作用域。
import type { IPluginHostErrorCode } from './error-code.js';
import { PluginHostPipelineMode } from './state-constants.js';

export type IPipelineMode = (typeof PluginHostPipelineMode)[keyof typeof PluginHostPipelineMode];
export type IPipelineConfig = { mode?: IPipelineMode };
/** Explicit generator return value for a final `undefined` payload. */
export const GENERATOR_UNDEFINED = Symbol('plugin-host.generator-undefined');
export const GENERATOR_HALT = Symbol('plugin-host.generator-halt');
export const GENERATOR_CONTINUE = Symbol('plugin-host.generator-continue');
type IGeneratorUndefinedSignal<TValue> = undefined extends TValue
  ? typeof GENERATOR_UNDEFINED
  : never;

/** 同步 stage。next() 必须在 stage 返回前调用；延迟调用会被忽略并告警。 */
export type ISyncPipelineStage<TValue> = (value: TValue, next: (value: TValue) => void) => void;

export type IAsyncPipelineStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>
) => void | Promise<void>;

/** Generator stage yields zero or more intermediate values; last yielded value continues. */
export type IGeneratorPipelineStage<TValue> = (
  value: TValue
) => Generator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>;

/** 通用插件契约；具体应用通过 TCore 暴露自己的领域能力。 */
export type IPlugin<
  TCore,
  TExt extends Record<string, unknown> = Record<string, never>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>
> = {
  readonly name: string;
  readonly config?: TConfig;
  /** 声明跨插件共享能力。共享函数优先使用箭头函数，确保它被提取、缓存或传递后 仍绑定当前插件实例；只有明确不访问插件实例状态时才使用普通函数。 */
  shared?: (core: TCore & IPluginLifecycleCore<TConfig>) => TShared;
  install: (core: TCore & IPluginLifecycleCore<TConfig>) => TExt | Promise<TExt>;
  update?: (
    next: Readonly<TConfig>,
    core: TCore & IPluginLifecycleCore<TConfig>
  ) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
  [asyncDisposeKey]?: () => void | Promise<void>;
  [disposeKey]?: () => void;
};

/** 用于约束插件元组，同时保留每个插件自身的精确泛型。 */
export type IPluginConstraint<TCore> = {
  readonly name: string;
  readonly config?: unknown;
  shared?: (core: TCore & IPluginLifecycleCore<any>) => object;
  install: (
    core: TCore & IPluginLifecycleCore<any>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  update?: (next: never, core: TCore & IPluginLifecycleCore<any>) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
  [asyncDisposeKey]?: () => void | Promise<void>;
  [disposeKey]?: () => void;
};

export type IExtractPluginExt<TPlugin> =
  TPlugin extends IPlugin<infer _TCore, infer TExt, infer _TConfig, infer _TShared>
    ? TExt
    : Record<string, never>;

export type IExtractPluginConfig<TPlugin> = TPlugin extends { readonly config?: infer TConfig }
  ? TConfig extends IPluginConfig
    ? TConfig
    : IPluginConfig
  : IPluginConfig;

type IPluginByName<TPlugins extends readonly unknown[], TName extends string> = Extract<
  TPlugins[number],
  { readonly name: TName }
>;

export type IPluginHostConfigFor<TPlugins extends readonly unknown[]> = {
  get(path: string): unknown | undefined;
  update<TName extends Extract<TPlugins[number], { readonly name: string }>['name']>(
    name: TName,
    recipe: (
      previous: Readonly<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
    ) => Partial<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
  ): Promise<void>;
  update(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>;
};

type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never;

/** 把一组插件提供的实例扩展合并成交叉类型。 */
export type IMergePluginExts<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginExt<TPlugins[number]>
>;

export type IExtractPluginShared<TPlugin> =
  TPlugin extends IPlugin<infer _TCore, infer _TExt, infer _TConfig, infer TShared>
    ? TShared
    : Record<string, never>;

/** 把一组插件声明的 shared 对象合并成交叉类型。 */
export type IMergePluginShared<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginShared<TPlugins[number]>
> &
  object;

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
  readonly config: IPluginLifecycleConfig<TConfig>;
  getShared<TKey extends keyof TShared>(key: TKey): TShared[TKey] | undefined;
  getShared(key: PropertyKey): unknown;
  onDispose(resource: IPluginResource): void;
  usePipeline(stage: ISyncPipelineStage<TValue>): this;
  useAsyncPipeline(stage: IAsyncPipelineStage<TValue>): this;
  useGeneratorPipeline(stage: IGeneratorPipelineStage<TValue>): this;
}

/** Public Host protocol; excludes plugin lifecycle core capabilities. */
export type IPluginHostPublic<
  TDomainCore,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> = TDomainCore &
  IMergePluginExts<TInstalled> & {
    readonly config: IPluginHostConfigFor<TInstalled>;
    readonly pipelineMode: IPipelineMode;
    getShared<TKey extends keyof IMergePluginShared<TInstalled>>(
      key: TKey
    ): IMergePluginShared<TInstalled>[TKey] | undefined;
    getShared(key: PropertyKey): unknown;
    usePipeline(
      stage: ISyncPipelineStage<TValue>
    ): IPluginHostPublic<TDomainCore, TValue, TInstalled>;
    useAsyncPipeline(
      stage: IAsyncPipelineStage<TValue>
    ): IPluginHostPublic<TDomainCore, TValue, TInstalled>;
    useGeneratorPipeline(
      stage: IGeneratorPipelineStage<TValue>
    ): IPluginHostPublic<TDomainCore, TValue, TInstalled>;
    use<
      const TPlugins extends readonly IPluginConstraint<
        TDomainCore & IPluginHostCore<TValue, IMergePluginShared<TInstalled>>
      >[]
    >(
      ...plugins: TPlugins
    ): Promise<IPluginHostPublic<TDomainCore, TValue, [...TInstalled, ...TPlugins]>>;
    unUse(name: string): Promise<void>;
    dispose(): Promise<void>;
    [asyncDisposeKey]?: () => Promise<void>;
  };

/** Compatibility alias for the public Host protocol. */
export type IPluginHost<
  TDomainCore,
  TValue = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> = IPluginHostPublic<TDomainCore, TValue, TInstalled>;

export type IPluginHostOptions = {
  pipeline?: IPipelineConfig;
  diagnostic?: (message: string, code?: IPluginHostErrorCode) => void;
  /** 时间域与排程来源（默认 lifecycle `systemScheduler`）；queue watchdog / dispose timeout 共用。 */
  scheduler?: ILifecycleScheduler;
  /** 队列 admission 阈值。`undefined`：只诊断不拒绝；`false`：不建 timer、不诊断、不拒绝；`number`：超时出队并 reject。 */
  queueAdmissionTimeoutMs?: number | false;
  /** `queueAdmissionTimeoutMs` 未配置时的诊断阈值；`false` 关闭诊断 timer。 */
  queueAdmissionDiagnosticMs?: number | false;
  /** 单个 disposer 步的最大等待时间；`false` 表示永久等待（不触发 force）。 */
  disposeStepTimeoutMs?: number | false;
};
