/** Stable adapters error text stays with its owner outside the root endpoint graph. */
export const RpcAdapterErrorText = {
  /** Stable aggregate text for browser and Node MessagePort terminal cleanup failures. */
  messagePortCleanupFailed: '[rpc] message port cleanup failed',
  /**
   * Stable core error text consumed by core/adapters/memory.ts; preserves its existing
   * caller-facing wording.
   */
  rpcMemoryTransportIsClosed: '[rpc] memory transport is closed'
} as const
