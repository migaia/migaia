/** Original builder method names remain reserved across locked and unlocked branches. */
export const TransactionBuilderMethod = Object.freeze({
  lock: 'lock',
  concurrency: 'concurrency',
  signal: 'signal',
  timeout: 'timeout',
  run: 'run'
} as const)

/** Optional native author mode exposes no key locks and delegates optimistic execution unchanged. */
export type IOptimisticTransactionBuilderMode = { readonly mode: 'optimistic' }
