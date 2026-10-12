/** Stable physical fields shared by the canonical MessagePort and Worker adapters. */
export const RpcCarrierDetailKey = {
  /** Outbound transfer-list length; -1 inbound because clone delivery hides the transfer mode. */
  transfers: 'transfers'
} as const
