/** Stable adapters error text stays with its owner outside the root endpoint graph. */
export const RpcAdapterErrorText = {
  /** The memory-pair factory accepts only its optional delivery scheduler configuration. */
  memoryOptions: '[rpc] memory transport options must be an object',
  /**
   * Probe callbacks report through the existing TRANSPORT channel without changing message
   * delivery.
   */
  probeFailed: '[rpc] carrier probe failed',
  /** Worker transport close releases borrowed hooks without terminating the native Worker. */
  workerCleanupFailed: '[rpc] worker transport cleanup failed',
  /** A closed borrowed Worker adapter no longer admits sends or subscribers. */
  workerClosed: '[rpc] worker transport is closed',
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
