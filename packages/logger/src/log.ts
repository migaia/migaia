import { defineHost } from '@migaia/plugin-host'
import {
  createEventChannel,
  invokeEachLive,
  withSnapshotEntries,
  type ICanonicalEventChannel
} from '@migaia/event-subscriber'
import type {
  IPluginHostDisposalResult,
  IPluginHostOptions,
  IMiddlewarePipelineMode,
  ISyncMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IAsyncGeneratorMiddlewareStage,
  IHostHandle
} from '@migaia/plugin-host'
import { createLoggerError, createLoggerTypeError, LoggerErrorCode } from './errors.js'
import type {
  IFlusher,
  ILogFailureHook,
  ILogFailure,
  ILogDispatchOptions,
  ILogEntry,
  ILogHookFn,
  ILoggerContext,
  ILoggerCore,
  ILoggerDomainCore,
  ILoggerOptions,
  ILoggerPluginConstraint,
  IMergePluginExts,
  IPipelineStage,
  IRawEntryInput,
  IShutdownHandler,
  IShutdownReason,
  ISink,
  IStaticLoggerCtor
} from './typing.js'

type ILoggerExtendsTarget<TMode extends IMiddlewarePipelineMode> = Omit<
  ILoggerCore<TMode>,
  'config' | 'onDispose'
>
const loggerInternalState = Symbol('logger.internal.state')
type ILoggerInternalState = { extendPath: string[]; topicChain: string[] }
import { getLoggerRuntimeManager } from './runtime-manager.js'
import {
  boundedWait,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler
} from '@migaia/lifecycle'
import { LoggerStatus, type ILoggerStatus } from './state-constants.js'
import { LoggerErrorText } from './error-text.js'
import { registerLoggerSchedulerDomain } from './scheduler-domain.js'
import { captureLoggerPromiseLike, observeLoggerReporterResult } from './thenable.js'

/**
 * Cross-realm-safe check for "awaitable", so a Promise constructed in another realm (an iframe, a
 * VM context) or a plain thenable object still gets tracked. `instanceof Promise` only matches the
 * current realm's Promise constructor — see LG-R3-2 in
 * docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
 */
/** Resolves one immutable scheduler facade before PluginHost or logger code can observe it. */
function resolveLoggerScheduler(value: unknown): ILifecycleScheduler {
  if (value === undefined) return registerLoggerSchedulerDomain(systemScheduler, systemScheduler)
  try {
    const snapshot = snapshotScheduler(value)
    if (snapshot !== undefined) return registerLoggerSchedulerDomain(value as object, snapshot)
  } catch (error) {
    throw createLoggerTypeError(
      LoggerErrorCode.invalidOption,
      LoggerErrorText.schedulerGetterFailed,
      {
        cause:
          error instanceof Error && 'cause' in error
            ? (error as Error & { readonly cause?: unknown }).cause
            : error
      }
    )
  }
  throw createLoggerTypeError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidScheduler)
}

type ILoggerConstructorSnapshot = {
  readonly execution: IPluginHostOptions['execution']
  readonly scheduler: unknown
  readonly context: string[]
  readonly topic: string
  readonly onEntries: readonly (readonly [string, ILogHookFn])[]
  readonly options: Record<string, unknown>
  readonly pipeline: IPluginHostOptions['pipeline'] | undefined
  readonly plugins: readonly ILoggerPluginConstraint[]
}

/** Reads every public constructor option before LoggerCore can install a resource-owning plugin. */
function snapshotLoggerOptions(options: unknown): ILoggerConstructorSnapshot {
  let scheduler: unknown
  try {
    scheduler = (options as Record<string, unknown> | undefined)?.scheduler
  } catch (error) {
    throw createLoggerTypeError(
      LoggerErrorCode.invalidOption,
      LoggerErrorText.schedulerGetterFailed,
      { cause: error }
    )
  }

  try {
    const source = (options ?? {}) as Record<string, unknown>
    const rawContext = source.context as string[] | undefined
    const rawOn = source.on as Record<string, ILogHookFn> | undefined
    const rawOptions = source.options as Record<string, unknown> | undefined
    const rawExecution = source.execution as IPluginHostOptions['execution']
    const rawPlugins = source.plugins as readonly ILoggerPluginConstraint[] | undefined
    return {
      execution: rawExecution,
      scheduler,
      context: rawContext === undefined ? [] : [...rawContext],
      topic: (source.topic as string | undefined) ?? '',
      onEntries: rawOn === undefined ? [] : Object.entries(rawOn),
      options: rawOptions === undefined ? {} : { ...rawOptions },
      pipeline: source.pipeline as IPluginHostOptions['pipeline'] | undefined,
      plugins: rawPlugins === undefined ? [] : [...rawPlugins]
    }
  } catch (error) {
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption, {
      cause: error
    })
  }
}

