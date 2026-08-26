import type { IRuntime } from '@migaia/reactive'
import { defaultRuntime } from '@migaia/reactive'
import { WebRpcPlatform } from '@migaia/web-rpc/protocol-constants'
import { Resource, type IResourceOptions } from '@migaia/resource'
import {
  abort,
  connect,
  protocol,
  timeout,
  type IWebRpcAbortSignal,
  type IWebRpcEndpoint
} from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import {
  createWebWorkerTransport,
  type IWebWorkerLikePort
} from '@migaia/web-rpc/adapters/web-worker'
import { toManagedRpcHandler, type IManagedRpcHandler } from './managed-rpc-handler.js'
import { createStoreWorkerError, STORE_WORKER_SOURCE, StoreWorkerErrorCode } from './errors.js'
import { StoreWorkerErrorText } from './error-text.js'

export type { IManagedRpcHandler } from './managed-rpc-handler.js'
export type IWorkerPort = IWebWorkerLikePort

/** Rejects JavaScript-boundary null/non-object option values before property access. */
function assertWorkerOptions(options: unknown): asserts options is object {
  if (options === null || typeof options !== 'object') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject
    )
  }
  try {
    Object.getOwnPropertyDescriptors(options)
  } catch (error) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    )
  }
}

/** Captures client endpoint options once so endpoint setup cannot reread hostile accessors. */
function snapshotWorkerClientOptions(options: object): {
  readonly clientId?: string
  readonly timeoutMs?: number
} {
  try {
    return {
      clientId: (options as { clientId?: string }).clientId,
      timeoutMs: (options as { timeoutMs?: number }).timeoutMs
    }
  } catch (error) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    )
  }
}

/** Captures per-request cancellation and transfer policy before asynchronous endpoint admission. */
function snapshotWorkerRequestOptions(options: object): {
  readonly signal?: IWebRpcAbortSignal
  readonly transfer?: readonly Transferable[]
} {
  try {
    return {
      signal: (options as { readonly signal?: IWebRpcAbortSignal }).signal,
      transfer: (options as { readonly transfer?: readonly Transferable[] }).transfer
    }
  } catch (error) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    )
  }
}

function createWorkerEndpoint(
  port: IWorkerPort,
  options: { readonly clientId?: string; readonly timeoutMs?: number }
): Promise<IWebRpcEndpoint<'worker', 'automatic', false>> {
  const transport = createWebWorkerTransport(port, { peerId: 'worker' })
  return createClientEndpoint({
    id: options.clientId ?? 'main',
    targetIds: ['worker'],
    transport,
    middlewares: [
      connect({ transport }),
      protocol(),
      abort(),
      timeout({ timeoutMs: options.timeoutMs })
    ]
  }) as Promise<IWebRpcEndpoint<'worker', 'automatic', false>>
}

export class WorkerAdapter {
  #endpoint: Promise<IWebRpcEndpoint<'worker', 'automatic', false>>
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(
    port: IWorkerPort,
    options: { readonly clientId?: string; readonly timeoutMs?: number } = {}
  ) {
    assertWorkerOptions(options)
    this.#endpoint = createWorkerEndpoint(port, snapshotWorkerClientOptions(options))
  }

  get disposed(): boolean {
    return this.#disposed
  }

  request<Input, Output>(
    payload: Input,
    options: { signal?: IWebRpcAbortSignal; transfer?: readonly Transferable[] } = {}
  ): Promise<Output> {
    if (this.#disposed)
      return Promise.reject(
        createStoreWorkerError(StoreWorkerErrorCode.adapterDisposed, StoreWorkerErrorText.disposed)
      )
    let requestOptions: {
      readonly signal?: IWebRpcAbortSignal
      readonly transfer?: readonly Transferable[]
    }
    try {
      assertWorkerOptions(options)
      requestOptions = snapshotWorkerRequestOptions(options)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#endpoint.then((endpoint) =>
      endpoint.send<Output>('worker', 'call', payload, requestOptions)
    )
  }

  /** 同步标记不可用：仅置 `disposed = true`，不释放底层 endpoint。幂等。 */
  close(): void {
    this.#disposed = true
  }

  /**
   * 唯一异步释放入口：先 `close()`，再等待 endpoint 初始化并执行 `endpoint.dispose()`。 不吞清理错误（失败会 reject），重复调用复用同一个
   * Promise。
   */
  dispose(): Promise<void> {
    if (this.#disposePromise === undefined) {
      this.#disposePromise = (async () => {
        this.close()
        const endpoint = await this.#endpoint
        await endpoint.dispose()
      })()
    }
    return this.#disposePromise
  }
}

