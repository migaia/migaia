import type { IDisposable, IRuntime } from '@migaia/reactive';
import { defaultRuntime } from '@migaia/reactive';
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
import { toManagedRpcHandler, type ManagedRpcHandler } from './managed-rpc-handler';

export type { ManagedRpcHandler } from './managed-rpc-handler';
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

export class WorkerAdapter implements IDisposable {
  #endpoint: Promise<IWebRpcEndpoint<'worker', 'automatic', false>>;
  #disposed = false;

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
    options: { signal?: AbortSignal; transfer?: readonly Transferable[] } = {}
  ): Promise<Output> {
    return this.#endpoint.then((endpoint) =>
      endpoint.send<Output>('worker', 'call', payload, options)
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    void this.#endpoint.then((endpoint) => endpoint.dispose()).catch(() => undefined);
  }
}

export function createWorkerHandler<Input, Output>(
  compute: (payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>,
  postMessage: (message: unknown) => void,
  options: { readonly timeoutMs?: number } = {}
): ManagedRpcHandler {
  let deliver: (message: unknown) => void = () => undefined;
  const transport = {
    platform: 'Worker' as const,
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
