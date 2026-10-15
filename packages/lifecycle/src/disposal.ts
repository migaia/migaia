/** Public disposal leaf barrel; implementations remain owned by their canonical modules. */
export {
  executeReleaseDescriptor,
  createDisposeTransaction,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions
} from './dispose-transaction.js'
export {
  createSyncStartedDisposalLedger,
  mergeCleanupResults,
  type ICleanupResult,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from './dispose-transaction.js'
