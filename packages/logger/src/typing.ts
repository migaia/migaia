import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IFeatureRecord,
  IGeneratorPipelineStage,
  IMergePluginExts,
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginHostOptions,
  IPluginHostDisposalResult,
  IPluginHandleTuple,
  IPipelineConfig,
  IPipelineMode
} from '@migaia/plugin-host'
import type { ILifecycleScheduler } from '@migaia/lifecycle'

/**
 * 全局约定：能用 `type` 就不用 `interface`；所有类型别名以 `I` 开头， 用来在阅读代码时一眼区分"这是一个类型"还是"这是一个变量/类/函数"。 泛型参数（如
 * `P`、`T`）沿用 TS 社区惯例的单字母命名，不受此规则约束。
 */

// ---------------------------------------------------------------------------
// 日志条目本身
// ---------------------------------------------------------------------------

export type IErrorInfo = {
  name: string
  message: string
  stack?: string | undefined
  /**
   * 原始 Error 对象的引用，不是重新构造出来的。JSON 序列化场景下这个字段 会被 JSON.stringify 静默丢弃（Error 自身没有可枚举属性），不影响 JSON sink；
   * 但控制台/自定义 sink 如果想要一个真正的、堆栈可点击跳转、能传给 Sentry.captureException() 这类 API 的原生 Error 实例，就应该用这个字段，
   * 而不是上面的 message/stack 字符串——那两个只是为了可序列化而提取出来的投影。
   */
  raw: Error
}

/**
 * 核心不预设"日志级别"这类语义。`tag` 是一个通用字符串标签，具体含义完全由 安装的插件决定——level 插件用它表示 debug/info/warn/error/fatal，
 * reasoning 插件用它表示 thinking/response 等。这样核心本身保持插件无关。
 */
export type ILogEntry = {
  readonly id: string
  readonly tag: string
  readonly time: Date
  readonly message: string
  readonly args: readonly unknown[]
  // 显式写出 "| undefined"（而不是只用 ?:），是为了兼容调用方开启
  // `exactOptionalPropertyTypes: true` 的场景——那个模式下 `meta?: X` 和
  // `meta?: X | undefined` 是两种不同的类型，前者不允许显式传 undefined
  // （必须整个 key 都不出现），但 entry.meta 在代码里经常是从别处readonly
  // 透传过来的 `X | undefined`，不显式加上 `| undefined` 会导致
  // `{ meta: entry.meta }` 这种最常见的透传写法在严格模式下报类型错误。
  readonly meta?: Record<string, unknown> | undefined
  readonly context: readonly string[]
  readonly error?: IErrorInfo | undefined
  /**
   * 插件私有数据挂载点，避免不同插件互相踩踏字段。 例如 reasoning 插件用 `data.silent = true` 告诉 ansis 插件 "这条 entry 只是给
   * http/batch 之类的下游 sink 用的，不要打印到控制台"。
   */
  readonly data: Record<string, unknown>
}

/** 允许插件在 dispatch 时覆盖 entry 的任意字段（除了 id，由核心统一生成） */
export type IRawEntryInput = Partial<Omit<ILogEntry, 'id'>> & {
  tag: string
  message: string
}

/** 单次日志调用的调度策略，由发起调用的插件按自身配置传入。 */
export type ILogDispatchOptions = {
  asyncOutput?: boolean | undefined
}

// ---------------------------------------------------------------------------
// 管线 / 钩子 / sink 相关的函数签名
// ---------------------------------------------------------------------------

export type ILogFilter = (entry: ILogEntry) => boolean
export type IOff = () => void
export type ILogHookFn = (entry: ILogEntry) => void | Promise<void>
export type ISink = (entry: ILogEntry) => void | Promise<void>
/** An observed asynchronous logger failure. Business dispatch remains non-throwing. */
export type ILogFailure = {
  readonly source: 'defer' | 'hook' | 'sink' | 'pipeline' | 'flush' | 'forward' | 'shutdown'
  readonly error: unknown
}
export type ILogFailureHook = (failure: ILogFailure) => void
/** 类似 Koa 中间件：调用 next(entry) 才会继续往下传递，不调用即等于丢弃这条日志 */
export type IPipelineStage = (entry: ILogEntry, next: (entry: ILogEntry) => void) => void
export type IFlusher = () => void | Promise<void>
export type IShutdownReason = 'signal' | 'uncaughtException' | 'unhandledRejection' | 'manual'
export type IShutdownHandler = (reason: IShutdownReason) => void | Promise<void>

// ---------------------------------------------------------------------------
// 只读上下文：所有插件都能读到，但运行时真正冻结，插件写不进去
// ---------------------------------------------------------------------------

export type ILoggerEnv = {
  readonly isTTY: boolean
  readonly isCI: boolean
}

