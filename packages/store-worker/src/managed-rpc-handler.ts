import type { IRpcEndpoint } from '@migaia/rpc-core'

/**
 * Defines a managed RPC message handler for the worker side.
 *
 * Following `lifecycle-extraction.sdd.md` §4.1, `dispose()` is the only asynchronous disposal entry
 * point. It always returns `Promise<void>`; there is no `disposeAsync()`. `close()` synchronously
 * stops accepting work without running user cleanup.
 */
export type IManagedRpcHandler = {
  (message: unknown): Promise<void>
  /**
   * Closes the handler, waits for endpoint initialization, and calls `endpoint.dispose()`. Cleanup
   * failures reject the promise instead of being swallowed. Repeated calls return the same
   * promise.
   */
  dispose(): Promise<void>
  /**
   * Synchronously marks the handler unavailable by setting `disposed = true`. It does not release
   * the endpoint. Repeated calls have no additional effect.
   */
  close(): void
  readonly pendingCount: number
  readonly disposed: boolean
}

type IManagedEndpoint<TTargetId extends string = string> = Pick<
  IRpcEndpoint<TTargetId, 'automatic', false>,
  'dispose'
>

export function toManagedRpcHandler<TTargetId extends string = string>(
  endpointPromise: Promise<IManagedEndpoint<TTargetId>>,
  deliver: (message: unknown) => void
): IManagedRpcHandler {
  let pendingCount = 0
  let disposed = false
  let disposePromise: Promise<void> | undefined

  const handler = (async (message: unknown): Promise<void> => {
    if (disposed) return
    pendingCount += 1
    try {
      await endpointPromise
      // Readiness may resolve after close/dispose; never deliver into a terminal endpoint.
      if (disposed) return
      deliver(message)
      await Promise.resolve()
    } finally {
      pendingCount -= 1
    }
  }) as IManagedRpcHandler

  handler.close = () => {
    disposed = true
  }

  handler.dispose = () => {
    if (disposePromise === undefined) {
      disposePromise = (async () => {
        handler.close()
        const endpoint = await endpointPromise
        await endpoint.dispose()
      })()
    }
    return disposePromise
  }

  Object.defineProperty(handler, 'pendingCount', { get: () => pendingCount })
  Object.defineProperty(handler, 'disposed', { get: () => disposed })
  return handler
}
