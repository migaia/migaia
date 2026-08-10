import { PluginHost } from '@migai/plugin-host';
import type { IPluginHostOptions, IPipelineMode, ISyncPipelineStage } from '@migai/plugin-host';
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
import { getLoggerRuntimeManager } from './runtime-manager';

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
  #extendTargets: ILoggerCore<IPipelineMode>[] = [];
  constructor(
    userOptions: Readonly<Record<string, unknown>>,
    path: string[],
    topic: string,
    hostOptions: IPluginHostOptions = {},
    plugins: readonly ILoggerPluginConstraint[] = []
  ) {
    super(hostOptions);
    // 逐层冻结：顶层对象、options、path 数组、env 对象都单独 freeze，
    // 保证插件在任何一层写入都会在严格模式下抛出，而不是被 Object.freeze
    // 的"只冻结第一层"这个常见陷阱漏掉。
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

  fireHook(name: string, entry: ILogEntry): void {
    const list = this.#hooks.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list) {
      try {
        const result = fn(entry);
        if (result instanceof Promise) {
          this.#track('hook', result);
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
          if (result instanceof Promise) {
            result.then(resolve, reject);
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

  flush(): Promise<void> {
    if (this.#status === 'closed') return Promise.resolve();
    if (this.#flushPromise) return this.#flushPromise;
    const restoreActive = this.#status === 'active';
    if (restoreActive) this.#status = 'flushing';
    this.#flushPromise = this.#flush().finally(() => {
      this.#flushPromise = undefined;
      if (restoreActive && this.#status === 'flushing') this.#status = 'active';
    });
    return this.#flushPromise;
  }

  async #flush(): Promise<void> {
    const deadline = Date.now() + 3000;
    let rounds = 0;
    let repeat: boolean;
    do {
      await this.#drain();
      for (const flusher of this.#flushers.slice()) {
        try {
          await flusher();
        } catch (error) {
          this.#reportFailure('flush', error);
        }
      }
      repeat = this.#pending.size > 0;
      await this.#drain();
      await Promise.all(this.#extendTargets.map((target) => target.flush()));
      await this.#drain();
    } while (repeat && rounds++ < 100 && Date.now() < deadline);
    if (repeat) this.#reportFailure('flush', new Error('flush deadline or round limit reached'));
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
    this.#shutdownPromise = (async () => {
      for (const handler of this.#shutdownHandlers.slice()) {
        try {
          await handler(reason);
        } catch (error) {
          this.#reportFailure('shutdown', error);
        }
      }
      await this.flush();
      await super.dispose();
      this.#status = 'closed';
    })();
    return this.#shutdownPromise;
  }

  dispose(): Promise<void> {
    return this.shutdown('manual');
  }

  raw(text: string, options: ILogDispatchOptions = {}): void {
    if (this.#status === 'shutting-down' || this.#status === 'closed') return;
    const write = () => {
      getLoggerRuntimeManager().write(text);
    };
    if (options.asyncOutput) this.defer(write);
    else write();
  }

  extends(...others: readonly ILoggerCore<IPipelineMode>[]): this {
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

  async #drain(): Promise<void> {
    const deadline = Date.now() + 3000;
    let rounds = 0;
    while (this.#pending.size > 0 && rounds++ < 100 && Date.now() < deadline) {
      await Promise.all(this.#pending);
    }
  }

  #process(entry: ILogEntry): void {
    this.fireHook('before', entry);
    this.fireHook(`before:${entry.tag}`, entry);

    try {
      const pipeline = this.runPipeline(entry, (finalEntry) => {
        for (const sink of this.#sinks) {
          try {
            const result = sink(this.#snapshotEntry(finalEntry));
            if (result instanceof Promise) {
              // 关键修复：sink 返回的 Promise 现在会被纳入 #pending 追踪，
              // flush()/shutdown() 会真正等它完成，不再是单纯 fire-and-forget。
              // 这直接关系到 http 插件没接 batch 时，进程退出前有没有可能把
              // 还在飞行中的请求弄丢——之前这里只 .catch() 不追踪，
              // flush() 完全不知道这个请求还没发完就已经"完成"了。
              this.#track('sink', result);
            }
          } catch (err) {
            this.#reportFailure('sink', err);
          }
        }
        this.fireHook('after', finalEntry);
        this.fireHook(`after:${finalEntry.tag}`, finalEntry);
        this.#forwardToExtendTargets(finalEntry);
      });
      if (pipeline instanceof Promise) {
        this.#track('pipeline', pipeline);
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

    const existingPath = (entry.data.extendPath as string[] | undefined) ?? [this.ctx.id];
    const existingTopicChain = (entry.data.topicChain as string[] | undefined) ?? [];
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
          data: {
            ...entry.data,
            topicChain: nextTopicChain,
            extendPath: [...existingPath, target.ctx.id]
          }
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
   * contract.
   */
  #snapshotEntry(entry: ILogEntry): ILogEntry {
    return {
      ...entry,
      time: new Date(entry.time.getTime()),
      args: [...entry.args],
      meta: entry.meta ? { ...entry.meta } : undefined,
      context: [...entry.context],
      error: entry.error ? { ...entry.error } : undefined,
      data: { ...entry.data }
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
