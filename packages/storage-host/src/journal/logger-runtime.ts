/** Keep the optional logger behind the journal's asynchronous module boundary. */
const runtime = await import('@migaia/log-plugin-durable')

/** Preserve the logger assertion signature without wrapping its original function. */
export const assertLogInteger: typeof import('@migaia/log-plugin-durable').assertLogInteger =
  runtime.assertLogInteger

/** Borrow the original functions and state constants after module loading completes. */
export const {
  LogRecordState,
  createLogStoreIndex,
  prepareLogAppend,
  snapshotLogRecords,
  snapshotLogStoreState
} = runtime

/** Preserve the logger's original record state domain in journal annotations. */
export type LogRecordState = import('@migaia/log-plugin-durable').LogRecordState

export type {
  IBinlogExt,
  ILogAppendNotice,
  ILogAppendPort,
  ILogPayload,
  ILogRecord,
  ILogRecordSnapshot,
  ILogStore,
  ILogStoreRecoveryRow,
  ILogStoreSnapshot,
  IUndoImage,
  IUndoLogExt,
  IWalExt
} from '@migaia/log-plugin-durable'
