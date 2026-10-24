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

/** One callable handler owns terminal admission, pending delivery and one disposal receipt. */
class ManagedRpcHandler {
  /** Native endpoint readiness is shared by every delivery and cleanup caller. */
  #endpoint: Promise<IManagedEndpoint>
  /** The original bridge alone interprets admitted messages. */
  #deliver: (message: unknown) => void
  /** Pending delivery excludes provider computation after raw dispatch. */
  #pending = 0
  /** Close wins over any delivery still waiting for endpoint readiness. */
  #disposed = false
  /** Repeated cleanup callers receive this same original promise. */
  #disposal: Promise<void> | undefined

  /** Capture the canonical endpoint and bridge without opening another connection. */
  constructor(endpoint: Promise<IManagedEndpoint>, deliver: (message: unknown) => void) {
    this.#endpoint = endpoint
    this.#deliver = deliver
  }

  /** Dispatch one raw message only while admission remains open, releasing its count on every exit. */
  handle = async (message: unknown): Promise<void> => {
    if (this.#disposed) return
    this.#pending++
    try {
      await this.#endpoint
      if (this.#disposed) return
      this.#deliver(message)
      await Promise.resolve()
    } finally {
      this.#pending--
    }
  }

  /** Terminal admission changes synchronously and never performs user cleanup. */
  close = (): void => {
    this.#disposed = true
  }

  /** Join the one actual endpoint disposal after synchronously closing admission. */
  dispose = (): Promise<void> => {
    this.#disposal ??= this.#disposeEndpoint()
    return this.#disposal
  }

  /** Report admitted deliveries still waiting for setup or raw dispatch. */
  get pendingCount(): number {
    return this.#pending
  }

  /** Expose the terminal admission marker without granting mutation authority. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** The endpoint retains resource cleanup and its original failure. */
  async #disposeEndpoint(): Promise<void> {
    this.close()
    /** Cleanup uses the original endpoint after its readiness settles. */
    const endpoint = await this.#endpoint
    await endpoint.dispose()
  }
}

/** Preserve the callable public shape while its one named owner holds lifecycle state. */
export function toManagedRpcHandler(
  endpointPromise: Promise<IManagedEndpoint>,
  deliver: (message: unknown) => void
): IManagedRpcHandler {
  /** The callable is an API receipt, not another resource or connection owner. */
  const owner = new ManagedRpcHandler(endpointPromise, deliver)
  /** Native message listeners need this exact bound callable identity. */
  const handler = owner.handle as IManagedRpcHandler
  handler.close = owner.close
  handler.dispose = owner.dispose
  Object.defineProperty(handler, 'pendingCount', { get: () => owner.pendingCount })
  Object.defineProperty(handler, 'disposed', { get: () => owner.disposed })
  return handler
}
