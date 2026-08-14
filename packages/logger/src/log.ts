import { PluginHost } from '@migaia/plugin-host';
import type { IPluginHostOptions, IPipelineMode, ISyncPipelineStage } from '@migaia/plugin-host';
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
} from './typing';

type ILoggerExtendsTarget<TMode extends IPipelineMode> = Omit<
  ILoggerCore<TMode>,
  'config' | 'onDispose'
>;
const loggerInternalState = Symbol('logger.internal.state');
type ILoggerInternalState = { extendPath: string[]; topicChain: string[] };
import { getLoggerRuntimeManager } from './runtime-manager';
import { waitUntil } from './bounded-wait';

/**
 * Cross-realm-safe check for "awaitable", so a Promise constructed in another realm (an iframe, a
 * VM context) or a plain thenable object still gets tracked. `instanceof Promise` only matches the
 * current realm's Promise constructor — see LG-R3-2 in
 * docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
 */
const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

/**
 * 一个插件通过 install() 注册的所有东西的登记簿，unUse() 靠这个精确撤销， 不需要每种注册类型各自发明一套"怎么撤销"的逻辑——集中记录、集中回滚。
 * 纯内部记账结构，不属于对外的类型契约，所以不放进 typing.ts。
 */
/**
 * 核心引擎：不认识"级别""颜色""批量"这些概念，只提供 pipeline（entry 加工链）、sink（entry 落地）、hook（生命周期）、
 * flush/shutdown（收尾）、shared/getShared（插件间共享能力）、 config（插件配置的统一读写入口）、defer（按来源插件配置启用的异步调度）、
 * extends（多 logger 组合转发）、use/unUse （动态装卸插件）这几个原语。所有具体能力都通过插件注入，核心本身保持"薄"。
 *
 * 所有内部状态一律用真正的 `#` 私有字段（ECMAScript 私有字段，运行时由 引擎强制隔离，不是 TS 的 `private` 那种编译期约定、运行时其实还能被
 * 外部代码用类型断言绕过去的"假私有"）。方法能不写在 class 里的， 一律不写在 class 外面。
 */
class LoggerCore extends PluginHost<ILoggerDomainCore<IPipelineMode>, ILogEntry> {
  static #entrySeq = 0;

  // 用 "!" 告诉 TS："这个字段确实会在构造函数里被赋值"——只是赋值方式是下面
  // 构造函数里的 Object.defineProperty，不是 TS 能静态识别的直接赋值语句
  readonly ctx!: ILoggerContext;

  #sinks: ISink[] = [];
  #hooks: Map<string, ILogHookFn[]> = new Map();
  #flushers: IFlusher[] = [];
  #shutdownHandlers: IShutdownHandler[] = [];
  #failureHooks: ILogFailureHook[] = [];
  /** Every asynchronous path enters this registry before it can affect flush completion. */
  #pending = new Set<Promise<void>>();
  #status: 'active' | 'flushing' | 'shutting-down' | 'closed' = 'active';
  #flushPromise: Promise<void> | undefined;
  #shutdownPromise: Promise<void> | undefined;
  /** Extends() 注册的转发目标 */
  #extendTargets: ILoggerExtendsTarget<IPipelineMode>[] = [];
  constructor(
    userOptions: Readonly<Record<string, unknown>>,
    path: string[],
    topic: string,
    hostOptions: IPluginHostOptions = {},
    plugins: readonly ILoggerPluginConstraint[] = []
  ) {
    super(hostOptions);
    // Freeze the top-level context containers. Nested option values and Date remain
    // identity-preserving and mutable by contract; callers own that trade-off.
    const runtime = getLoggerRuntimeManager();
    const env = Object.freeze({
      isTTY: Boolean(runtime.process?.stdout.isTTY),
      isCI: Boolean(runtime.process?.env.CI)
    });
    const ctx: ILoggerContext = Object.freeze({
      id: runtime.randomUUID(),
      options: Object.freeze({ ...userOptions }),
      path: Object.freeze([...path]),
      topic,
      createdAt: new Date(),
      env
    });
    // 用 defineProperty 把 ctx 这个属性槽本身也锁死（writable/configurable 均为 false），
    // 光冻结 ctx 内部的字段还不够——不这样做的话，插件依然可以直接
    // `core.ctx = 别的对象` 把整个属性替换掉，TS 的 `readonly` 只在编译期有效，
    // 对运行时（尤其是 JS 写的插件）毫无约束力。
    Object.defineProperty(this, 'ctx', {
      value: ctx,
      writable: false,
      configurable: false,
      enumerable: true
    });
    Object.defineProperty(this, 'config', {
      value: super.config,
      writable: false,
      configurable: false,
      enumerable: true
    });
    this.useSync(plugins);
  }

