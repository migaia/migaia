import type { IRuntime } from '@migaia/reactive';
import { defaultRuntime } from '@migaia/reactive';
import { WebRpcPlatform } from '@migaia/web-rpc/protocol-constants';
import { Resource, type IResourceOptions } from '@migaia/resource';
import {
  abort,
  connect,
  createEndpoint,
  protocol,
  timeout,
  type IWebRpcAbortSignal,
  type IWebRpcEndpoint
} from '@migaia/web-rpc';
import {
  createWebWorkerTransport,
  type IWebWorkerLikePort
} from '@migaia/web-rpc/adapters/web-worker';
import { toManagedRpcHandler, type IManagedRpcHandler } from './managed-rpc-handler.js';
import { createStoreWorkerError, StoreWorkerErrorCode } from './errors.js';

export type { IManagedRpcHandler } from './managed-rpc-handler.js';
export type IWorkerPort = IWebWorkerLikePort;

function createWorkerEndpoint(
  port: IWorkerPort,
  options: { readonly clientId?: string; readonly timeoutMs?: number }
): Promise<IWebRpcEndpoint<'worker', 'automatic', false>> {
  const transport = createWebWorkerTransport(port, { peerId: 'worker' });
  return createEndpoint<'worker'>({
    id: options.clientId ?? 'main',
    targetIds: ['worker'],
    transport,
    middlewares: [
      connect({ transport }),
      protocol(),
      abort(),
      timeout({ timeoutMs: options.timeoutMs })
    ]
  }) as Promise<IWebRpcEndpoint<'worker', 'automatic', false>>;
}

export class WorkerAdapter {
  #endpoint: Promise<IWebRpcEndpoint<'worker', 'automatic', false>>;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  constructor(
    port: IWorkerPort,
    options: { readonly clientId?: string; readonly timeoutMs?: number } = {}
  ) {
    this.#endpoint = createWorkerEndpoint(port, options);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  request<Input, Output>(
    payload: Input,
    options: { signal?: IWebRpcAbortSignal; transfer?: readonly Transferable[] } = {}
  ): Promise<Output> {
    if (this.#disposed)
      return Promise.reject(
        createStoreWorkerError(
          StoreWorkerErrorCode.adapterDisposed,
          '[store] worker adapter is disposed'
        )
      );
    return this.#endpoint.then((endpoint) =>
      endpoint.send<Output>('worker', 'call', payload, options)
    );
  }

  /** 同步标记不可用：仅置 `disposed = true`，不释放底层 endpoint。幂等。 */
  close(): void {
    this.#disposed = true;
  }

  /**
   * 唯一异步释放入口：先 `close()`，再等待 endpoint 初始化并执行 `endpoint.dispose()`。 不吞清理错误（失败会 reject），重复调用复用同一个
   * Promise。
   */
  dispose(): Promise<void> {
    if (this.#disposePromise === undefined) {
      this.#disposePromise = (async () => {
        this.close();
        const endpoint = await this.#endpoint;
        await endpoint.dispose();
      })();
    }
    return this.#disposePromise;
  }
}

export function createWorkerHandler<Input, Output>(
  compute: (payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>,
  postMessage: (message: unknown) => void,
  options: { readonly timeoutMs?: number } = {}
): IManagedRpcHandler {
  let deliver: (message: unknown) => void = () => undefined;
  const transport = {
    platform: WebRpcPlatform.worker,
    peerId: 'main' as const,
    send: (message: unknown) => {
      postMessage(message);
    },
    subscribe: (listener: (message: { data: unknown }) => void) => {
      deliver = (message) => listener({ data: message });
      return () => {
        deliver = () => undefined;
      };
    }
  };
  const endpoint = createEndpoint({
    id: 'worker',
    transport,
    middlewares: [
      connect({ transport }),
      protocol(),
      abort(),
      timeout({ timeoutMs: options.timeoutMs })
    ],
    provider: {
      call: async (context) =>
        context.success(await compute(context.data as Input, { signal: context.signal }))
    }
  });
  return toManagedRpcHandler(endpoint, (message) => deliver(message));
}

export type IWorkerComputedOptions<Input, Output> = IResourceOptions<Output> & {
  readonly runtime?: IRuntime;
  readonly transfer?: (input: Input) => readonly Transferable[];
};

export function workerComputed<Input, Output>(
  adapter: WorkerAdapter,
  selectInput: () => Input,
  options: IWorkerComputedOptions<Input, Output> = {}
): Resource<Output> {
  const { runtime = defaultRuntime, transfer, ...resourceOptions } = options;
  return new Resource<Output>(
    ({ signal }) => {
      const input = selectInput();
      return adapter.request<Input, Output>(input, { signal, transfer: transfer?.(input) });
    },
    runtime,
    resourceOptions
  );
}