/**
 * 一个插件通过 install() 注册的所有东西的登记簿，unUse() 靠这个精确撤销， 不需要每种注册类型各自发明一套"怎么撤销"的逻辑——集中记录、集中回滚。
 * 纯内部记账结构，不属于对外的类型契约，所以不放进 typing.ts。
 */
/**
 * 核心引擎：不认识"级别""颜色""批量"这些概念，只提供 pipeline（entry 加工链）、sink（entry 落地）、hook（生命周期）、
 * flush/shutdown（收尾）、Feature 依赖、config（插件配置的统一读写入口）、defer（按来源插件配置启用的异步调度）、 extends（多 logger
 * 组合转发）、use/unUse （动态装卸插件）这几个原语。所有具体能力都通过插件注入，核心本身保持"薄"。
 *
 * 所有内部状态一律用真正的 `#` 私有字段（ECMAScript 私有字段，运行时由 引擎强制隔离，不是 TS 的 `private` 那种编译期约定、运行时其实还能被
 * 外部代码用类型断言绕过去的"假私有"）。方法能不写在 class 里的， 一律不写在 class 外面。
 */
class LoggerCore {
  static #entrySeq = 0

  // 用 "!" 告诉 TS："这个字段确实会在构造函数里被赋值"——只是赋值方式是下面
  // 构造函数里的 Object.defineProperty，不是 TS 能静态识别的直接赋值语句
  readonly ctx!: ILoggerContext

  #sinks: ICanonicalEventChannel<ILogEntry, void> = createEventChannel()
  #hooks: Map<string, ICanonicalEventChannel<ILogEntry, void>> = new Map()
  #flushers: ICanonicalEventChannel<undefined, void> = createEventChannel()
  #shutdownHandlers: ICanonicalEventChannel<IShutdownReason, void> = createEventChannel()
  #failureHooks: ICanonicalEventChannel<ILogFailure, void> = createEventChannel()
  /** Every asynchronous path enters this registry before it can affect flush completion. */
  #pending = new Set<Promise<void>>()
  /** Normal dispatch stays open for shutdown handlers, then closes before PluginHost disposal. */
  #dispatchAdmissionOpen = true
  #status: ILoggerStatus = LoggerStatus.active
  #flushPromise: Promise<void> | undefined
  #shutdownPromise: Promise<IPluginHostDisposalResult> | undefined
  /** Extends() 注册的转发目标 */
  #extendTargets: ILoggerExtendsTarget<IMiddlewarePipelineMode>[] = []
  /** 单调时钟源（R-9）；`flush`/`shutdown`/`#drain` 的 deadline 与 `boundedWait` 共用。 */
  #scheduler: ILifecycleScheduler
  /** Functional Host owns plugin admission, config, pipeline, and disposal for this facade. */
  #handle: IHostHandle<ILoggerDomainCore<IMiddlewarePipelineMode>, ILogEntry, readonly []>
  /** Config facade is fixed after the functional Host has been created. */
  readonly config!: IHostHandle<
    ILoggerDomainCore<IMiddlewarePipelineMode>,
    ILogEntry,
    readonly []
  >['config']

  get scheduler(): ILifecycleScheduler {
    return this.#scheduler
  }

