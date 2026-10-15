import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import type {
  IFeatureRecord,
  IMergePluginExts,
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginHostOptions,
  IPluginHostDisposalResult,
  IPluginHandleTuple,
  IPipelineConfig
} from '@migaia/plugin-host'
import type { ILoggerRuntimeManager } from './runtime-manager.js'
import type { IScheduler } from '@migaia/utils/scheduler'

/**
 * Repository convention: use `type` when interface semantics are unnecessary. Named type aliases
 * begin with `I` to distinguish them from runtime values, classes, and functions. Generic
 * parameters such as `P` and `T` retain conventional names and are exempt.
 */

// ---------------------------------------------------------------------------
// Log entry contract.
// ---------------------------------------------------------------------------

export type IErrorInfo = {
  name: string
  message: string
  stack?: string | undefined
  /**
   * Reference to the original error, never a reconstructed object. JSON serialization does not
   * preserve the native error type or its non-enumerable built-in fields. A plain error normally
   * becomes `{}` under `raw`; enumerable custom properties can be serialized. Console and custom
   * sinks use this reference for native stack inspection or APIs such as
   * `Sentry.captureException()`. The `message` and `stack` fields are serializable projections
   * instead of the original error.
   */
  raw: Error
}

/**
 * The core assigns no built-in level semantics to `tag`. Installed plugins interpret this general
 * label, such as `debug`, `info`, `warn`, `error`, or `fatal` for levels and `thinking` or
 * `response` for reasoning. The core stays independent of plugin semantics.
 */
export type ILogEntry = {
  readonly id: string
  readonly tag: string
  readonly time: Date
  readonly message: string
  readonly args: readonly unknown[]
  // Explicit `| undefined` supports callers using `exactOptionalPropertyTypes: true`.
  // With that option, `meta?: X` and `meta?: X | undefined` differ:
  // the former requires the key to be absent when no value exists,
  // while the latter accepts an explicitly supplied `undefined`.
  // Entries commonly forward values from another `X | undefined` property.
  // Keeping the union makes `{ meta: entry.meta }` valid in that strict mode.
  readonly meta?: Record<string, unknown> | undefined
  readonly context: readonly string[]
  readonly error?: IErrorInfo | undefined
  /**
   * Plugin-owned data area that avoids replacing each other's entry fields. For example, reasoning
   * sets `data.silent = true` to tell the ansis console sink to skip printing. HTTP and batch sinks
   * can still consume the entry.
   */
  readonly data: Record<string, unknown>
}

/** Allows dispatch to override entry fields except `id`, which the core generates. */
export type IRawEntryInput = Partial<Omit<ILogEntry, 'id'>> & {
  tag: string
  message: string
}

/** Per-call scheduling choice supplied by the initiating plugin according to its configuration. */
export type ILogDispatchOptions = {
  asyncOutput?: boolean | undefined
}

// ---------------------------------------------------------------------------
// Pipeline, hook, and sink callback contracts.
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
/** Koa-style stage. Call `next(entry)` to forward the entry; omitting the call drops it. */
export type IPipelineStage = (entry: ILogEntry, next: (entry: ILogEntry) => void) => void
export type IFlusher = () => void | Promise<void>
export type IShutdownReason = 'signal' | 'uncaughtException' | 'unhandledRejection' | 'manual'
export type IShutdownHandler = (reason: IShutdownReason) => void | Promise<void>

// ---------------------------------------------------------------------------
// Context containers are frozen at runtime and readable by every plugin.
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
 * Plugins receive `core.ctx` during `install(core)` to read logger options, prefix path, creation
 * time, and environment. Construction freezes the context, path, top-level options, and environment
 * containers. Strict-mode writes such as `core.ctx.path.push(...)` or `core.ctx.options.x = 1`
 * throw a `TypeError`. Nested option values and the creation `Date` retain their original identity
 * and remain mutable.
 */
export type ILoggerContext = {
  /**
   * Stable logger identity generated at construction and retained for the instance lifetime.
   * `extends()` detects cycles through this ID rather than topic names, which can be empty or
   * duplicated.
   */
  readonly id: string
  readonly options: Readonly<Record<string, unknown>>
  readonly path: readonly string[]
  readonly topic: string
  readonly createdAt: Date
  readonly env: ILoggerEnv
}

// ---------------------------------------------------------------------------
// Plugin core capability contract.
// ---------------------------------------------------------------------------

/**
 * Core capabilities supplied to plugins through `install(core)`. Plugins built on these primitives
 * compose without depending on each other's implementations. Cross-plugin capabilities arrive
 * through declared Feature dependencies.
 */
