/** Cold forwarding configuration diagnostics belong to the forwarding owner. */
export const ForwardErrorText = {
  /** R19 bounds this host's forwarding policy before any native transport can open. */
  maxHopsInvalid: 'RPC forward maxHops must be an integer from 1 to 16'
} as const
