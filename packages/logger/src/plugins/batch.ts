import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing';
import type { IPipelineMode } from '@migaia/plugin-host';

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

    const createBatcher: ICreateBatcher = (perCallConfig, onBatch) =>
      this.#buildBatcher(core, defaultConfig, perCallConfig, onBatch);

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
  ): IBatcher<T> {
    const maxSize = perCallConfig.maxSize ?? defaultConfig.maxSize ?? 20;
    const maxWaitMs = perCallConfig.maxWaitMs ?? defaultConfig.maxWaitMs ?? 2000;
    const asyncOutput = perCallConfig.asyncOutput ?? defaultConfig.asyncOutput ?? true;

    let buffer: T[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const inFlight = new Set<Promise<void>>();
    let flushing: Promise<void> | null = null;

    const flush = async (): Promise<void> => {
      if (flushing) return flushing;
      flushing = (async () => {
        const deadline = Date.now() + 3000;
        let rounds = 0;
        do {
          await flushBatch();
          await Promise.all(inFlight);
        } while (
          (buffer.length > 0 || inFlight.size > 0) &&
          rounds++ < 100 &&
          Date.now() < deadline
        );
      })();
      try {
        await flushing;
      } finally {
        flushing = null;
      }
    };

    const flushBatch = async (): Promise<void> => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      await runBatch(batch);
    };

    /** 执行一个已从 buffer 摘出的批次，并让 flush() 可观察其生命周期。 */
    const runBatch = async (batch: T[]): Promise<void> => {
      const task = Promise.resolve(onBatch(batch));
      inFlight.add(task);
      try {
        await task;
      } finally {
        inFlight.delete(task);
      }
    };

    /** 先同步摘出满批次，避免 defer 窗口内后续 push 把多个批次意外合并。 */
    const dispatchFullBatch = (batch: T[]): void => {
      if (!asyncOutput) {
        void runBatch(batch);
        return;
      }
      let complete!: () => void;
      const scheduled = new Promise<void>((resolve) => {
        complete = resolve;
      });
      inFlight.add(scheduled);
      core.defer(async () => {
        try {
          await runBatch(batch);
        } finally {
          inFlight.delete(scheduled);
          complete();
        }
      });
    };

    const push = (item: T): void => {
      buffer.push(item);
      if (buffer.length >= maxSize) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        const fullBatch = buffer;
        buffer = [];
        dispatchFullBatch(fullBatch);
        return;
      }
      if (!timer) {
        // 从缓冲区第一条数据进来起，最多等 maxWaitMs 就必须 flush 一次
        timer = setTimeout(() => {
          timer = null;
          void flush();
        }, maxWaitMs);
        (timer as unknown as { unref?: () => void }).unref?.();
      }
    };

    core.onFlush(flush);
    return { push, flush };
  }
}

export const batch = (
  config: IBatchPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IBatchPluginConfig, IPipelineMode, IBatchShared> =>
  new BatchPlugin(config);