/** Plugin-facing config reader. It exposes only the current plugin's snapshot. */
export type ILoggerPluginConfig = {
  get<T extends IPluginConfig = IPluginConfig>(): Readonly<T>
}

/** Public logger config facade. It reads nested plugin config paths and updates plugins by name. */
export type ILoggerConfig = {
  get(path: string): unknown | undefined
  update<T extends IPluginConfig = IPluginConfig>(
    name: string,
    recipe: (previous: Readonly<T>) => Partial<T>
  ): Promise<void>
}

/**
 * 每个插件在 install(core) 时都能拿到 core.ctx，用来读取"当前 logger 是什么样子"—— 构造时传入的原始 options、子 logger
 * 的前缀链路、创建时间、运行环境信息。 这个对象在构造阶段就会被 Object.freeze（而且是逐层冻结，不只是浅冻结顶层），
 * 插件里任何写入尝试（`core.ctx.path.push(...)`、`core.ctx.options.x = 1`） 在严格模式下都会直接抛
 * TypeError，是运行时真正生效的只读，不只是 TS 类型层面的提示。
 */
export type ILoggerContext = {
  /**
   * 这个 logger 实例的全局唯一 id，构造时生成，一辈子不变。 extends() 的循环检测就是靠比较这个 id，不依赖 topic 字符串 （topic 可能为空、可能重名，id
   * 保证不会）。
   */
  readonly id: string
  readonly options: Readonly<Record<string, unknown>>
  readonly path: readonly string[]
  readonly topic: string
  readonly createdAt: Date
  readonly env: ILoggerEnv
}

// ---------------------------------------------------------------------------
// 插件规范：核心能力契约
// ---------------------------------------------------------------------------

/**
 * 插件通过 install(core) 拿到的核心能力集合，这就是"log 插件规范"本身—— 任何插件只要基于这几个原语实现，就能和其它插件组合使用，互相之间不需要
 * 知道对方的具体实现；跨插件能力通过声明式 Feature 依赖注入。
 */
export type ILoggerCore<
  TMode extends IPipelineConfig['mode'] = 'sync',
  TShared extends Record<string, unknown> = Record<string, never>