  protected createPluginDomainCore(): ILoggerDomainCore<IPipelineMode> {
    const domainCore: ILoggerDomainCore<IPipelineMode> = {
      ctx: this.ctx,
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
      extends: (...others) => this.extends(...others) as unknown as ILoggerCore<IPipelineMode>
    };
    return domainCore;
  }

  log(tag: string, message: string, ...args: unknown[]): void {
    this.dispatchRaw({ tag, message, args });
  }

  dispatchRaw(input: IRawEntryInput, options: ILogDispatchOptions = {}): void {
    if (this.#status === 'closed') return;
    const entry = this.#buildEntry(input);
    if (options.asyncOutput) this.defer(() => this.#process(entry));
    else this.#process(entry);
  }

  usePipeline(stage: IPipelineStage): this {
    return super.usePipeline(stage as ISyncPipelineStage<ILogEntry>);
  }

  useSink(sink: ISink): () => void {
    this.#sinks.push(sink);
    const off = () => this.#removeItem(this.#sinks, sink);
    this.trackPluginResourceIfInstalling(off);
    return off;
  }

  #removeItem<T>(items: T[], item: T): void {
    const index = items.indexOf(item);
    if (index !== -1) items.splice(index, 1);
  }

  hook(name: string, fn: ILogHookFn): () => void {
    const list = this.#hooks.get(name) ?? [];
    list.push(fn);
    this.#hooks.set(name, list);
    const dispose = () => {
      const current = this.#hooks.get(name);
      if (current)
        this.#hooks.set(
          name,
          current.filter((f) => f !== fn)
        );
    };
    this.trackPluginResourceIfInstalling(dispose);
    return dispose;
  }

  onFailure(fn: ILogFailureHook): () => void {
    this.#failureHooks.push(fn);
    const off = () => this.#removeItem(this.#failureHooks, fn);
    this.trackPluginResourceIfInstalling(off);
    return off;
  }

