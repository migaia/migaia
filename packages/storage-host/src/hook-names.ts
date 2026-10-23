/** Stable event keys connect the original observers to the single host hook registry. */
export const StorageHookName = {
  /** Capacity reports only native committed victim counts, once per physical channel. */
  onEvict: 'onEvict',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeHostInstall: 'beforeHostInstall',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterHostInstall: 'afterHostInstall',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onHostInstallError: 'onHostInstallError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeBackendPluginInstall: 'beforeBackendPluginInstall',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterBackendPluginInstall: 'afterBackendPluginInstall',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onBackendPluginInstallError: 'onBackendPluginInstallError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeHostClose: 'beforeHostClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterHostClose: 'afterHostClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onHostCloseError: 'onHostCloseError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeEnvelopeCheck: 'beforeEnvelopeCheck',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterEnvelopeCheck: 'afterEnvelopeCheck',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onVersionRejected: 'onVersionRejected',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeMigrationStep: 'beforeMigrationStep',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterMigrationStep: 'afterMigrationStep',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterMigrate: 'afterMigrate',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeEncode: 'beforeEncode',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterEncode: 'afterEncode',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onEncodeError: 'onEncodeError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeDecode: 'beforeDecode',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterDecode: 'afterDecode',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onDecodeError: 'onDecodeError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeQuery: 'beforeQuery',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterQuery: 'afterQuery',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onQueryError: 'onQueryError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeTransaction: 'beforeTransaction',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onTransactionStart: 'onTransactionStart',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeTxOperation: 'beforeTxOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterTxOperation: 'afterTxOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeCommit: 'beforeCommit',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterCommit: 'afterCommit',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterRollback: 'afterRollback',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onTransactionClose: 'onTransactionClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforePersistFlush: 'beforePersistFlush',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterPersistFlush: 'afterPersistFlush',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeBackendCreate: 'beforeBackendCreate',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterBackendCreate: 'afterBackendCreate',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onBackendRejected: 'onBackendRejected',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterBackendInstall: 'afterBackendInstall',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onBackendDisposeStart: 'onBackendDisposeStart',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterBackendDispose: 'afterBackendDispose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeSql: 'beforeSql',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterSql: 'afterSql',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onSqlError: 'onSqlError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeStorageOperation: 'beforeStorageOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterStorageOperation: 'afterStorageOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onStorageOperationError: 'onStorageOperationError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onStorageIterationClose: 'onStorageIterationClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeLockAcquire: 'beforeLockAcquire',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockAcquired: 'onLockAcquired',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockConflict: 'onLockConflict',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockWait: 'onLockWait',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onConcurrencyDecision: 'onConcurrencyDecision',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onRetry: 'onRetry',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockReleased: 'onLockReleased',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockLost: 'onLockLost',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeLockInspect: 'beforeLockInspect',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterLockInspect: 'afterLockInspect',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLockInspectError: 'onLockInspectError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeLogOpen: 'beforeLogOpen',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterLogOpen: 'afterLogOpen',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLogOpenError: 'onLogOpenError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeLogOperation: 'beforeLogOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterLogOperation: 'afterLogOperation',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLogOperationError: 'onLogOperationError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeLogClose: 'beforeLogClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterLogClose: 'afterLogClose',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onLogCloseError: 'onLogCloseError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onAppend: 'onAppend',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onWalPending: 'onWalPending',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onBinlogAppendError: 'onBinlogAppendError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeJournalRecover: 'beforeJournalRecover',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterJournalRecover: 'afterJournalRecover',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onJournalRecoverError: 'onJournalRecoverError',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  beforeDetect: 'beforeDetect',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  afterDetect: 'afterDetect',
  /** Shared by the stage adapter and typed listener registrations; changing it breaks observation. */
  onDetectError: 'onDetectError'
} as const