export type ILoggerCore<
  TMode extends IPipelineConfig['mode'] = 'sync',
  TShared extends Record<string, unknown> = Record<string, never>
> = {
  /**
   * Plugins read their own configuration through `core.config.get<TConfig>()`, not `this.config`.
   * This scoped reader exposes the host-owned snapshot without a plugin-name argument. Keeping
   * reads at the core boundary makes plugin configuration available to host diagnostics.
   */
  readonly config: ILoggerPluginConfig
  /** Read-only context containers. See `ILoggerContext` for the mutability boundary. */
  readonly ctx: ILoggerContext
  /**
   * The logger's monotonic clock source (R-9). `flush`, `shutdown`, batch deadlines, and
   * `boundedWait` use this scheduler. Defaults to lifecycle `systemScheduler`. Plugins use it to
   * share the host's clock domain.
   */
  readonly scheduler: IScheduler
  /** Host capabilities captured by this logger; plugins share the same instance owner. */
  readonly runtimeManager: ILoggerRuntimeManager

  /**
   * Synchronously constructs and dispatches an entry. Use `dispatchRaw` scheduling options for
   * asynchronous output.
   */
  log(tag: string, message: string, ...args: unknown[]): void
  /** Dispatches explicit entry fields such as `meta`, `data`, and `context`. */
  dispatchRaw(input: IRawEntryInput, options?: ILogDispatchOptions): void

  /**
   * Registers a pipeline stage that can transform an entry, forward it with `next`, or drop it by
   * omitting `next`.
   *
   * Supported methods follow the middleware-pipeline promotion table. Sync stages run in any mode.
   * Generator stages also promote to `async-generator`. Other stages require their matching mode.
   * An unresolved mode union retains all methods and leaves validation to runtime admission.
   */
  usePipeline: (stage: IPipelineStage) => ILoggerCore<TMode>
  useAsyncPipeline: [TMode] extends ['async']
    ? (stage: IAsyncMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['generator'] | ['async-generator']
      ? never
      : (stage: IAsyncMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
  useGeneratorPipeline: [TMode] extends ['generator' | 'async-generator']
    ? (stage: IGeneratorMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['async']
      ? never
      : (stage: IGeneratorMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
  useAsyncGeneratorPipeline: [TMode] extends ['async-generator']
    ? (stage: IAsyncGeneratorMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
    : [TMode] extends ['sync'] | ['async'] | ['generator']
      ? never
      : (stage: IAsyncGeneratorMiddlewareStage<ILogEntry>) => ILoggerCore<TMode>
  /**
   * Registers a sink. Every registered sink processes entries that pass the full pipeline, such as
   * console and HTTP sinks together.
   */
  useSink(sink: ISink): IOff

  /**
   * Registers a named lifecycle hook. Built-in names are `before`, `after`, `before:${tag}`, and
   * `after:${tag}`. Plugins can also define their own hook names.
   */
  hook(name: string, fn: ILogHookFn): () => void
  fireHook(name: string, entry: ILogEntry): void
  /** Observes asynchronous output failures without changing normal log-call control flow. */
  onFailure(fn: ILogFailureHook): IOff

  /**
   * Schedules work outside the current synchronous stack through the runtime manager. `flush` and
   * `shutdown` wait for this work. Plugins configured for async output use this path for rendering,
   * stdout writes, or network requests.
   */
  defer(task: () => void | Promise<void>): void

  /**
   * Registers a callback to empty a buffer during `flush()`. The core invokes these callbacks and
   * also waits for unfinished `defer()` tasks and Promises returned by sinks. For example, an HTTP
   * sink without batching still keeps each pending request in the drain wait.
   */
  onFlush(fn: IFlusher): IOff
  flush(): Promise<void>

  /** Shutdown disposes installed plugins after draining; subsequent log calls are ignored. */
  onShutdown(fn: IShutdownHandler): IOff
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult>

  /**
   * Installs plugins on an existing logger through the same host admission path used by constructor
   * installation. Duplicate plugin names, extension conflicts, and dependency cycles are rejected
   * by that host. Providers declare Feature names.
   *
   * Returns a Promise of plugin handles, preserving each plugin's extension types on its handle.
   * The existing logger variable does not gain new TypeScript methods.
   */
  use<const NewP extends readonly ILoggerPluginConstraint[]>(
    ...plugins: NewP
  ): Promise<IPluginHandleTuple<NewP>>

  /**
   * Removes an installed plugin by name through the owning host and releases its registered
   * resources. This includes pipeline stages, sinks, hooks, flush callbacks, shutdown callbacks,
   * and plugin extensions. Missing plugin names reject with `PLUGIN_NOT_INSTALLED`.
   *
   * Required Feature dependents can block removal.
   */
  unUse(name: string): Promise<void>

  /**
   * Writes raw text to stdout without passing through the pipeline or sinks. `asyncOutput: true`
   * schedules the write through `defer`. Streaming plugins such as reasoning use this for token
   * output without a complete log format per token.
   */
  raw(text: string, options?: ILogDispatchOptions): void

  /**
   * Forwards entries to the full pipelines and sinks of each target after the current logger
   * processes them. After `log1.extends(log2, log3)`, target level thresholds and filters still
   * apply to forwarded entries.
   *
   * Each forwarding hop records its topic in internal forwarding state carried in `entry.data`.
   * Registration detects cycles using logger context IDs. Runtime forwarding also skips IDs already
   * present in the internal forwarding path.
   *
   * This composes forwarding behavior, not plugin extension types. The returned logger keeps the
   * current logger's TypeScript capabilities; target-only methods are not added.
   */
  extends(
    ...others: readonly Omit<ILoggerCore<TMode, TShared>, 'config' | 'onDispose'>[]
  ): ILoggerCore<TMode, TShared>

  /** Removes named extension edges; returns true when at least one edge was removed. */
  unextend(...others: readonly Omit<ILoggerCore<TMode, TShared>, 'config' | 'onDispose'>[]): boolean
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
// Plugin contracts and type-level extension composition.
// ---------------------------------------------------------------------------

/** Empty extension contract for plugins that add no instance methods. */
export type IEmptyPluginExt = Record<string, never>

/** Contract for the shared painting capability. */
export type IPaintFn = (tag: string, text: string) => string
export type IDimFn = (text: string) => string

export type ILoggerCoreWithShared<
  TMode extends IPipelineConfig['mode'],
  TShared extends Record<string, unknown>
> = ILoggerCore<TMode, TShared>

/** Plugin-facing logger capabilities exclude Host-level topology mutation. */
export type ILoggerPluginCore<
  TMode extends IPipelineConfig['mode'] = IMiddlewarePipelineMode,
  TShared extends Record<string, unknown> = Record<string, never>
> = Omit<ILoggerCore<TMode, TShared>, 'use' | 'unUse' | 'onDispose'> & {
  onDispose(resource: import('@migaia/plugin-host').IPluginResource): void
}

export type IResolvedPluginShared<_TPlugins extends readonly unknown[]> = Record<string, never>

export type ILoggerPlugin<
  TExt extends Record<string, unknown> = IEmptyPluginExt,
  TConfig extends IPluginConfig = IPluginConfig,
  TMode extends IMiddlewarePipelineMode = IMiddlewarePipelineMode,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = IPlugin<ILoggerPluginCore<TMode>, TExt, TConfig, Record<never, never>, TFeatures, TExpose>

/** Constraint collection keeps plugin-specific core types; host admission validates runtime hooks. */
export type ILoggerPluginConstraint = IPluginConstraint<any>

export type { IMergePluginExts }

export type ILoggerOptions<
  P extends readonly ILoggerPluginConstraint[] = [],
  TMode extends IMiddlewarePipelineMode = 'sync'
> = {
  /** Explicit PluginHost operation and drain budgets; `false` opts into unbounded waiting. */
  execution: IPluginHostOptions['execution']
  /** Host capability owner; omitted means capture the current module default at construction. */
  runtimeManager?: ILoggerRuntimeManager
  context?: string[]
  /** Topic for this logger's internal `extends()` forwarding bookkeeping. */
  topic?: string
  /** Registers constructor hooks, equivalent to calling `core.hook(name, fn)` for each entry. */
  on?: Record<string, ILogHookFn>
  plugins?: P
  /**
   * Custom application options exposed through `core.ctx.options` to every plugin. Framework fields
   * such as `context`, `on`, and `plugins` have separate roles and are not included here.
   */
  options?: Record<string, unknown>
  pipeline?: IPluginHostOptions['pipeline'] & { mode?: TMode }
  /**
   * Defaults to lifecycle `systemScheduler`. Flush, shutdown, and batch deadlines share its clock
   * domain (R-9).
   */
  scheduler?: IScheduler
}

/** Logger constructor type, kept separate so plugin extension types remain on instances. */
export type IStaticLoggerCtor = {
  new <
    const LocalP extends readonly ILoggerPluginConstraint[] = readonly [],
    const TMode extends IMiddlewarePipelineMode = 'sync'
  >(
    options: ILoggerOptions<LocalP, TMode>
  ): Omit<ILoggerCore<TMode, IResolvedPluginShared<LocalP>>, 'config' | 'onDispose'> & {
    readonly config: ILoggerConfig
  } & IMergePluginExts<LocalP>
}