export function createWorkerHandler<Input, Output>(
  compute: (payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>,
  postMessage: (message: unknown) => void,
  options: { readonly timeoutMs?: number } = {}
): IManagedRpcHandler {
  assertWorkerOptions(options)
  if (typeof compute !== 'function') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.workerHandlerCallback('compute')
    )
  }
  if (typeof postMessage !== 'function') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.workerHandlerCallback('postMessage')
    )
  }
  const timeoutMs = snapshotWorkerClientOptions(options).timeoutMs
  let deliver: (message: unknown) => void = () => undefined
  const transport = {
    platform: WebRpcPlatform.worker,
    peerId: 'main' as const,
    send: (message: unknown) => {
      postMessage(message)
    },
    subscribe: (listener: (message: { data: unknown }) => void) => {
      deliver = (message) => listener({ data: message })
      return () => {
        deliver = () => undefined
      }
    }
  }
  const endpoint = createProviderEndpoint({
    id: 'worker',
    transport,
    middlewares: [connect({ transport }), protocol(), abort(), timeout({ timeoutMs })]
  }).then((providerEndpoint) =>
    providerEndpoint.provide('call', async (context) =>
      context.success(await compute(context.data as Input, { signal: context.signal }))
    )
  )
  return toManagedRpcHandler(endpoint, (message) => deliver(message))
}

export type IWorkerComputedOptions<Input, Output> = IResourceOptions<Output> & {
  readonly runtime?: IRuntime
  readonly transfer?: (input: Input) => readonly Transferable[]
}

/** Stable worker/resource configuration captured before Resource ownership and auto-start. */
type IWorkerComputedOptionSnapshot<Input, Output> = {
  readonly runtime: IRuntime
  readonly transfer: ((input: Input) => readonly Transferable[]) | undefined
  readonly resource: IResourceOptions<Output>
}

/** Reads only owned worker/resource option keys once and rejects hostile accessors at admission. */
function snapshotWorkerComputedOptions<Input, Output>(
  options: IWorkerComputedOptions<Input, Output>
): IWorkerComputedOptionSnapshot<Input, Output> {
  assertWorkerOptions(options)
  try {
    const runtime = options.runtime ?? defaultRuntime
    const transfer = options.transfer
    if (transfer !== undefined && typeof transfer !== 'function') {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.workerComputedCallback('transfer')
      )
    }
    return {
      runtime,
      transfer,
      resource: {
        debugName: options.debugName,
        ttl: options.ttl,
        autoStart: options.autoStart,
        staleWhileRevalidate: options.staleWhileRevalidate,
        retry: options.retry,
        retryDelay: options.retryDelay,
        keepAlive: options.keepAlive,
        initialSnapshot: options.initialSnapshot,
        scheduler: options.scheduler
      }
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (error as { readonly source?: unknown }).source === STORE_WORKER_SOURCE
    ) {
      throw error
    }
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    )
  }
}

export function workerComputed<Input, Output>(
  adapter: WorkerAdapter,
  selectInput: () => Input,
  options: IWorkerComputedOptions<Input, Output> = {}
): Resource<Output> {
  const snapshot = snapshotWorkerComputedOptions(options)
  if (!(adapter instanceof WorkerAdapter)) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.workerComputedAdapter
    )
  }
  if (typeof selectInput !== 'function') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.workerComputedCallback('selectInput')
    )
  }
  return new Resource<Output>(
    ({ signal }) => {
      const input = selectInput()
      return adapter.request<Input, Output>(input, {
        signal,
        transfer: snapshot.transfer?.(input)
      })
    },
    snapshot.runtime,
    snapshot.resource
  )
}
