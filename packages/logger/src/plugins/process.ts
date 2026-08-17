import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js';
import { getLoggerRuntimeManager, type ILoggerProcess } from '../runtime-manager.js';
import { createLoggerError, LoggerErrorCode } from '../errors.js';
import { LoggerProcessReason } from '../plugin-constants.js';

export type IProcessPluginConfig = {
  /** 是否捕获 uncaughtException/unhandledRejection 并记为 fatal 日志，默认 true */
  captureCrashes?: boolean;
  /** 优雅关闭最多等待 flush 完成的时间（毫秒），超时后强制退出，默认 3000 */
  shutdownTimeoutMs?: number;
  /**
   * 是否劫持 process.exit()，让应用代码里任意位置调用 process.exit() 也会先等 flush。 默认关闭，因为这会把 process.exit()
   * 从"立即终止"变成"发起异步 flush 后才终止"， 如果你的代码依赖 process.exit() 同步阻断执行，开启前务必评估影响。
   */
  interceptProcessExit?: boolean;
};

export const PROCESS_PLUGIN_NAME = 'process' as const;

/**
 * 多个 Logger 实例都装了 process() 插件时，真正的 OS 信号监听器只应该注册一次， 否则会重复触发。这类"跨实例共享的运行时状态"用 `static #` 字段表达—— 真正的
 * ECMAScript 私有字段，运行时由引擎强制隔离，不是 TS 的 `private` 那种编译期约定、其实还能被外部代码用类型断言绕过去的"假私有"。
 */
class ProcessPlugin implements ILoggerPlugin<IEmptyPluginExt, IProcessPluginConfig> {
  static #installed = false;
  static #shuttingDown = false;
  static #shutdownPromise: Promise<void> | undefined;
  static #flushPromise: Promise<void> | undefined;
  static #config: Required<IProcessPluginConfig> | undefined;
  static #runtimeProcess: ILoggerProcess | undefined;
  static #originalExit: ILoggerProcess['exit'] | null = null;
  static readonly #cores = new Set<ILoggerPluginCore>();
  static #listeners: Array<[string, (...args: any[]) => void]> = [];

  readonly name = PROCESS_PLUGIN_NAME;
  readonly config: IProcessPluginConfig;

  constructor(config: IProcessPluginConfig) {
    this.config = config;
  }

