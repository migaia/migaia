/** Pure result-store facts for the sole protocol; the idempotency plugin owns all retained work. */
/** Read-only lookup distinguishes store facts from guesses about whether business ran. */
export const RpcRuntimeOutcomeState = {
  /** The store observes work without a sealed result yet. */
  pending: 'pending',
  /** The store has a sealed original completion. */
  done: 'done',
  /** The store cannot establish an outcome; execution is not disproved. */
  unknown: 'unknown'
} as const
export type RpcRuntimeOutcomeState = keyof typeof RpcRuntimeOutcomeState

/** Store continuity is an owner fact, not inferred from a missing or expired key. */
export const RpcRuntimeStoreKind = {
  /** Result facts come from the actual in-memory store. */
  memory: 'memory',
  /** Result facts come from an external store owner. */
  external: 'external',
  /** No usable result-store capability is available. */
  unavailable: 'unavailable'
} as const
export type RpcRuntimeStoreKind = keyof typeof RpcRuntimeStoreKind
/** Only a real store replacement permits the lost-since-restart diagnostic. */
export const RpcRuntimeStoreContinuity = {
  /** The owner confirms its result-store continuity. */
  retained: 'retained',
  /** The owner confirms a store replacement since restart. */
  lost: 'lost-since-restart',
  /** An unavailable store makes no continuity claim. */
  unavailable: 'unavailable'
} as const
export type RpcRuntimeStoreContinuity =
  (typeof RpcRuntimeStoreContinuity)[keyof typeof RpcRuntimeStoreContinuity]