  constructor(
    userOptions: Readonly<Record<string, unknown>>,
    path: string[],
    topic: string,
    hostOptions: IPluginHostOptions,
    plugins: readonly ILoggerPluginConstraint[] = [],
    scheduler: ILifecycleScheduler = systemScheduler
  ) {
    this.#scheduler = scheduler
    // Freeze the top-level context containers. Nested option values and Date remain
    // identity-preserving and mutable by contract; callers own that trade-off.
    const runtime = getLoggerRuntimeManager()
    const env = Object.freeze({
      isTTY: Boolean(runtime.process?.stdout.isTTY),
      isCI: Boolean(runtime.process?.env.CI)
    })
    const ctx: ILoggerContext = Object.freeze({
      id: runtime.randomUUID(),
      options: Object.freeze({ ...userOptions }),
      path: Object.freeze([...path]),
      topic,
      createdAt: new Date(),
      env
    })
    // 用 defineProperty 把 ctx 这个属性槽本身也锁死（writable/configurable 均为 false），
    // 光冻结 ctx 内部的字段还不够——不这样做的话，插件依然可以直接
    // `core.ctx = 别的对象` 把整个属性替换掉，TS 的 `readonly` 只在编译期有效，
    // 对运行时（尤其是 JS 写的插件）毫无约束力。
    Object.defineProperty(this, 'ctx', {
      value: ctx,
      writable: false,
      configurable: false,
      enumerable: true
    })
    this.#handle = defineHost({
      host: { ...hostOptions, scheduler },
      domainCore: () => this.createPluginDomainCore()
    })
    Object.defineProperty(this, 'config', {
      value: this.#handle.config,
      writable: false,
      configurable: false,
      enumerable: true
    })
    /** Materialized consumer facade; PluginHost V2 keeps extension publication off its engine. */
    const handles = this.#handle.useSync(...(plugins as [ILoggerPluginConstraint]))
    for (const handle of handles)
      for (const key of Reflect.ownKeys(handle.extensions)) {
        const descriptor = Object.getOwnPropertyDescriptor(handle.extensions, key)
        if (!descriptor || !('value' in descriptor)) continue
        Object.defineProperty(this, key, {
          value: descriptor.value,
          enumerable: true,
          configurable: false,
          writable: false
        })
      }
  }

  createPluginDomainCore(): ILoggerDomainCore<IMiddlewarePipelineMode> {
    const domainCore: ILoggerDomainCore<IMiddlewarePipelineMode> = {
      ctx: this.ctx,
      scheduler: this.scheduler,
      log: (tag, message, ...args) => this.log(tag, message, ...args),
      dispatchRaw: (input, options) => this.dispatchRaw(input, options),
      raw: (text, options) => this.raw(text, options),
      useSink: (sink) => this.useSink(sink),
      hook: (name, fn) => this.hook(name, fn),
      fireHook: (name, entry) => this.fireHook(name, entry),
      onFailure: (fn) => this.onFailure(fn),
      defer: (task) => this.defer(task),
      onFlush: (fn) => this.onFlush(fn),
      flush: () => this.flush(),
      onShutdown: (fn) => this.onShutdown(fn),
      shutdown: (reason) => this.shutdown(reason),
      extends: (...others) =>
        this.extends(...others) as unknown as ILoggerCore<IMiddlewarePipelineMode>,
      unextend: (...others) => this.unextend(...others)
    }
    return domainCore
  }

  log(tag: string, message: string, ...args: unknown[]): void {
    this.dispatchRaw({ tag, message, args })
  }

  dispatchRaw(input: IRawEntryInput, options: ILogDispatchOptions = {}): void {
    if (!this.#dispatchAdmissionOpen || this.#status === 'closed') return
    const entry = this.#buildEntry(input)
    if (options.asyncOutput) this.defer(() => this.#process(entry))
    else this.#process(entry)
  }

  usePipeline(stage: IPipelineStage): this {
    this.#handle.usePipeline(stage as ISyncMiddlewareStage<ILogEntry>)
    return this
  }

  /** Delegates async stage registration to the functional Host. */
  useAsyncPipeline(stage: IAsyncMiddlewareStage<ILogEntry>): this {
    this.#handle.useAsyncPipeline(stage)
    return this
  }

  /** Delegates generator stage registration to the functional Host. */
  useGeneratorPipeline(stage: IGeneratorMiddlewareStage<ILogEntry>): this {
    this.#handle.useGeneratorPipeline(stage)
    return this
  }

  /** Delegates async-generator stage registration to the functional Host. */
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorMiddlewareStage<ILogEntry>): this {
    this.#handle.useAsyncGeneratorPipeline(stage)
    return this
  }

  /** Delegates dynamic plugin admission to the single functional Host. */
  use(...plugins: readonly ILoggerPluginConstraint[]) {
    return this.#handle.use(...(plugins as [ILoggerPluginConstraint]))
  }

  /** Delegates removal to the same Host that admitted the plugin. */
  unUse(name: string) {
    return this.#handle.unUse(name)
  }

  /** Delegates one pipeline traversal while retaining logger-specific dispatch ownership. */
  runPipeline(value: ILogEntry, done: (value: ILogEntry) => void): void | Promise<void> {
    return this.#handle.runPipeline(value, done)
  }

  useSink(sink: ISink): () => void {
    const admission = this.#sinks.subscribe((event) => sink(this.#snapshotEntry(event.value)))
    return () => admission()
  }

  hook(name: string, fn: ILogHookFn): () => void {
    const channel = this.#hooks.get(name) ?? createEventChannel({ removalPolicy: 'listener-all' })
    this.#hooks.set(name, channel)
    const admission = channel.subscribe((event) => fn(event.value))
    return () => {
      admission()
      if (channel.size === 0 && this.#hooks.get(name) === channel) this.#hooks.delete(name)
    }
  }

  onFailure(fn: ILogFailureHook): () => void {
    const admission = this.#failureHooks.subscribe((event) => fn(event.value))
    return () => admission()
  }

  #reportFailure(source: ILogFailure['source'], error: unknown): void {
    const failure: ILogFailure = { source, error }
    withSnapshotEntries(this.#failureHooks, failure, (entries) => {
      for (const invocation of entries) {
        try {
          const pending = captureLoggerPromiseLike(invocation.invoke())
          if (pending) {
            const observed = pending.then(
              () => undefined,
              (hookError) => {
                try {
                  this.#reportFailureHookError(hookError)
                } catch {
                  // Failure reporting is the terminal boundary; a reporter must never escape it.
                }
              }
            )
            void observed.catch(() => undefined)
          }
        } catch (hookError) {
          this.#reportFailureHookError(hookError)
        }
      }
    })
    const labels: Record<ILogFailure['source'], string> = {
      defer: 'defer 任务异常',
      hook: 'hook 异常',
      sink: 'sink 抛出异步异常',
      pipeline: 'pipeline 阶段异常',
      flush: 'flush 异常',
      forward: 'extends 转发异常',
      shutdown: 'shutdown 异常'
    }
    try {
      const runtime = getLoggerRuntimeManager()
      const result = runtime.console
        ? runtime.console.error(`[logger] ${labels[source]}:`, error)
        : runtime.write(`[logger] ${labels[source]}: ${String(error)}`)
      observeLoggerReporterResult(result)
    } catch {
      // Console/write are the final observer. Their own failure must not escape or recurse.
    }
  }

  /** Reports a failure-hook failure without re-entering the business failure hooks. */
  #reportFailureHookError(hookError: unknown): void {
    const reported = createLoggerError(
      LoggerErrorCode.hookFailed,
      LoggerErrorText.failureHookThrew,
      { cause: hookError }
    )
    try {
      const runtime = getLoggerRuntimeManager()
      const result = runtime.console
        ? runtime.console.error(reported, hookError)
        : runtime.write(`${LoggerErrorText.failureHookThrew} ${String(hookError)}`)
      observeLoggerReporterResult(result)
    } catch {
      // This is intentionally the last containment boundary.
    }
  }

  /**
   * Fires hooks against the live hook list: hooks registered during dispatch participate in the
   * current pass, while an off() call replaces the list and does not mutate the active iterator.
   */
  fireHook(name: string, entry: ILogEntry): void {
    const channel = this.#hooks.get(name)
    if (!channel) return
    invokeEachLive(channel, entry, (invocation) => {
      try {
        const result = invocation.invoke()
        const pending = captureLoggerPromiseLike(result)
        if (pending) this.#track('hook', pending)
      } catch (err) {
        this.#reportFailure('hook', err)
      }
    })
  }

  /** Runs a hook phase in registration order and waits for asynchronous hooks. */
  #runHookPhase(name: string, entry: ILogEntry): Promise<void> | undefined {
    const channel = this.#hooks.get(name)
    if (!channel) return undefined
    let chain: Promise<void> | undefined
    const scoped = withSnapshotEntries(channel, entry, (entries) => {
      if (entries.length === 0) return
      for (const invocation of entries) {
        const run = (): Promise<void> | undefined => {
          try {
            const pending = captureLoggerPromiseLike(invocation.invoke())
            return pending?.catch((error) => {
              this.#reportFailure('hook', error)
            })
          } catch (error) {
            this.#reportFailure('hook', error)
            return undefined
          }
        }
        if (chain) {
          chain = chain.then(() => run())
        } else {
          chain = run()
        }
      }
      return chain
    })
    return scoped === undefined ? undefined : scoped
  }

  defer(task: () => void | Promise<void>): void {
    // Shutdown handlers may defer final work until the pre-dispose drain. Once normal admission
    // closes, a disposer must not add a task that the completed shutdown can no longer drain.
    if (!this.#dispatchAdmissionOpen || this.#status === LoggerStatus.closed) return
    const run = new Promise<void>((resolve, reject) => {
      getLoggerRuntimeManager().defer(() => {
        try {
          const result = task()
          const pending = captureLoggerPromiseLike(result)
          if (pending) {
            pending.then(resolve, reject)
          } else {
            resolve()
          }
        } catch (error) {
          reject(error)
        }
      })
    })
    this.#track('defer', run)
  }

  onFlush(fn: IFlusher): () => void {
    const admission = this.#flushers.subscribe(() => fn())
    return () => admission()
  }

  /**
   * `deadlineAt` defaults to a fresh 3s budget for a standalone `flush()` call, but shutdown()
   * passes in the same absolute deadline it already used for the shutdown-handler loop — see
   * LG-R5-1 — so a single shutdown() invocation spends at most one 3s budget total instead of
   * handlers and flush each getting their own independent window.
   *
   * `deadlineAt` is an absolute deadline in this logger's monotonic `scheduler` clock (the same
   * clock `boundedWait` reads), not a Unix epoch; compute it with `scheduler.now() + budgetMs`.
   */
  flush(deadlineAt: number = this.#scheduler.now() + 3000): Promise<void> {
    if (this.#status === LoggerStatus.closed) return Promise.resolve()
    if (this.#flushPromise) return this.#flushPromise
    const restoreActive = this.#status === LoggerStatus.active
    if (restoreActive) this.#status = LoggerStatus.flushing
    this.#flushPromise = this.#flush(deadlineAt).finally(() => {
      this.#flushPromise = undefined
      if (restoreActive && this.#status === LoggerStatus.flushing)
        this.#status = LoggerStatus.active
    })
    return this.#flushPromise
  }

  async #flush(deadlineAt: number): Promise<void> {
    await this.#drain(deadlineAt)
    await withSnapshotEntries(this.#flushers, undefined, async (entries) => {
      for (const invocation of entries) {
        try {
          if (
            !(await boundedWait(Promise.resolve(invocation.invoke()), deadlineAt, {
              scheduler: this.#scheduler
            }))
          ) {
            this.#reportFailure(
              'flush',
              createLoggerError(LoggerErrorCode.lifecycleDeadline, LoggerErrorText.flushDeadline)
            )
            break
          }
        } catch (error) {
          this.#reportFailure('flush', error)
        }
      }
    })
    await this.#drain(deadlineAt)
    for (const target of this.#extendTargets) {
      try {
        if (!(await boundedWait(target.flush(), deadlineAt, { scheduler: this.#scheduler }))) {
          this.#reportFailure(
            'forward',
            createLoggerError(LoggerErrorCode.lifecycleDeadline, LoggerErrorText.forwardDeadline)
          )
          break
        }
      } catch (error) {
        this.#reportFailure('forward', error)
      }
    }
    await this.#drain(deadlineAt)
    if (this.#pending.size > 0)
      this.#reportFailure(
        'flush',
        createLoggerError(
          LoggerErrorCode.lifecycleDeadline,
          LoggerErrorText.pendingAfterFlushDeadline
        )
      )
  }

  onShutdown(fn: IShutdownHandler): () => void {
    const admission = this.#shutdownHandlers.subscribe((event) => fn(event.value))
    return () => admission()
  }

  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    if (this.#status === LoggerStatus.closed)
      return Promise.resolve({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: Object.freeze([])
      })
    this.#status = LoggerStatus.shuttingDown
    // Publish #shutdownPromise synchronously, before any handler runs. An async IIFE's body
    // starts executing immediately up to its first await — if the first shutdown handler is a
    // plain sync function that itself calls shutdown() (reentrant), that call happens before
    // `this.#shutdownPromise = (async () => {...})()` would otherwise have assigned anything,
    // so the early-return guards above see #shutdownPromise still undefined and #status already
    // 'shutting-down' (not 'closed') — neither guard fires, and a second shutdown pass starts,
    // running every handler a second time. Creating the deferred first closes that window.
    let settle: ((result: IPluginHostDisposalResult) => void) | undefined
    let fail: ((error: unknown) => void) | undefined
    this.#shutdownPromise = new Promise<IPluginHostDisposalResult>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    // One absolute deadline covers the entire shutdown sequence: shutdown handlers first, then the
    // flush phases they may have queued work for. #drain()/flusher/extends-target waits inside
    // flush() were already bounded by a deadline (LG-R3-1, LG-R4-2/3); the handler loop itself was
    // still a raw, unbounded `await handler(reason)` with no protection at all — a handler shaped
    // like "flush a client, then resolve" that has a bug and never settles hung shutdown() forever.
    // Reusing this single budget for the subsequent flush() call (instead of a fresh 3s window)
    // also keeps total shutdown latency bounded to ~3s instead of handlers-plus-flush stacking two
    // independent windows. See LG-R5-1 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    const deadlineAt = this.#scheduler.now() + 3000
    ;(async () => {
      await withSnapshotEntries(this.#shutdownHandlers, reason, async (entries) => {
        for (const invocation of entries) {
          try {
            // Every handler is still invoked (unlike the flusher/extends-target loops, which `break`
            // on timeout) — onShutdown() never promised handlers would be skipped once a prior one is
            // slow, and changing that would be a public-behavior change this round must not make.
            // Only the *wait* for each handler is capped at the shared remaining budget.
            if (
              !(await boundedWait(Promise.resolve(invocation.invoke()), deadlineAt, {
                scheduler: this.#scheduler
              }))
            ) {
              this.#reportFailure(
                'shutdown',
                createLoggerError(
                  LoggerErrorCode.lifecycleDeadline,
                  LoggerErrorText.shutdownHandlerDeadline
                )
              )
            }
          } catch (error) {
            this.#reportFailure('shutdown', error)
          }
        }
      })
      await this.flush(deadlineAt)
      // Shutdown handlers are allowed to enqueue final work; that work was drained above. Close
      // normal dispatch before PluginHost invokes plugin disposers so disposer-era logs cannot
      // enter a host whose lifecycle is already being torn down and create late #pending work.
      this.#dispatchAdmissionOpen = false
      // Extension edges are owned by this core and must not retain live targets after shutdown.
      this.#extendTargets = []
      const result = (await this.#handle.dispose()) as IPluginHostDisposalResult
      this.#status = LoggerStatus.closed
      return result
    })().then(
      (result) => settle?.(result),
      (error) => {
        // PluginHost disposal is terminal even when one disposer fails. Keep Logger
        // terminal too; accepting new entries would route them into a disposed host.
        this.#dispatchAdmissionOpen = false
        this.#status = LoggerStatus.closed
        fail?.(error)
      }
    )
    return this.#shutdownPromise
  }

  dispose(): Promise<IPluginHostDisposalResult> {
    return this.shutdown('manual')
  }

  raw(text: string, options: ILogDispatchOptions = {}): void {
    if (!this.#dispatchAdmissionOpen || this.#status === LoggerStatus.closed) return
    const write = () => {
      getLoggerRuntimeManager().write(text)
    }
    if (options.asyncOutput) this.defer(write)
    else write()
  }

  extends(...others: readonly ILoggerExtendsTarget<IMiddlewarePipelineMode>[]): this {
    for (const other of others) {
      if (this.#extendTargets.some((target) => target.ctx.id === other.ctx.id)) continue
      if (other === (this as unknown as ILoggerCore)) {
        throw createLoggerError(
          LoggerErrorCode.extendsSelf,
          LoggerErrorText.extendsSelf(this.ctx.id)
        )
      }
      // 主动检测：如果 other 沿着它自己已有的 extends 链路能转发回 this，
      // 说明这次调用会形成环，直接在注册这一刻拒绝，而不是留到真正转发
      // 日志时才默默跳过——那样问题会隐藏很久才被发现。
      if (other instanceof LoggerCore && LoggerCore.#canReach(other, this.ctx.id, new Set())) {
        throw createLoggerError(
          LoggerErrorCode.extendsCycle,
          LoggerErrorText.extendsCycle(this.ctx.id)
        )
      }
      this.#extendTargets.push(other)
    }
    return this
  }

  /** Removes extension edges by stable logger context identity and remains idempotent. */
  unextend(...others: readonly ILoggerExtendsTarget<IMiddlewarePipelineMode>[]): boolean {
    const ids = new Set(others.map((other) => other.ctx.id))
    const before = this.#extendTargets.length
    this.#extendTargets = this.#extendTargets.filter((target) => !ids.has(target.ctx.id))
    return this.#extendTargets.length !== before
  }

  /** 从 from 出发，沿着 extends 链路能不能走到 id 为 targetId 的 logger */
  static #canReach(from: LoggerCore, targetId: string, visited: Set<string>): boolean {
    if (visited.has(from.ctx.id)) return false
    visited.add(from.ctx.id)
    if (from.ctx.id === targetId) return true
    return from.#extendTargets.some(
      (t) => t instanceof LoggerCore && LoggerCore.#canReach(t, targetId, visited)
    )
  }

  #track(source: ILogFailure['source'], promise: Promise<void>): void {
    const observed = promise.catch((error) => this.#reportFailure(source, error))
    this.#pending.add(observed)
    void observed.then(
      () => this.#pending.delete(observed),
      () => this.#pending.delete(observed)
    )
  }

  /**
   * `await Promise.all(this.#pending)` alone cannot enforce a deadline: if any tracked promise
   * never settles (a sink/hook/defer task that hangs), the surrounding while-loop's deadline check
   * is never reached again — control stays stuck inside that one await forever, and so does every
   * caller of #drain() (flush(), and shutdown() via flush()). Race each round against the remaining
   * budget so a stuck promise can only block for the time left, not indefinitely.
   */
  async #drain(deadlineAt: number): Promise<void> {
    let rounds = 0
    while (this.#pending.size > 0 && rounds++ < 100) {
      const remainingMs = deadlineAt - this.#scheduler.now()
      if (remainingMs <= 0) return
      const settled = Symbol('drain-settled')
      let timer: { cancel(): void } | undefined
      try {
        const winner = await Promise.race([
          Promise.all(this.#pending).then(() => settled),
          new Promise<undefined>((resolve) => {
            // R-9：deadline 定时器走注入的 scheduler，不用宿主 setTimeout（时间域与 `deadlineAt` 一致）。
            timer = this.#scheduler.schedule(() => resolve(undefined), remainingMs)
          })
        ])
        if (winner !== settled) return // deadline hit while something in #pending is still stuck
      } finally {
        // Same timer-leak hazard as boundedWait() (LG-R5-2): without this, every round that resolves
        // via #pending settling first — the common, happy-path case — leaves its deadline timer
        // dangling until it fires on its own up to `remainingMs` later.
        if (timer !== undefined) {
          try {
            timer.cancel()
          } catch (error) {
            // A cleanup failure must not replace a settled drain or leave flush pending. Keep it
            // observable through the logger failure policy while preserving flush settlement.
            this.#reportFailure('flush', error)
          }
        }
      }
    }
  }

  #process(entry: ILogEntry): void {
    // Pipeline and hooks intentionally share the live entry; sinks receive a shallow snapshot,
    // but after hooks may update the value that extends() forwards.
    const before = this.#runHookPhase('before', entry)
    if (before) {
      this.#track('hook', before)
      this.#track(
        'hook',
        before.then(
          () => this.#processTagBefore(entry),
          () => undefined
        )
      )
      return
    }
    this.#processTagBefore(entry)
  }

  #processTagBefore(entry: ILogEntry): void {
    const tagBefore = this.#runHookPhase(`before:${entry.tag}`, entry)
    if (tagBefore) {
      this.#track('hook', tagBefore)
      this.#track(
        'hook',
        tagBefore.then(
          () => this.#processAfterBefore(entry),
          () => undefined
        )
      )
      return
    }
    this.#processAfterBefore(entry)
  }

  #processAfterBefore(entry: ILogEntry): void {
    try {
      const pipeline = this.runPipeline(entry, (finalEntry) => {
        const committedEntry = finalEntry && finalEntry.time instanceof Date ? finalEntry : entry
        withSnapshotEntries(this.#sinks, committedEntry, (entries) => {
          for (const invocation of entries) {
            try {
              const result = invocation.invoke()
              const pending = captureLoggerPromiseLike(result)
              if (pending) {
                // 关键修复：sink 返回的 Promise 现在会被纳入 #pending 追踪，
                // flush()/shutdown() 会真正等它完成，不再是单纯 fire-and-forget。
                // 这直接关系到 http 插件没接 batch 时，进程退出前有没有可能把
                // 还在飞行中的请求弄丢——之前这里只 .catch() 不追踪，
                // flush() 完全不知道这个请求还没发完就已经"完成"了。
                this.#track('sink', pending)
              }
            } catch (err) {
              this.#reportFailure('sink', err)
            }
          }
        })
        const after = this.#runHookPhase('after', committedEntry)
        const forward = () => {
          const tagAfter = this.#runHookPhase(`after:${committedEntry.tag}`, committedEntry)
          if (tagAfter) {
            this.#track('hook', tagAfter)
            this.#track(
              'hook',
              tagAfter.then(
                () => this.#forwardToExtendTargets(committedEntry),
                () => undefined
              )
            )
            return
          }
          this.#forwardToExtendTargets(committedEntry)
        }
        if (after) {
          this.#track('hook', after)
          this.#track(
            'hook',
            after.then(forward, () => undefined)
          )
        } else {
          forward()
        }
      })
      const pending = captureLoggerPromiseLike(pipeline)
      if (pending) this.#track('pipeline', pending)
    } catch (err) {
      this.#reportFailure('pipeline', err)
    }
  }

  /**
   * 把这条 entry 转发进每一个 extends() 目标各自完整的 pipeline/sink—— 目标自己的 level 阈值、filter 照样对转发过来的日志生效，这是"继承"
   * 而不是"单纯抄送"的关键区别。转发时把当前 topic 追加进 topicChain（纯展示用）， 同时把当前 id 追加进 extendPath（纯循环检测用，两者故意分开，
   * 循环检测不应该依赖可能为空/可能重名的 topic 字符串）。 extends() 注册时已经做过一次静态循环检测，这里是运行时兜底： 万一目标是外部自定义的 ILoggerCore
   * 实现、静态检测没覆盖到，这里依然安全。
   */
  #forwardToExtendTargets(entry: ILogEntry): void {
    if (this.#extendTargets.length === 0) return

    // Loop-detection state is written into `entry.data[loggerInternalState]` below (that is
    // where it survives the dispatchRaw() -> #buildEntry() round trip via `data: {...input.data}`
    // — a plain object spread copies symbol keys too). It must be read from that same location:
    // reading from the entry root (as an earlier version of this method did) always sees
    // undefined past the first hop, silently resetting the accumulated path and defeating the
    // cycle guard on every hop after the first — see LG-R3-4 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    const internal = (
      entry.data as Record<PropertyKey, unknown> & { [loggerInternalState]?: ILoggerInternalState }
    )[loggerInternalState]
    const existingPath = internal?.extendPath ?? [this.ctx.id]
    const existingTopicChain = internal?.topicChain ?? []
    const currentTopicChain =
      existingTopicChain.length > 0 || !this.ctx.topic ? existingTopicChain : [this.ctx.topic]

    for (const target of this.#extendTargets) {
      if (existingPath.includes(target.ctx.id)) continue // 运行时兜底的循环检测

      const nextTopicChain = target.ctx.topic
        ? [...currentTopicChain, target.ctx.topic]
        : currentTopicChain

      try {
        target.dispatchRaw({
          tag: entry.tag,
          message: entry.message,
          args: entry.args,
          context: entry.context,
          meta: entry.meta,
          error: entry.error,
          data: Object.assign(
            { ...entry.data },
            {
              [loggerInternalState]: {
                extendPath: [...existingPath, target.ctx.id],
                topicChain: nextTopicChain
              }
            }
          )
        })
      } catch (error) {
        this.#reportFailure('forward', error)
      }
    }
  }

  #buildEntry(input: IRawEntryInput): ILogEntry {
    const args = [...(input.args ?? [])]
    const errArg = input.error ? undefined : args.find((a): a is Error => a instanceof Error)
    return {
      id: `log_${++LoggerCore.#entrySeq}`,
      tag: input.tag,
      time: new Date((input.time ?? new Date()).getTime()),
      message: input.message,
      args,
      meta: input.meta ? { ...input.meta } : undefined,
      context: [...(input.context ?? this.ctx.path)],
      error:
        input.error ??
        (errArg
          ? { name: errArg.name, message: errArg.message, stack: errArg.stack, raw: errArg }
          : undefined),
      data: { ...input.data }
    }
  }

  /**
   * A sink receives a private top-level snapshot; nested user values stay reference-based by
   * contract. `data` is spread rather than passed by reference — but a plain spread also copies the
   * internal `loggerInternalState` symbol key (extends() loop-detection bookkeeping, see
   * #forwardToExtendTargets), which is not part of the public entry contract and must not reach
   * sink code even as an enumerable-but-easy-to-miss symbol property.
   */
  #snapshotEntry(entry: ILogEntry): ILogEntry {
    const data: Record<PropertyKey, unknown> = { ...entry.data }
    delete data[loggerInternalState as unknown as string]
    return {
      ...entry,
      time: new Date(entry.time.getTime()),
      args: [...entry.args],
      meta: entry.meta ? { ...entry.meta } : undefined,
      context: [...entry.context],
      error: entry.error ? { ...entry.error } : undefined,
      data
    }
  }
}