> = {
  readonly config: ILoggerPluginConfig
  /** 只读上下文，见 ILoggerContext 说明 */
  readonly ctx: ILoggerContext
  /**
   * 本 logger 的单调时钟源（R-9 时间域）。`flush`/`shutdown`/`batch` 的 deadline 与 `boundedWait` 都用它，缺省 lifecycle
   * `systemScheduler`；插件可据此与宿主 clock 对齐。
   */
  readonly scheduler: ILifecycleScheduler

  /** 便捷方法：同步构造并处理一条 entry；插件需要异步输出时应使用 dispatchRaw 的调度参数。 */
  log(tag: string, message: string, ...args: unknown[]): void
  /** 更底层的方法：允许插件显式指定 entry 的任意字段（例如 meta/data/context） */
  dispatchRaw(input: IRawEntryInput, options?: ILogDispatchOptions): void

  /**
   * 注册一个管线阶段：可以修改 entry、可以调用 next 放行，也可以不调用 next 直接丢弃。
   *
   * 下面四个 `useXPipeline` 的条件类型都按"命中自己的 mode 才可用，其余三个 mode 一律 `never`"显式穷举， 不使用兜底 else 分支——`TMode`
   * 是未收窄的 `IPipelineMode` 联合（例如插件签名里的默认值）时， 四个方法都保持可调用，交由运行时 `PIPELINE_MODE_MISMATCH` 兜底；但 `TMode`
   * 收窄到具体某个 mode 字面量后， 其余三个必须真的是 `never`，而不是像旧版那样落进一个"看起来还能调用"的兜底分支——`IPipelineMode`
   * 新增第四个取值（`'async-generator'`）时，旧的三选一 fallback 会把它错误地划进"可用"，这里改成穷举后不再有这个缺口。
   */
  usePipeline: [TMode] extends ['sync']
    ? (stage: IPipelineStage) => ILoggerCore<TMode>
    : [TMode] extends ['async'] | ['generator'] | ['async-generator']
      ? never
      : (stage: IPipelineStage) => ILoggerCore<TMode>
  useAsyncPipeline: [TMode] extends ['async']
    ? (stage: IAsyncPipelineStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['generator'] | ['async-generator']
      ? never
      : (stage: IAsyncPipelineStage<ILogEntry>) => ILoggerCore<TMode>
  useGeneratorPipeline: [TMode] extends ['generator']
    ? (stage: IGeneratorPipelineStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['async'] | ['async-generator']
      ? never
      : (stage: IGeneratorPipelineStage<ILogEntry>) => ILoggerCore<TMode>
  useAsyncGeneratorPipeline: [TMode] extends ['async-generator']
    ? (stage: IAsyncGeneratorPipelineStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['async'] | ['generator']
      ? never
      : (stage: IAsyncGeneratorPipelineStage<ILogEntry>) => ILoggerCore<TMode>
  /** 注册一个 sink：entry 通过完整管线后，由所有已注册 sink 各自处理（可以有多个，如控制台 + HTTP 同时存在） */
  useSink(sink: ISink): IOff

  /**
   * 注册生命周期钩子，钩子名是字符串，核心内置 "before"/"after"， 以及按 tag 派生的 `before:${tag}` /
   * `after:${tag}`，插件也可以自定义钩子名
   */
  hook(name: string, fn: ILogHookFn): () => void
  fireHook(name: string, entry: ILogEntry): void
  /** Observes asynchronous output failures without changing normal log-call control flow. */
  onFailure(fn: ILogFailureHook): IOff

  /**
   * 把一段工作推迟到当前同步调用栈之外执行（由 runtime manager 调度），并纳入 flush/shutdown 的等待范围——任何"输出"相关的工作（渲染、写
   * stdout、发网络请求） 都应该通过这个方法调度，而不是在调用方的同步调用栈里直接执行， 供明确配置为异步输出的插件调度工作，并纳入 flush/shutdown 等待范围。
   */
  defer(task: () => void | Promise<void>): void

  /**
   * Flush：注册一个"缓冲区需要在 flush 时被清空"的回调，核心统一调度； flush() 本身还会等待所有通过 defer() 调度、但尚未完成的工作， 也会等待每个 sink
   * 自己返回的 Promise（比如 http 插件没接 batch 时， 单条请求也会被纳入等待范围，进程退出前不会把还在飞的请求丢掉）
   */
  onFlush(fn: IFlusher): IOff
  flush(): Promise<void>

  /** Shutdown disposes installed plugins after draining; subsequent log calls are ignored. */
  onShutdown(fn: IShutdownHandler): IOff
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult>

  use<const NewP extends readonly ILoggerPluginConstraint[]>(
    ...plugins: NewP
  ): Promise<IPluginHandleTuple<NewP>>
  unUse(name: string): Promise<void>

  /** Feature 名由提供方插件声明；重复插件名和依赖环在装配阶段拒绝。 */

  /**
   * 读取某个插件的配置。插件不应该在 install() 里直接读 `this.config`—— 应该统一通过 `core.config.get<TConfig>(name)`
   * 读取（`name` 通常传插件自己 导出的名字常量，例如 LEVEL_PLUGIN_NAME，而不是手写字符串字面量，减少打错的风险）。 这样配置的读取路径统一走 core 这一层，
   * 而不是插件各自把配置攥在自己手里——好处是配置对 core 是"可见的"， 比如未来想做一个调试面板列出"每个插件当前的配置"，不需要挨个改插件代码。
   */

  /**
   * 绕开整条 pipeline/sink，直接写原始文本到 stdout；asyncOutput=true 时通过 defer 调度， 供需要"逐 token
   * 流式输出、不想每次都套一层完整日志格式"的插件使用（如 reasoning 插件）
   */
  raw(text: string, options?: ILogDispatchOptions): void

  /**
   * "继承"能力：log1.extends(log2, log3) 之后，log1 之后产生的每一条日志， 除了走 log1 自己的完整处理流程，还会被转发进 log2、log3 各自完整的
   * pipeline/sink（也就是说 log2/log3 自己的 level 阈值、filter 照样对 转发过来的日志生效，这是"继承"而不是"单纯抄送"的关键区别）。
   *
   * 转发时会把每一层的 topic（见 ILoggerContext.topic）依次追加进 entry.data.topicChain，配合 ansis 插件渲染出 `[topic1 ->
   * topic2]: xxx` 这样的链路前缀。注册 extends 时按 logger context id 检测环，运行时再按 extendPath 中的 id 做防御性跳过。
   *
   * 注意这只组合"运行时行为"（转发 + topic 链路展示），不会让 log1 的 TypeScript 类型反过来获得 log2 独有的方法——如果需要拿到合并后的类型，
   * 接住返回值使用：`const combined = log1.extends(log2)`。
   */
  extends(
    ...others: readonly Omit<ILoggerCore<TMode, TShared>, 'config' | 'onDispose'>[]
  ): ILoggerCore<TMode, TShared>

  /** Removes named extension edges; returns true when at least one edge was removed. */
  unextend(...others: readonly Omit<ILoggerCore<TMode, TShared>, 'config' | 'onDispose'>[]): boolean

  /**
   * 给一个已经构造好的 logger 实例动态追加插件（不需要重新 new）。 和构造时传 `plugins` 数组走的是同一套冲突检测（重名插件、重名扩展方法
   * 都会抛异常），也是同一套安装逻辑——`new Logger({ plugins: [...] })` 内部实际上就是调用一次这个方法。
   *
   * 类型上：返回值类型是 `ILoggerCore & 新插件们的扩展类型`，想要拿到新增方法的类型提示，要接住返回值使用 （`const log2 =
   * log.use(reasoning())`）；原变量本身不会自动变宽。
   */
  /**
   * 动态移除一个已经安装的插件，按插件名字移除。会把这个插件当初通过 usePipeline/useSink/hook/onFlush/onShutdown 注册的东西全部撤销，
   * 也会把它贡献的实例方法（比如 level 插件的 .info()）从实例上删掉。返回 Promise<void>；名字不存在时静默完成。
   *
   * 必需 Feature 依赖会阻止单独移除；调用方可显式选择级联移除。
   */
}

/** Logger-specific capabilities owned by LoggerCore, excluding PluginHost abilities. */
export type ILoggerDomainCore<
  TMode extends IPipelineConfig['mode'] = 'sync',
  TShared extends Record<string, unknown> = Record<string, never>
> = Omit<
  ILoggerCore<TMode, TShared>,
  | 'config'
  | 'usePipeline'
  | 'useAsyncPipeline'
  | 'useGeneratorPipeline'
  | 'useAsyncGeneratorPipeline'
  | 'use'
  | 'unUse'
>

// ---------------------------------------------------------------------------
// 插件本身的类型 + 类型级合并机制
// ---------------------------------------------------------------------------

/** 不给实例附加任何新方法的插件，统一用这个类型表达"空扩展" */
export type IEmptyPluginExt = Record<string, never>

/** 染色 shared 能力的类型契约。 */
export type IPaintFn = (tag: string, text: string) => string
export type IDimFn = (text: string) => string

export type ILoggerCoreWithShared<
  TMode extends IPipelineConfig['mode'],
  TShared extends Record<string, unknown>
> = ILoggerCore<TMode, TShared>

/** Plugin-facing logger capabilities exclude Host-level topology mutation. */
export type ILoggerPluginCore<
  TMode extends IPipelineConfig['mode'] = IPipelineMode,
  TShared extends Record<string, unknown> = Record<string, never>
> = Omit<ILoggerCore<TMode, TShared>, 'use' | 'unUse' | 'onDispose'> & {
  onDispose(resource: import('@migaia/plugin-host').IPluginResource): void
}

export type IResolvedPluginShared<_TPlugins extends readonly unknown[]> = Record<string, never>

export type ILoggerPlugin<
  TExt extends Record<string, unknown> = IEmptyPluginExt,
  TConfig extends IPluginConfig = IPluginConfig,
  TMode extends IPipelineMode = IPipelineMode,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = IPlugin<ILoggerPluginCore<TMode>, TExt, TConfig, Record<never, never>, TFeatures, TExpose>

/** Constraint collection keeps plugin-specific core types; host admission validates runtime hooks. */
export type ILoggerPluginConstraint = IPluginConstraint<any>

export type { IMergePluginExts }

export type ILoggerOptions<
  P extends readonly ILoggerPluginConstraint[] = [],
  TMode extends IPipelineMode = 'sync'
> = {
  /** Explicit PluginHost operation and drain budgets; `false` opts into unbounded waiting. */
  execution: IPluginHostOptions['execution']
  context?: string[]
  /** 这个 logger 自己的 topic，用于 extends() 组合时展示 `[topic1 -> topic2]` 链路 */
  topic?: string
  /** 构造时直接注册钩子的语法糖，等价于逐个调用 core.hook(name, fn) */
  on?: Record<string, ILogHookFn>
  plugins?: P
  /**
   * 业务自定义配置，会原样出现在每个插件都能读到的 core.ctx.options 里 （不包含 context/on/plugins 这些框架内部字段——那几个有各自的用途，
   * 不适合和"业务自定义配置"混在一起暴露给插件）。
   */
  options?: Record<string, unknown>
  pipeline?: IPluginHostOptions['pipeline'] & { mode?: TMode }
  /** 缺省 lifecycle `systemScheduler`；`flush`/`shutdown`/`batch` 的 deadline 均用它（R-9 时间域）。 */
  scheduler?: ILifecycleScheduler
}

/** Logger constructor type, kept separate so plugin extension types remain on instances. */
export type IStaticLoggerCtor = {
  new <
    const LocalP extends readonly ILoggerPluginConstraint[] = readonly [],
    const TMode extends IPipelineMode = 'sync'
  >(
    options: ILoggerOptions<LocalP, TMode>
  ): Omit<ILoggerCore<TMode, IResolvedPluginShared<LocalP>>, 'config' | 'onDispose'> & {
    readonly config: ILoggerConfig
  } & IMergePluginExts<LocalP>
}
