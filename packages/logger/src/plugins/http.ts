import type { IEmptyPluginExt, ILogEntry, ILoggerPluginCore, ILoggerPlugin } from '../typing.js';
import type { IBatchShared } from './batch.js';
import type { IPipelineMode } from '@migaia/plugin-host';
import { getLoggerRuntimeManager } from '../runtime-manager.js';
import { createLoggerError, LoggerErrorCode } from '../errors.js';

export type IHttpPluginConfig = {
  url: string;
  authToken?: string;
  headers?: Record<string, string>;
  retries?: number;
  /** 单次 HTTP 请求最长等待时间；默认 10000ms。 */
  requestTimeoutMs?: number;
  /** 是否复用 batch 插件的批量能力；未装 batch 插件时自动退化为每条日志单独发送 */
  batch?: { maxSize?: number; maxWaitMs?: number; asyncOutput?: boolean };
};

export const HTTP_PLUGIN_NAME = 'http' as const;

/**
 * 注意插件安装顺序：http 插件在 install() 时通过 core.getShared("createBatcher") 读取 batch 插件的 shared 能力，所以 plugins
 * 数组里 batch 必须排在 http 之前， 例如 `plugins: [batch({...}), http({...})]`。这跟 Vite/Rollup 这类插件系统里 "顺序敏感"
 * 是同一类约定，不是 bug。没装 batch 也完全可以单独用 http 插件， 只是会退化成每条日志各自发一次请求。
 *
 * 进程退出前的可靠性说明：不管走哪条路径（批量还是单条直发），这个插件的 sink 函数都会把发请求的 Promise **原样 return 出去**，而不是在内部
 * fire-and-forget 掉——这一点很关键，是配合核心那边 `#process()` 现在会 把 sink 返回的 Promise 纳入 flush()/shutdown()
 * 等待范围这个修复生效的 前提。如果 sink 内部自己 `.catch()` 了但不 return，核心根本不知道这个 sink 还有异步工作没完成，flush()
 * 会在请求真正发出去之前就"提前完工"， 进程一旦在这中间被杀掉，这条日志就真的丢了——这正是之前这里的 bug。
 */
class HttpPlugin implements ILoggerPlugin<
  IEmptyPluginExt,
  IHttpPluginConfig,
  IPipelineMode,
  {},
  Partial<IBatchShared>
> {
  readonly name = HTTP_PLUGIN_NAME;
  readonly config: IHttpPluginConfig;

  #resolvedConfig!: IHttpPluginConfig;
  #controller: AbortController | undefined;

  constructor(config: IHttpPluginConfig) {
    this.config = config;
  }

  install(core: ILoggerPluginCore<IPipelineMode, Partial<IBatchShared>>): IEmptyPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    this.#resolvedConfig = core.config.get<IHttpPluginConfig>() ?? this.config;
    this.#controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    core.onShutdown(() => this.#controller?.abort());

    const send = (entries: ILogEntry[]): Promise<void> => this.#send(entries);
    const createBatcher = core.getShared('createBatcher');

    if (createBatcher) {
      const batcher = createBatcher<ILogEntry>(this.#resolvedConfig.batch ?? {}, send);
      core.useSink((entry) => batcher.push(entry));
      // batch 插件自己已经通过 core.onFlush(flush) 注册了缓冲区的清空逻辑，
      // 这条路径的可靠退出保障由 batch 插件负责，这里不需要重复处理。
    } else {
      core.useSink((entry) => send([entry]));
    }

    return {};
  }

  async #send(entries: ILogEntry[]): Promise<void> {
    const retries = this.#resolvedConfig.retries ?? 2;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.#resolvedConfig.headers
    };
    if (this.#resolvedConfig.authToken)
      headers.Authorization = `Bearer ${this.#resolvedConfig.authToken}`;

    let body: string;
    try {
      body = JSON.stringify({ entries });
    } catch (err) {
      throw createLoggerError(LoggerErrorCode.serializeFailed, '[logger] http 日志序列化失败', {
        cause: err
      });
    }
    const runtimeFetch = getLoggerRuntimeManager().fetch;
    if (!runtimeFetch)
      throw createLoggerError(
        LoggerErrorCode.transportUnavailable,
        '[logger] HTTP transport is unavailable in this runtime'
      );
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const requestController =
          typeof AbortController === 'function' ? new AbortController() : undefined;
        const shutdownSignal = this.#controller?.signal;
        const onShutdown = () => requestController?.abort();
        shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
        const timeout = this.#resolvedConfig.requestTimeoutMs ?? 10000;
        const timer = requestController
          ? setTimeout(() => requestController.abort(), timeout)
          : undefined;
        let res: Awaited<ReturnType<NonNullable<typeof runtimeFetch>>>;
        try {
          res = await runtimeFetch(this.#resolvedConfig.url, {
            method: 'POST',
            headers,
            body,
            signal: requestController?.signal ?? shutdownSignal
          });
        } finally {
          if (timer) clearTimeout(timer);
          shutdownSignal?.removeEventListener('abort', onShutdown);
        }
        if (res.ok) return;
        if (res.status !== 429 && res.status < 500) {
          lastErr = new Error(`日志推送失败: HTTP ${res.status}`);
          break;
        }
        const retryAfter = res.headers.get('Retry-After');
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
        lastErr = new Error(`日志推送失败: HTTP ${res.status}`);
        if (attempt < retries) await this.#wait(retryAfterMs ?? 200 * 2 ** attempt);
      } catch (err) {
        lastErr = err;
        if (this.#controller?.signal.aborted || attempt >= retries) break;
        await this.#wait(200 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  #wait(delayMs: number): Promise<void> {
    const signal = this.#controller?.signal;
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export const http = (
  config: IHttpPluginConfig
): ILoggerPlugin<IEmptyPluginExt, IHttpPluginConfig, IPipelineMode, {}, Partial<IBatchShared>> =>
  new HttpPlugin(config);
