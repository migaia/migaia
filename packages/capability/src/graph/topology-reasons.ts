/**
 * Owns structural topology reason values; contains no admission, index, scheduling or lifecycle
 * dependencies.
 */
/** Stable structural reasons passed to the caller-owned topology error adapter. */
export const TopologyInvalidReason = {
  /** A node descriptor is structurally invalid. */
  invalidNode: 'invalid-node',
  /** Two node descriptors use the same ID. */
  duplicateNode: 'duplicate-node',
  /** A node repeats one required provider edge. */
  duplicateEdge: 'duplicate-edge',
  /** Two node descriptors use the same registration ordinal. */
  duplicateOrdinal: 'duplicate-ordinal',
  /** A topology operation references a node that is not currently present. */
  unknownNode: 'unknown-node',
  /** A nested transaction or base-index mutation is attempted while a transaction is open. */
  transactionOpen: 'transaction-open',
  /** A settled transaction is used after commit or rollback. */
  transactionClosed: 'transaction-closed'
} as const
