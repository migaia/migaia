/** Stable physical fields shared by the canonical MessagePort and Worker adapters. */
export const RpcCarrierDetailKey = {
  /** Outbound transfer-list length; -1 inbound because clone delivery hides the transfer mode. */
  transfers: 'transfers',
  /** Physical frame length already known by the byte carrier, including framing bytes. */
  frameBytes: 'frameBytes',
  /** Native false-write backpressure duration ending at the actual drain event. */
  drainMs: 'drainMs',
  /** JSON-RPC wire correlation identity, before translation into Core message ids. */
  jsonrpcId: 'jsonrpcId',
  /** JSON-RPC wire method, before translation into the Core provider namespace. */
  jsonrpcMethod: 'jsonrpcMethod',
  /** Number of JSON-RPC objects in the physical batch; ordinary objects use one. */
  batchSize: 'batchSize'
} as const
