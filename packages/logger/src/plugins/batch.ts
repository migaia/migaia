import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js';
import type { IPipelineMode } from '@migaia/plugin-host';
import { boundedWait, type IScheduledTask } from '@migaia/lifecycle';
import {
  createLoggerCleanupError,
  createLoggerError,
  LoggerErrorCode,
  tagLoggerError
} from '../errors.js';
import { LoggerErrorText } from '../error-text.js';

export type IBatchPluginConfig = {
  maxSize?: number;
  maxWaitMs?: number;
  /** 批次满时是否异步调度回调；默认 true。定时触发本身已是异步。 */
  asyncOutput?: boolean;
};

export type IBatcher<T> = {
  push(item: T): void;
  flush(): Promise<void>;
};

/** Batch 插件共享的批处理器工厂签名。 */
export type ICreateBatcher = <T>(
  config: IBatchPluginConfig,
  onBatch: (items: T[]) => void | Promise<void>
) => IBatcher<T>;

export type IBatchShared = { createBatcher: ICreateBatcher };

type IBatchController<T> = IBatcher<T> & {
  dispose(): readonly unknown[];
};

export const BATCH_PLUGIN_NAME = 'batch' as const;

/**
 * Batch 插件本身不假设"被批量处理的对象一定是日志 entry"—— 它只是把"攒够数量或者攒够时间就触发一次回调"这件事抽象成一个通用能力， 通过 shared() 暴露
 * createBatcher，消费插件用 getShared("createBatcher") 获取。 这也是为什么它对实例本身不附加任何方法（IEmptyPluginExt）。
 */
class BatchPlugin implements ILoggerPlugin<
  IEmptyPluginExt,
  IBatchPluginConfig,
  IPipelineMode,
  IBatchShared