/**
 * 对外暴露的工厂类的真实运行时实现。
 *
 * 这里刻意用了"构造函数显式 return 一个对象"这个 TypeScript 允许的写法—— 当构造函数显式 return 一个对象（而不是隐式的 this）时，`new
 * Logger(...)` 的推断类型会采用这个返回值的类型，而不是 Logger 类本身的类型。 只有这样才能让 `new Logger({ plugins: [level(),
 * reasoning()] })` 的返回值 类型里真正带上 `.info()` `.thinking()` 这些方法——纯 class 继承做不到 "根据构造参数动态改变实例类型"
 * 这件事，必须借助这个返回值类型覆盖机制。
 *
 * 类本身的静态类型在这里是"宽松"的（use() 返回 unknown 后靠外面的 IStaticLoggerCtor 包装类型重新收紧）——真正精确的、支持链式类型累积的 类型契约由下面导出的
 * `Logger` 这个值的类型标注（IStaticLoggerCtor）来 承担，这个 class 只负责运行时行为是否正确。
 */
class LoggerImpl<const P extends readonly ILoggerPluginConstraint[] = []> {
  constructor(options: ILoggerOptions<P>) {
    const snapshot = snapshotLoggerOptions(options)
    const scheduler = resolveLoggerScheduler(snapshot.scheduler)
    const core = new LoggerCore(
      snapshot.options,
      snapshot.context,
      snapshot.topic,
      {
        execution: snapshot.execution,
        pipeline: snapshot.pipeline,
        scheduler
      },
      snapshot.plugins,
      scheduler
    )

    for (const [name, fn] of snapshot.onEntries) {
      core.hook(name, fn)
    }

    return core as unknown as ILoggerCore & IMergePluginExts<P>
  }
}

/**
 * 真正对外导出的入口。插件通过构造参数显式安装，`new Logger(...)` 用法保持不变。
 *
 * 实例级动态追加插件用 `log.use(...)`，动态移除用 `log.unUse(name)`， 两者都定义在 ILoggerCore 里（LoggerCore 类的方法），不需要额外包装。
 */
export const Logger: IStaticLoggerCtor = LoggerImpl as unknown as IStaticLoggerCtor

export type {
  IEmptyPluginExt,
  IErrorInfo,
  IFlusher,
  ILogDispatchOptions,
  ILogEntry,
  ILogFilter,
  ILogHookFn,
  ILoggerContext,
  ILoggerCore,
  ILoggerEnv,
  ILoggerOptions,
  ILoggerPlugin,
  IPipelineStage,
  IRawEntryInput,
  IShutdownHandler,
  IShutdownReason,
  ISink,
  IStaticLoggerCtor
} from './typing.js'
