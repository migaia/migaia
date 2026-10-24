/** Stable fixture messages preserve the retired memory helper's original failure assertions. */
export const MemoryTransportText = {
  /** Invalid delivery configuration fails before either physical test side is created. */
  options: '[rpc] memory transport options must be an object',
  /** Closing either side retires this pair and rejects subsequent reference delivery. */
  closed: '[rpc] memory transport is closed'
} as const