> {
  readonly name = BATCH_PLUGIN_NAME;
  readonly config: IBatchPluginConfig;

  constructor(config: IBatchPluginConfig) {
    this.config = config;
  }

  shared(core: ILoggerPluginCore): IBatchShared {
    // 不读 this.config——统一通过 core.config.get() 读取
    const defaultConfig = core.config.get<IBatchPluginConfig>() ?? {};
    /** Keeps every batcher created from this plugin-owned shared factory. */
    const batchers = new Set<() => readonly unknown[]>();
    /** Shared factory admission closes before any batcher cleanup runs. */
    let available = true;

    core.onDispose(() => {
      available = false;
      const cleanupErrors: unknown[] = [];
      for (const dispose of batchers) cleanupErrors.push(...dispose());
      batchers.clear();
      if (cleanupErrors.length > 0) {
        const tagged = createLoggerCleanupError(
          LoggerErrorCode.pluginUninstallCleanupFailed,
          LoggerErrorText.pluginUninstallCleanupFailed,
          cleanupErrors
        );
        throw tagged;
      }
    });

    const createBatcher: ICreateBatcher = (perCallConfig, onBatch) => {
      if (!available) return this.#createDisposedBatcher();
      const batcher = this.#buildBatcher(core, defaultConfig, perCallConfig, onBatch);
      batchers.add(batcher.dispose);
      return batcher;
    };

    return { createBatcher };
  }

  install(): IEmptyPluginExt {
    return {};
  }

  #buildBatcher<T>(
    core: ILoggerPluginCore,
    defaultConfig: IBatchPluginConfig,
    perCallConfig: IBatchPluginConfig,
    onBatch: (items: T[]) => void | Promise<void>
  ): IBatchController<T> {
    const maxSize = perCallConfig.maxSize ?? defaultConfig.maxSize ?? 20;
    const maxWaitMs = perCallConfig.maxWaitMs ?? defaultConfig.maxWaitMs ?? 2000;
    const asyncOutput = perCallConfig.asyncOutput ?? defaultConfig.asyncOutput ?? true;

    let buffer: T[] = [];
    let timer: IScheduledTask | null = null;
    /** Prevents one returned debounce task from being cancelled more than once. */
    let timerCancelAttempted = false;
    const inFlight = new Set<Promise<void>>();
    /** Completes async full-batch dispatch records when uninstall drops them. */
    const pendingDispatchCompletions = new Set<() => void>();
    let flushing: Promise<void> | null = null;
    /** False after plugin uninstall; late scheduler callbacks become inert. */
    let active = true;

    const flush = async (): Promise<void> => {
      if (!active) return;
      if (flushing) return flushing;
      flushing = (async () => {
        const deadline = core.scheduler.now() + 3000;
        do {
          await flushBatch();
          if (!(await boundedWait(Promise.all(inFlight), deadline, { scheduler: core.scheduler })))
            return;
        } while ((buffer.length > 0 || inFlight.size > 0) && core.scheduler.now() < deadline);
      })();
      try {
        await flushing;
      } finally {
        flushing = null;
      }
    };

    const reportCleanupFailure = (error: unknown): void => {
      if (!active) return;
      // Route timer cleanup failures through core tracking so direct timer callbacks cannot
      // create an unhandled rejection or hide a scheduler failure from logger policy.
      core.defer(() => {
        throw error;
      });
    };

    const cancelTimer = (cleanupErrors?: unknown[]): void => {
      const scheduled = timer;
      timer = null;
      if (!scheduled) return;
      if (timerCancelAttempted) return;
      timerCancelAttempted = true;
      try {
        scheduled.cancel();
      } catch (error) {
        if (cleanupErrors)
          cleanupErrors.push(
            error instanceof Error
              ? tagLoggerError(error, LoggerErrorCode.pluginUninstallCleanupFailed)
              : createLoggerError(
                  LoggerErrorCode.pluginUninstallCleanupFailed,
                  LoggerErrorText.pluginUninstallCleanupFailed,
                  { cause: error }
                )
          );
        else reportCleanupFailure(error);
      }
    };

    const flushBatch = async (): Promise<void> => {
      if (!active) return;
      cancelTimer();
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      runBatch(batch);
    };

    /** 执行一个已从 buffer 摘出的批次，并让 flush() 可观察其生命周期。 */
    const reportBatchFailure = (error: unknown): void => {
      if (!active) return;
      core.defer(() => {
        throw error;
      });
    };

    const runBatch = (batch: T[]): void => {
      if (!active) return;
      let result: void | Promise<void>;
      try {
        result = onBatch(batch);
      } catch (error) {
        reportBatchFailure(error);
        return;
      }
      const task = Promise.resolve(result).catch((error) => {
        reportBatchFailure(error);
      });
      inFlight.add(task);
      void task.then(() => inFlight.delete(task));
    };

    /** 先同步摘出满批次，避免 defer 窗口内后续 push 把多个批次意外合并。 */
    const dispatchFullBatch = (batch: T[]): void => {
      if (!active) return;
      if (!asyncOutput) {
        runBatch(batch);
        return;
      }
      let complete!: () => void;
      const scheduled = new Promise<void>((resolve) => {
        complete = resolve;
      });
      inFlight.add(scheduled);
      const finish = (): void => {
        pendingDispatchCompletions.delete(finish);
        inFlight.delete(scheduled);
        complete();
      };
      pendingDispatchCompletions.add(finish);
      try {
        core.defer(() => {
          try {
            if (active) runBatch(batch);
          } finally {
            finish();
          }
        });
      } catch (error) {
        finish();
        reportBatchFailure(error);
      }
    };

    const push = (item: T): void => {
      if (!active) return;
      buffer.push(item);
      if (buffer.length >= maxSize) {
        cancelTimer();
        const fullBatch = buffer;
        buffer = [];
        dispatchFullBatch(fullBatch);
        return;
      }
      if (!timer) {
        // 从缓冲区第一条数据进来起，最多等 maxWaitMs 就必须 flush 一次
        let callbackFired = false;
        timerCancelAttempted = false;
        try {
          const scheduled = core.scheduler.schedule(() => {
            callbackFired = true;
            if (!active) return;
            try {
              core.defer(() => {
                if (active) return flush();
              });
            } catch (error) {
              reportBatchFailure(error);
            } finally {
              // If callback was asynchronous, returned task is already admitted here; if it was
              // synchronous, the post-schedule check below performs the same cleanup.
              cancelTimer();
            }
          }, maxWaitMs);
          // Retain handle even when scheduler fired callback before returning it. The task may
          // have independent armed work that still requires cancellation.
          timer = scheduled;
          if (callbackFired) cancelTimer();
        } catch (error) {
          reportBatchFailure(error);
        }
      }
    };

    const dispose = (): readonly unknown[] => {
      if (!active) return [];
      active = false;
      const cleanupErrors: unknown[] = [];
      cancelTimer(cleanupErrors);
      buffer = [];
      for (const complete of pendingDispatchCompletions) complete();
      pendingDispatchCompletions.clear();
      inFlight.clear();
      return cleanupErrors;
    };

    core.onFlush(flush);
    return { push, flush, dispose };
  }

  /** Returns an inert batcher to retained factories after their plugin has been uninstalled. */
  #createDisposedBatcher<T>(): IBatchController<T> {
    return {
      push: () => undefined,
      flush: async () => undefined,
      dispose: () => []
    };
  }
}

export const batch = (
  config: IBatchPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IBatchPluginConfig, IPipelineMode, IBatchShared> =>
  new BatchPlugin(config);
