/**
 * Defines a managed RPC message handler for the worker side.
 *
 * `dispose()` is the only asynchronous disposal entry point. It always returns `Promise<void>`;
 * there is no `disposeAsync()`. `close()` synchronously stops accepting work without running user
 * cleanup. Calling the function admits a raw message, waits for endpoint readiness and dispatches
 * it; the returned Promise and pendingCount do not wait for the provider's computation. A terminal
 * handler silently ignores later messages, including a message waiting when close wins readiness.
 */
export type IManagedRpcHandler = {
  (message: unknown): Promise<void>
  /**
   * Closes the handler, waits for endpoint initialization, and calls `endpoint.dispose()`. Cleanup
   * failures reject the promise instead of being swallowed. Repeated calls return the same promise.
   * This does not detach the caller's native message listener or dispose a supplied serialization
   * parser; those resources remain with their owner.
   */
  dispose(): Promise<void>
  /**
   * Synchronously marks the handler unavailable by setting `disposed = true`. It does not release
   * the endpoint. Repeated calls have no additional effect.
   */
  close(): void
  /** Admitted inbound deliveries still awaiting setup/dispatch, not active compute or drain count. */
  readonly pendingCount: number
  /** Terminal admission marker, set synchronously before asynchronous endpoint cleanup. */
  readonly disposed: boolean
}

/** Managed callback disposal needs only this actual cleanup operation, never an endpoint contract. */
type IManagedEndpoint = Readonly<{ dispose(): Promise<void> }>

/** Preserve terminal admission and Promise identity while the actual bridge owns connection setup. */
export function toManagedRpcHandler(
  endpointPromise: Promise<IManagedEndpoint>,
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