  install(core: ILoggerPluginCore): IEmptyPluginExt {
    if (ProcessPlugin.#shuttingDown)
      throw createLoggerError(
        LoggerErrorCode.runtimeShuttingDown,
        '[logger] process runtime is shutting down'
      );
    const runtimeProcess = getLoggerRuntimeManager().process;
    if (!runtimeProcess) return {};
    ProcessPlugin.#runtimeProcess ??= runtimeProcess;
    // 不读 this.config——统一通过 core.config.get() 读取
    const config = core.config.get<IProcessPluginConfig>() ?? {};

    ProcessPlugin.#cores.add(core);
    core.onDispose(() => {
      ProcessPlugin.#cores.delete(core);
      if (ProcessPlugin.#cores.size === 0 && ProcessPlugin.#originalExit) {
        ProcessPlugin.#runtimeProcess!.exit = ProcessPlugin.#originalExit;
        ProcessPlugin.#originalExit = null;
      }
      if (ProcessPlugin.#cores.size === 0) {
        for (const [event, listener] of ProcessPlugin.#listeners) {
          ProcessPlugin.#runtimeProcess!.removeListener(event, listener);
        }
        ProcessPlugin.#listeners = [];
        ProcessPlugin.#installed = false;
        ProcessPlugin.#shuttingDown = false;
        ProcessPlugin.#shutdownPromise = undefined;
        ProcessPlugin.#flushPromise = undefined;
        ProcessPlugin.#config = undefined;
        ProcessPlugin.#runtimeProcess = undefined;
      }
    });
    ProcessPlugin.#installOnce({
      captureCrashes: config.captureCrashes ?? true,
      shutdownTimeoutMs: config.shutdownTimeoutMs ?? 3000,
      interceptProcessExit: config.interceptProcessExit ?? false
    });
    return {};
  }

  /** 只有第一次调用会真正生效；后续实例复用同一套监听器和配置。 */
  static #installOnce(config: Required<IProcessPluginConfig>): void {
    if (ProcessPlugin.#installed) {
      const previous = ProcessPlugin.#config!;
      if (JSON.stringify(previous) !== JSON.stringify(config)) {
        throw createLoggerError(
          LoggerErrorCode.pluginConfigConflict,
          '[logger] process plugin already installed with different configuration'
        );
      }
      return;
    }
    ProcessPlugin.#installed = true;
    ProcessPlugin.#config = config;

    const onSigint = () =>
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.signal, 0, config);
    const onSigterm = () =>
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.signal, 0, config);
    const runtimeProcess = ProcessPlugin.#runtimeProcess!;
    runtimeProcess.on('SIGINT', onSigint);
    runtimeProcess.on('SIGTERM', onSigterm);
    ProcessPlugin.#listeners.push(['SIGINT', onSigint], ['SIGTERM', onSigterm]);

    const onBeforeExit = () => {
      // beforeExit 支持异步：事件循环即将自然耗尽时触发，此时 flush 是安全的，
      // 不需要我们自己调用 exit，进程会在异步任务完成后自然退出
      void ProcessPlugin.#flushAllWithTimeout(config.shutdownTimeoutMs);
    };
    runtimeProcess.on('beforeExit', onBeforeExit);
    ProcessPlugin.#listeners.push(['beforeExit', onBeforeExit]);

    const onUncaughtException = (err: Error) => {
      if (config.captureCrashes) {
        for (const c of ProcessPlugin.#cores) c.log('fatal', '未捕获异常，进程即将退出', err);
      }
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.uncaughtException, 1, config);
    };
    runtimeProcess.on('uncaughtException', onUncaughtException);
    ProcessPlugin.#listeners.push(['uncaughtException', onUncaughtException]);

    const onUnhandledRejection = (reason: unknown) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      if (config.captureCrashes) {
        for (const c of ProcessPlugin.#cores) {
          c.log('fatal', '未处理的 Promise rejection，进程即将退出', err);
        }
      }
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.unhandledRejection, 1, config);
    };
    runtimeProcess.on('unhandledRejection', onUnhandledRejection);
    ProcessPlugin.#listeners.push(['unhandledRejection', onUnhandledRejection]);

    if (config.interceptProcessExit) {
      ProcessPlugin.#originalExit = (code?: number) => runtimeProcess.exit(code);
      runtimeProcess.exit = ((code?: number) => {
        void (async () => {
          await ProcessPlugin.#flushAllWithTimeout(config.shutdownTimeoutMs);
          ProcessPlugin.#originalExit!(code);
        })();
        return undefined as never;
      }) as ILoggerProcess['exit'];
    }
  }

  static async #gracefulShutdown(
    reason: (typeof LoggerProcessReason)[keyof typeof LoggerProcessReason],
    exitCode: number,
    config: Required<IProcessPluginConfig>
  ): Promise<void> {
    if (ProcessPlugin.#shutdownPromise) return ProcessPlugin.#shutdownPromise;
    ProcessPlugin.#shuttingDown = true;
    const runtimeProcess = ProcessPlugin.#runtimeProcess!;
    const exit = ProcessPlugin.#originalExit ?? ((code?: number) => runtimeProcess.exit(code));
    ProcessPlugin.#shutdownPromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...ProcessPlugin.#cores].map((c) => c.shutdown(reason))).then(
            () => undefined
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, config.shutdownTimeoutMs);
            (timer as unknown as { unref?: () => void }).unref?.();
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      exit(exitCode);
    })();
    return ProcessPlugin.#shutdownPromise;
  }

  static async #flushAllWithTimeout(timeoutMs: number): Promise<void> {
    if (ProcessPlugin.#flushPromise) return ProcessPlugin.#flushPromise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    ProcessPlugin.#flushPromise = Promise.race([
      Promise.all([...ProcessPlugin.#cores].map((c) => c.flush())).then(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        (timer as unknown as { unref?: () => void }).unref?.();
      })
    ]);
    try {
      await ProcessPlugin.#flushPromise;
    } finally {
      if (timer) clearTimeout(timer);
      ProcessPlugin.#flushPromise = undefined;
    }
  }
}

export const process = (
  config: IProcessPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IProcessPluginConfig> => new ProcessPlugin(config);
