/** Stable adapters error text stays with its owner outside the root endpoint graph. */
export const RpcAdapterErrorText = {
  /** Stable aggregate text for browser and Node MessagePort terminal cleanup failures. */
  messagePortCleanupFailed: '[rpc] message port cleanup failed',
  /**
   * Stable core error text consumed by core/adapters/memory.ts; preserves its existing
   * caller-facing wording.
   */
  rpcMemoryTransportIsClosed: '[rpc] memory transport is closed',
  /**
   * Stable worker error text consumed by core/adapters/web-worker.ts; preserves its existing
   * caller-facing wording after the canonical factory moves into Core.
   */
  workerMessageReadFailed: (detail: string): string =>
    `[rpc] worker message could not be read: ${detail}`,
  /**
   * Stable worker error text consumed by core/adapters/web-worker.ts; preserves its existing
   * caller-facing wording after the canonical factory moves into Core.
   */
  workerFailure: (reason: string, detail: string): string => `[rpc] worker ${reason}: ${detail}`,
  /** Stable reason for a Worker error event consumed by the canonical port adapter. */
  workerFailedReason: 'failed',
  /** Stable reason for a Worker messageerror event consumed by the canonical port adapter. */
  workerMessageErrorReason: 'could not deserialize a message'
} as const