  #reportFailure(source: ILogFailure['source'], error: unknown): void {
    const failure: ILogFailure = { source, error };
    for (const hook of this.#failureHooks.slice()) {
      try {
        hook(failure);
      } catch (hookError) {
        const runtime = getLoggerRuntimeManager();
        if (runtime.console) runtime.console.error('[logger] failure hook threw:', hookError);
        else runtime.write(`[logger] failure hook threw: ${String(hookError)}`);
      }
    }
    const labels: Record<ILogFailure['source'], string> = {
      defer: 'defer 任务异常',
      hook: 'hook 异常',
      sink: 'sink 抛出异步异常',
      pipeline: 'pipeline 阶段异常',
      flush: 'flush 异常',
      forward: 'extends 转发异常',
      shutdown: 'shutdown 异常'
    };
    const runtime = getLoggerRuntimeManager();
    if (runtime.console) runtime.console.error(`[logger] ${labels[source]}:`, error);
    else runtime.write(`[logger] ${labels[source]}: ${String(error)}`);
  }

  /**
   * Fires hooks against the live hook list: hooks registered during dispatch participate in the
   * current pass, while an off() call replaces the list and does not mutate the active iterator.
   */
  fireHook(name: string, entry: ILogEntry): void {
    const list = this.#hooks.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list) {
      try {
        const result = fn(entry);
        if (isPromiseLike(result)) {
          this.#track('hook', Promise.resolve(result));
        }
      } catch (err) {
        this.#reportFailure('hook', err);
      }
    }
  }

  defer(task: () => void | Promise<void>): void {
    const run = new Promise<void>((resolve, reject) => {
      getLoggerRuntimeManager().defer(() => {
        try {
          const result = task();
          if (isPromiseLike(result)) {
            Promise.resolve(result).then(resolve, reject);
          } else {
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    this.#track('defer', run);
  }

  onFlush(fn: IFlusher): () => void {
    this.#flushers.push(fn);
    const off = () => this.#removeItem(this.#flushers, fn);
    this.trackPluginResourceIfInstalling(off);
    return off;
  }

  /**
   * `deadlineAt` defaults to a fresh 3s budget for a standalone `flush()` call, but shutdown()
   * passes in the same absolute deadline it already used for the shutdown-handler loop — see
   * LG-R5-1 — so a single shutdown() invocation spends at most one 3s budget total instead of
   * handlers and flush each getting their own independent window.
   */
  flush(deadlineAt: number = Date.now() + 3000): Promise<void> {
    if (this.#status === 'closed') return Promise.resolve();
    if (this.#flushPromise) return this.#flushPromise;
    const restoreActive = this.#status === 'active';
    if (restoreActive) this.#status = 'flushing';
    this.#flushPromise = this.#flush(deadlineAt).finally(() => {
      this.#flushPromise = undefined;
      if (restoreActive && this.#status === 'flushing') this.#status = 'active';
    });
    return this.#flushPromise;
  }

  async #flush(deadlineAt: number): Promise<void> {
    await this.#drain(deadlineAt);
    for (const flusher of this.#flushers.slice()) {
      try {
        if (!(await waitUntil(Promise.resolve(flusher()), deadlineAt))) {
          this.#reportFailure('flush', new Error('flush deadline reached'));
          break;
        }
      } catch (error) {
        this.#reportFailure('flush', error);
      }
    }
    await this.#drain(deadlineAt);
    for (const target of this.#extendTargets) {
      try {
        if (!(await waitUntil(target.flush(), deadlineAt))) {
          this.#reportFailure('forward', new Error('extends flush deadline reached'));
          break;
        }
      } catch (error) {
        this.#reportFailure('forward', error);
      }
    }
    await this.#drain(deadlineAt);
    if (this.#pending.size > 0)
      this.#reportFailure('flush', new Error('flush deadline reached with pending work remaining'));
  }

  onShutdown(fn: IShutdownHandler): () => void {
    this.#shutdownHandlers.push(fn);
    const off = () => this.#removeItem(this.#shutdownHandlers, fn);
    this.trackPluginResourceIfInstalling(off);
    return off;
  }

  shutdown(reason: IShutdownReason): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    if (this.#status === 'closed') return Promise.resolve();
    this.#status = 'shutting-down';
    // Publish #shutdownPromise synchronously, before any handler runs. An async IIFE's body
    // starts executing immediately up to its first await — if the first shutdown handler is a
    // plain sync function that itself calls shutdown() (reentrant), that call happens before
    // `this.#shutdownPromise = (async () => {...})()` would otherwise have assigned anything,
    // so the early-return guards above see #shutdownPromise still undefined and #status already
    // 'shutting-down' (not 'closed') — neither guard fires, and a second shutdown pass starts,
    // running every handler a second time. Creating the deferred first closes that window.
    let settle: (() => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    this.#shutdownPromise = new Promise<void>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // One absolute deadline covers the entire shutdown sequence: shutdown handlers first, then the
    // flush phases they may have queued work for. #drain()/flusher/extends-target waits inside
    // flush() were already bounded by a deadline (LG-R3-1, LG-R4-2/3); the handler loop itself was
    // still a raw, unbounded `await handler(reason)` with no protection at all — a handler shaped
    // like "flush a client, then resolve" that has a bug and never settles hung shutdown() forever.
    // Reusing this single budget for the subsequent flush() call (instead of a fresh 3s window)
    // also keeps total shutdown latency bounded to ~3s instead of handlers-plus-flush stacking two
    // independent windows. See LG-R5-1 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    const deadlineAt = Date.now() + 3000;
    (async () => {
      for (const handler of this.#shutdownHandlers.slice()) {
        try {
          // Every handler is still invoked (unlike the flusher/extends-target loops, which `break`
          // on timeout) — onShutdown() never promised handlers would be skipped once a prior one is
          // slow, and changing that would be a public-behavior change this round must not make.
          // Only the *wait* for each handler is capped at the shared remaining budget.
          if (!(await waitUntil(Promise.resolve(handler(reason)), deadlineAt))) {
            this.#reportFailure('shutdown', new Error('shutdown handler deadline reached'));
          }
        } catch (error) {
          this.#reportFailure('shutdown', error);
        }
      }
      await this.flush(deadlineAt);
      await super.dispose();
      this.#status = 'closed';
    })().then(
      () => settle?.(),
      (error) => {
        // PluginHost disposal is terminal even when one disposer fails. Keep Logger
        // terminal too; accepting new entries would route them into a disposed host.
        this.#status = 'closed';
        this.#shutdownPromise = undefined;
        fail?.(error);
      }
    );
    return this.#shutdownPromise;
  }

  dispose(): Promise<void> {
    return this.shutdown('manual');
  }

  raw(text: string, options: ILogDispatchOptions = {}): void {
    if (this.#status === 'closed') return;
    const write = () => {
      getLoggerRuntimeManager().write(text);
    };
    if (options.asyncOutput) this.defer(write);
    else write();
  }

  extends(...others: readonly ILoggerExtendsTarget<IPipelineMode>[]): this {
    for (const other of others) {
      if (this.#extendTargets.some((target) => target.ctx.id === other.ctx.id)) continue;
      if (other === (this as unknown as ILoggerCore)) {
        throw new Error(`[logger] extends() 不能传入自己 (id=${this.ctx.id})`);
      }
      // 主动检测：如果 other 沿着它自己已有的 extends 链路能转发回 this，
      // 说明这次调用会形成环，直接在注册这一刻拒绝，而不是留到真正转发
      // 日志时才默默跳过——那样问题会隐藏很久才被发现。
      if (other instanceof LoggerCore && LoggerCore.#canReach(other, this.ctx.id, new Set())) {
        throw new Error(
          `[logger] extends() 会形成循环引用：目标 logger 已经能沿着它自己的 extends 链路` +
            ` 转发回当前 logger (id=${this.ctx.id})，已阻止这次调用`
        );
      }
      this.#extendTargets.push(other);
    }
    return this;
  }

  /** 从 from 出发，沿着 extends 链路能不能走到 id 为 targetId 的 logger */
  static #canReach(from: LoggerCore, targetId: string, visited: Set<string>): boolean {
    if (visited.has(from.ctx.id)) return false;
    visited.add(from.ctx.id);
    if (from.ctx.id === targetId) return true;
    return from.#extendTargets.some(
      (t) => t instanceof LoggerCore && LoggerCore.#canReach(t, targetId, visited)
    );
  }

  #track(source: ILogFailure['source'], promise: Promise<void>): void {
    const observed = promise.catch((error) => this.#reportFailure(source, error));
    this.#pending.add(observed);
    void observed.finally(() => this.#pending.delete(observed));
  }

  /**
   * `await Promise.all(this.#pending)` alone cannot enforce a deadline: if any tracked promise
   * never settles (a sink/hook/defer task that hangs), the surrounding while-loop's deadline check
   * is never reached again — control stays stuck inside that one await forever, and so does every
   * caller of #drain() (flush(), and shutdown() via flush()). Race each round against the remaining
   * budget so a stuck promise can only block for the time left, not indefinitely.
   */
  async #drain(deadlineAt: number): Promise<void> {
    let rounds = 0;
    while (this.#pending.size > 0 && rounds++ < 100) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return;
      const settled = Symbol('drain-settled');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const winner = await Promise.race([
          Promise.all(this.#pending).then(() => settled),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), remainingMs);
            (timer as { unref?: () => void }).unref?.();
          })
        ]);
        if (winner !== settled) return; // deadline hit while something in #pending is still stuck
      } finally {
        // Same timer-leak hazard as waitUntil() (LG-R5-2): without this, every round that resolves
        // via #pending settling first — the common, happy-path case — leaves its deadline timer
        // dangling until it fires on its own up to `remainingMs` later.
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  #process(entry: ILogEntry): void {
    // Pipeline and hooks intentionally share the live entry; sinks receive a shallow snapshot,
    // but after hooks may update the value that extends() forwards.
    this.fireHook('before', entry);
    this.fireHook(`before:${entry.tag}`, entry);

    try {
      const pipeline = this.runPipeline(entry, (finalEntry) => {
        for (const sink of this.#sinks.slice()) {
          try {
            const result = sink(this.#snapshotEntry(finalEntry));
            if (isPromiseLike(result)) {
              // 关键修复：sink 返回的 Promise 现在会被纳入 #pending 追踪，
              // flush()/shutdown() 会真正等它完成，不再是单纯 fire-and-forget。
              // 这直接关系到 http 插件没接 batch 时，进程退出前有没有可能把
              // 还在飞行中的请求弄丢——之前这里只 .catch() 不追踪，
              // flush() 完全不知道这个请求还没发完就已经"完成"了。
              this.#track('sink', Promise.resolve(result));
            }
          } catch (err) {
            this.#reportFailure('sink', err);
          }
        }
        this.fireHook('after', finalEntry);
        this.fireHook(`after:${finalEntry.tag}`, finalEntry);
        this.#forwardToExtendTargets(finalEntry);
      });
      if (isPromiseLike(pipeline)) {
        this.#track('pipeline', Promise.resolve(pipeline));
      }
    } catch (err) {
      this.#reportFailure('pipeline', err);
    }
  }

  /**
   * 把这条 entry 转发进每一个 extends() 目标各自完整的 pipeline/sink—— 目标自己的 level 阈值、filter 照样对转发过来的日志生效，这是"继承"
   * 而不是"单纯抄送"的关键区别。转发时把当前 topic 追加进 topicChain（纯展示用）， 同时把当前 id 追加进 extendPath（纯循环检测用，两者故意分开，
   * 循环检测不应该依赖可能为空/可能重名的 topic 字符串）。 extends() 注册时已经做过一次静态循环检测，这里是运行时兜底： 万一目标是外部自定义的 ILoggerCore
   * 实现、静态检测没覆盖到，这里依然安全。
   */
  #forwardToExtendTargets(entry: ILogEntry): void {
    if (this.#extendTargets.length === 0) return;

    // Loop-detection state is written into `entry.data[loggerInternalState]` below (that is
    // where it survives the dispatchRaw() -> #buildEntry() round trip via `data: {...input.data}`
    // — a plain object spread copies symbol keys too). It must be read from that same location:
    // reading from the entry root (as an earlier version of this method did) always sees
    // undefined past the first hop, silently resetting the accumulated path and defeating the
    // cycle guard on every hop after the first — see LG-R3-4 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    const internal = (
      entry.data as Record<PropertyKey, unknown> & { [loggerInternalState]?: ILoggerInternalState }
    )[loggerInternalState];
    const existingPath = internal?.extendPath ?? [this.ctx.id];
    const existingTopicChain = internal?.topicChain ?? [];
    const currentTopicChain =
      existingTopicChain.length > 0 || !this.ctx.topic ? existingTopicChain : [this.ctx.topic];

    for (const target of this.#extendTargets) {
      if (existingPath.includes(target.ctx.id)) continue; // 运行时兜底的循环检测

      const nextTopicChain = target.ctx.topic
        ? [...currentTopicChain, target.ctx.topic]
        : currentTopicChain;

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
        });
      } catch (error) {
        this.#reportFailure('forward', error);
      }
    }
  }

  #buildEntry(input: IRawEntryInput): ILogEntry {
    const args = [...(input.args ?? [])];
    const errArg = input.error ? undefined : args.find((a): a is Error => a instanceof Error);
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
    };
  }

  /**
   * A sink receives a private top-level snapshot; nested user values stay reference-based by
   * contract. `data` is spread rather than passed by reference — but a plain spread also copies the
   * internal `loggerInternalState` symbol key (extends() loop-detection bookkeeping, see
   * #forwardToExtendTargets), which is not part of the public entry contract and must not reach
   * sink code even as an enumerable-but-easy-to-miss symbol property.
   */
  #snapshotEntry(entry: ILogEntry): ILogEntry {
    const data: Record<PropertyKey, unknown> = { ...entry.data };
    delete data[loggerInternalState as unknown as string];
    return {
      ...entry,
      time: new Date(entry.time.getTime()),
      args: [...entry.args],
      meta: entry.meta ? { ...entry.meta } : undefined,
      context: [...entry.context],
      error: entry.error ? { ...entry.error } : undefined,
      data
    };
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
  constructor(options: ILoggerOptions<P> = {}) {
    const core = new LoggerCore(
      options.options ?? {},
      options.context ?? [],
      options.topic ?? '',
      {
        pipeline: options.pipeline
      },
      options.plugins ?? []
    );

    for (const [name, fn] of Object.entries(options.on ?? {})) {
      core.hook(name, fn);
    }

    return core as unknown as ILoggerCore & IMergePluginExts<P>;
  }
}

/**
 * 真正对外导出的入口。插件通过构造参数显式安装，`new Logger(...)` 用法保持不变。
 *
 * 实例级动态追加插件用 `log.use(...)`，动态移除用 `log.unUse(name)`， 两者都定义在 ILoggerCore 里（LoggerCore 类的方法），不需要额外包装。
 */
export const Logger: IStaticLoggerCtor = LoggerImpl as unknown as IStaticLoggerCtor;

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
} from './typing';
