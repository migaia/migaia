import { WorkerMessagePort, type IWorkerMessagePort } from './worker-message-event.js'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IRuntime } from '@migaia/reactive'
import { defaultRuntime } from '@migaia/reactive'
import { Resource, type IResourceOptions } from '@migaia/resource'
import { createWorkerContractEndpoint, type IWorkerContractEndpoint } from './worker-contract.js'
import { toManagedRpcHandler, type IManagedRpcHandler } from './managed-rpc-handler.js'
import { createStoreWorkerError, STORE_WORKER_SOURCE, StoreWorkerErrorCode } from './errors.js'
import { StoreWorkerErrorText } from './error-text.js'
import { WorkerRpcIdentity } from './worker-constants.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

export type { IManagedRpcHandler } from './managed-rpc-handler.js'
/** Borrowed Web-worker-shaped message port; logical adapter disposal does not terminate its host. */
export type IWorkerPort = IWorkerMessagePort

/** Rejects JavaScript-boundary null/non-object option values before property access. */
function assertWorkerOptions(options: unknown): asserts options is object {
  if (options === null || typeof options !== 'object') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
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

/** Captures per-request cancellation before asynchronous endpoint admission. */
function snapshotWorkerRequestOptions(options: object): {
  readonly signal?: IAbortSignal
} {
  try {
    return {
      signal: (options as { readonly signal?: IAbortSignal }).signal
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
): Promise<IWorkerContractEndpoint> {
  return createWorkerContractEndpoint(port, {
    id: options.clientId ?? WorkerRpcIdentity.main,
    targetId: WorkerRpcIdentity.worker,
    timeoutMs: options.timeoutMs
  })
}

/**
 * Requests computations over one borrowed Worker-like port using the canonical RPC endpoint.
 * Construction starts asynchronous endpoint setup; requests wait for it. Use portable primitive,
 * array and plain-record data, with supported undefined/ArrayBuffer/Uint8Array wrappers, rather
 * than assuming arbitrary JavaScript objects round-trip. The bridge reserves $worker markers and
 * copies inputs and encodes bytes as base64url without detaching the caller's buffers.
 *
 * Close only stops admission; await dispose to release the endpoint, then release the physical
 * Worker/port separately. RPC owns remote errors, cancellation and timeout outcomes.
 */
export class WorkerAdapter {
  /** Shared endpoint initialization, awaited by both requests and asynchronous cleanup. */
  #endpoint: Promise<IWorkerContractEndpoint>
  /** Admission fence set before waiting for endpoint cleanup. */
  #disposed = false
  /** Stable cleanup result so repeated disposal neither repeats work nor hides its rejection. */
  #disposePromise: Promise<void> | undefined

  /**
   * Borrows port and captures client options once; options default to an empty object. clientId
   * defaults to main, with worker as the remote endpoint id. timeoutMs is omitted by default,
   * leaving requests without an application deadline. Invalid options throw locally; endpoint setup
   * failures surface through request/dispose rather than making the constructor async.
   */
  constructor(
    port: IWorkerPort,
    options: { readonly clientId?: string; readonly timeoutMs?: number } = {}
  ) {
    assertWorkerOptions(options)
    this.#endpoint = createWorkerEndpoint(port, snapshotWorkerClientOptions(options))
  }

  /** Whether close/dispose has fenced new requests, independently of cleanup completion. */
  get disposed(): boolean {
    return this.#disposed
  }

  /**
   * Waits for endpoint setup and the remote computation, returning its decoded result; Output is a
   * static expectation rather than runtime schema validation. Captures optional signal once before
   * asynchronous admission; it defaults to undefined. Inputs are copied without detaching the
   * caller's buffers. Invalid options or terminal admission reject, as do RPC/remote failures.
   * Cancellation asks a cooperative provider to stop and does not undo completed effects or
   * forcibly terminate it.
   */
  request<Input, Output>(payload: Input, options: { signal?: IAbortSignal } = {}): Promise<Output> {
    if (this.#disposed)
      return Promise.reject(
        createStoreWorkerError(StoreWorkerErrorCode.adapterDisposed, StoreWorkerErrorText.disposed)
      )
    let requestOptions: {
      readonly signal?: IAbortSignal
    }
    try {
      assertWorkerOptions(options)
      requestOptions = snapshotWorkerRequestOptions(options)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#endpoint.then((endpoint) => {
      if (this.#disposed)
        throw createStoreWorkerError(
          StoreWorkerErrorCode.adapterDisposed,
          StoreWorkerErrorText.disposed
        )
      return endpoint.request(payload, requestOptions).then((result) => result as Output)
    })
  }

  /**
   * Synchronously marks the adapter unavailable by setting `disposed = true`. It does not release
   * the endpoint. Repeated calls have no additional effect.
   */
  close(): void {
    this.#disposed = true
  }

  /**
   * Closes the adapter, waits for endpoint initialization, and calls `endpoint.close()`. This is
   * the only asynchronous disposal entry point. Cleanup failures reject the promise. Repeated calls
   * return the same promise. The borrowed physical port/Worker remains caller-owned.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise === undefined) {
      this.#disposePromise = (async () => {
        this.close()
        const endpoint = await this.#endpoint
        await endpoint.close()
      })()
    }
    return this.#disposePromise
  }
}

/**
 * Creates the worker-side managed message callback for one synchronous or asynchronous compute
 * function. The caller connects native message.data to the returned callback and supplies the
 * outbound post function; neither native listener installation nor physical Worker lifetime is
 * owned here. compute receives a cooperative native signal, and its result/failure is returned
 * through RPC rather than through the delivery callback's Promise.
 *
 * Options default to {}; timeoutMs is undefined and only configures requests originated by this
 * endpoint, not a provider execution budget. Invalid callbacks/options throw before setup. Await
 * handler.dispose to release its endpoint, and separately detach the caller's native listener.
 */
export function createWorkerHandler<Input, Output>(
  compute: (payload: Input, context: { signal: INativeAbortSignal }) => Output | Promise<Output>,
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
  /** Raw delivery and native listener identity share one explicit bridge owner. */
  const port = new WorkerMessagePort(postMessage)
  /** Capture options before asynchronous endpoint assembly begins. */
  const endpointOptions = snapshotWorkerClientOptions(options)
  /** Managed preparation completes independently of the remote handshake. */
  const endpointPromise = createWorkerContractEndpoint(
    port,
    {
      id: WorkerRpcIdentity.worker,
      targetId: endpointOptions.clientId ?? WorkerRpcIdentity.main,
      timeoutMs: endpointOptions.timeoutMs
    },
    (readyEndpoint) => {
      const unsubscribe = readyEndpoint.onRequest(WorkerRpcIdentity.call, (payload, signal) =>
        compute(payload as Input, { signal })
      )
      return {
        dispose: async () => {
          unsubscribe()
          await readyEndpoint.close()
        }
      }
    }
  )
  return toManagedRpcHandler(endpointPromise, port.deliver)
}

/**
 * Resource owns caching, dependency tracking and request cancellation; the adapter and physical
 * Worker remain caller-owned, and worker inputs are copied.
 */
export type IWorkerComputedOptions<Output> = IResourceOptions<Output> & {
  /** Borrowed reactive Runtime, default defaultRuntime, used for the returned Resource. */
  readonly runtime?: IRuntime
}

/** Stable worker/resource configuration captured before Resource ownership and auto-start. */
type IWorkerComputedOptionSnapshot<Output> = {
  readonly runtime: IRuntime
  readonly resource: IResourceOptions<Output>
}

/** Reads only owned worker/resource option keys once and rejects hostile accessors at admission. */
function snapshotWorkerComputedOptions<Output>(
  options: IWorkerComputedOptions<Output>
): IWorkerComputedOptionSnapshot<Output> {
  assertWorkerOptions(options)
  try {
    const runtime = options.runtime ?? defaultRuntime
    return {
      runtime,
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

/**
 * Builds a Resource whose fetcher synchronously selects input, then requests it through adapter.
 * Reactive reads made during selectInput follow Resource dependency tracking; inputs are copied
 * without detaching their buffers. Known options are captured once before Resource ownership;
 * invalid adapter/callback/options throw synchronously.
 *
 * Resource defaults apply: autoStart true, ttl Infinity, staleWhileRevalidate/keepAlive false,
 * retry/retryDelay 0, initialSnapshot/debugName undefined and systemScheduler. Request failures
 * follow Resource's state/Promise contract. Dispose the Resource before separately disposing the
 * borrowed adapter; Resource cancellation does not terminate the Worker or undo remote effects.
 */
export function workerComputed<Input, Output>(
  adapter: WorkerAdapter,
  selectInput: () => Input,
  options: IWorkerComputedOptions<Output> = {}
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
        signal
      })
    },
    snapshot.runtime,
    snapshot.resource
  )
}
