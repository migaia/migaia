/** Cold forwarding configuration diagnostics belong to the forwarding owner. */
export const ForwardErrorText = {
  /** Forwarding policy is bounded before opening any native transport. */
  maxHopsInvalid: 'RPC forward maxHops must be an integer from 1 to 16'
} as const
