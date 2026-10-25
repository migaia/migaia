/**
 * Claim and lookup states are distinct from native error codes and never trigger provider
 * execution.
 */
export const RpcIdempotencyState = {
  /** A new exact claim alone owns original execution/seal rights. */ claimed: 'claimed',
  /** Existing execution has not reached its actual terminal. */ pending: 'pending',
  /** An existing claim has a retained result or an unavailable tombstone. */ done: 'done',
  /** A bounded scope/global claim capacity refused this new key. */ full: 'full',
  /** An absent/expired or body-evicted lookup cannot infer execution history. */ unknown:
    'unknown',
  /** Tombstones prevent rerun after their original result body exceeds retention capacity. */ unavailable:
    'unavailable'
} as const
/** Only the actual store owner can describe continuity; a missing lookup never grants this fact. */
export const RpcIdempotencyStoreFact = {
  /** The original built-in store owns one process-local epoch. */ memory: 'memory',
  /** Existing owner state remains present across this lookup. */ retained: 'retained',
  /** A real restarted default memory owner reports its lost prior incarnation. */ lost: 'lost-since-restart',
  /** An external store without fact support cannot assert continuity. */ unavailable: 'unavailable'
} as const
/** The original public capacities move unchanged with the actual idempotency owner. */
export const RpcIdempotencyDefaults = {
  /** Completed entries retain their exact key for five minutes after settlement. */ retentionMs: 300_000,
  /** Pending claims and completed tombstones share this global bound. */ maxEntries: 1024,
  /** One authenticated scope cannot consume another scope's admission. */ maxEntriesPerScope: 256,
  /** Retained result bodies share the original eight-MiB pressure budget. */ maxBytes:
    8 * 1024 * 1024,
  /** Oversized individual results retain a tombstone without the original body. */ maxOutcomeBytes:
    1024 * 1024
} as const
/** Native installation identity keeps optional store policy out of the host core. */
export const RpcIdempotencyPluginName = 'rpc-idempotency'
