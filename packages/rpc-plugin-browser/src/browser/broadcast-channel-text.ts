/**
 * Browser-owned discovery wraps raw messages; capability negotiation remains the host SDK's
 * grammar.
 */
export const BroadcastChannelControl = {
  /** Same-origin participants share this versioned discovery and physical routing namespace. */
  protocol: 'migaia.rpc.broadcast-channel/1',
  /** A new listener announces itself once; a directed reply lets earlier listeners be discovered. */
  join: 'join',
  /** Only explicit logical close publishes departure; no native crash detection is claimed. */
  leave: 'leave',
  /** Every canonical handshake/business frame travels on its exact pair of endpoint addresses. */
  data: 'data',
  /** Native plugin registration remains independent of participant endpoint identity. */
  plugin: 'broadcast-channel'
} as const
