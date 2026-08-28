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
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from './sync-started-disposal-ledger.js'
