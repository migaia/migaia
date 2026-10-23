/** Records only advance from pending to a terminal state. */
export const LogRecordState = { pending: 'pending', done: 'done', aborted: 'aborted' } as const
export type LogRecordState = keyof typeof LogRecordState
/** Fixed observation names shared with adapters; no business payload is attached. */
export const LogStage = {
  beforeLogOpen: 'beforeLogOpen',
  afterLogOpen: 'afterLogOpen',
  onLogOpenError: 'onLogOpenError',
  beforeLogOperation: 'beforeLogOperation',
  afterLogOperation: 'afterLogOperation',
  onLogOperationError: 'onLogOperationError',
  beforeLogClose: 'beforeLogClose',
  afterLogClose: 'afterLogClose',
  onLogCloseError: 'onLogCloseError',
  onAppend: 'onAppend',
  onWalPending: 'onWalPending'
} as const
export type LogStage = keyof typeof LogStage
/** Stable plugin identities and owned undo record discriminator. */
export const DurableKind = { store: 'store', binlog: 'binlog', wal: 'wal', undo: 'undo' } as const
/** Plugin identity differs from the persisted undo record discriminator. */
export const UNDO_PLUGIN_NAME = 'undoLog' as const
/** Operation names remain metadata rather than caller-controlled record kinds. */
export const LogOperation = {
  open: 'open',
  close: 'close',
  append: 'append',
  read: 'read',
  lastSeq: 'lastSeq',
  states: 'states',
  truncate: 'truncate',
  setState: 'setState',
  begin: 'begin',
  complete: 'complete',
  abort: 'abort',
  pending: 'pending',
  record: 'record',
  get: 'get',
  list: 'list',
  forget: 'forget',
  subscribe: 'subscribe',
  cancel: 'cancel',
  deliver: 'deliver'
} as const
