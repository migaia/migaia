import type {
  IQueryStageObserver,
  IMigrationStepContext,
  IConcurrencyHolder,
  IConcurrencyDecision
} from '@migaia/storage-contract'
import type { ILogObservation } from '@migaia/log-plugin-durable'

/** Listener registration shares one host event owner and returns its actual unsubscribe handle. */
export type IStorageHooks = {
  on<K extends keyof IStorageHookMap>(
    name: K,
    handler: (payload: IStorageHookMap[K]) => void
  ): () => void
}

/** 真实登记身份。事务编号只取原拥有者登记，不携带 store、scope 或原生客户端。 */
export type IStorageHookIdentity = Readonly<{
  backendId: string
  backend: string
  orgId: string
  transactionId?: string
}>
/** 已归一化的语义码；不收集 Error、消息、认证配置或业务值。 */
export type IStorageHookFailure = Readonly<{ code?: string }>
/** 本批插件的数量，不增加宿主 id 或新的安装状态。 */
export type IStorageHostInstallHookPayload = Readonly<{ pluginCount: number }>
/** 关闭时已登记后端的数量。 */
export type IStorageHostCloseHookPayload = Readonly<{ backendCount: number }>
/** 校验前只报告已知目标版本，不读取尚未校验的 envelope。 */
export type IStorageEnvelopeCheckHookPayload = IStorageHookIdentity &
  Readonly<{ operation: string; targetVersion: number }>
/** 校验成功后才加入已确认的存档版本。 */
export type IStorageEnvelopeHookPayload = IStorageEnvelopeCheckHookPayload &
  Readonly<{ version: number }>
/** 只复用原上下文的版本号，不包含 signal 或迁移值。 */
export type IStorageMigrationStepHookPayload = IStorageHookIdentity &
  Readonly<{ operation: string }> &
  Pick<IMigrationStepContext, 'fromVersion' | 'toVersion'>
/** Codec 接点的两个既有参数；身份由绑定该接点的宿主补入。 */
export type IStorageCodecHookPayload = IStorageHookIdentity &
  Readonly<{ operation: string; codec: string }>
/** 查询源与索引名复用原接点参数，不含查询条件或结果。 */
export type IStorageQueryHookPayload = IStorageHookIdentity &
  Readonly<{
    source: Parameters<NonNullable<IQueryStageObserver['beforeQuery']>>[0]
    index: Parameters<NonNullable<IQueryStageObserver['beforeQuery']>>[1]
  }>
/** 普通操作只报告规范操作名，不包含键、值或原生句柄。 */
export type IStorageOperationHookPayload = IStorageHookIdentity &
  Readonly<{ operation: string; count?: number }>
/** 复用原接点的尝试次数和键数，事件不授予锁或事务权限。 */
export type IStorageLockAttemptHookPayload = IStorageHookIdentity &
  Readonly<{ attempt: number; keyCount: number }>
/** 日志观察复用原形状，不给共享 logger 虚构后端身份。 */
export type IStorageLogHookPayload<TStage extends ILogObservation['stage']> = Omit<
  ILogObservation,
  'stage'
> &
  Readonly<{ stage: TStage }>
/** 只标识日志桥的稳定恢复目标，不携带日志记录。 */
export type IStorageJournalHookPayload = IStorageHookIdentity &
  Readonly<{ namespace: string; backendInstanceId: string }>
/** 两个 HTTP 后端复用同一类型；路径为请求路由，不含认证、请求头、正文或 URL 查询。 */
export type IStorageHttpHookPayload = IStorageHookIdentity &
  Readonly<{
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE'
    path: string
    status?: number
    elapsedMs: number
  }>
/** Interface semantics permit backend packages to augment the single host event map. */
export interface IStorageHookMap {
  onEvict: IStorageHookIdentity & Readonly<{ count: number; channel: string }>
  beforeHostInstall: IStorageHostInstallHookPayload
  afterHostInstall: IStorageHostInstallHookPayload
  onHostInstallError: IStorageHostInstallHookPayload & IStorageHookFailure
  beforeBackendPluginInstall: IStorageHookIdentity
  afterBackendPluginInstall: IStorageHookIdentity
  onBackendPluginInstallError: IStorageHookIdentity & IStorageHookFailure
  beforeHostClose: IStorageHostCloseHookPayload
  afterHostClose: IStorageHostCloseHookPayload
  onHostCloseError: IStorageHostCloseHookPayload & IStorageHookFailure
  beforeEnvelopeCheck: IStorageEnvelopeCheckHookPayload
  afterEnvelopeCheck: IStorageEnvelopeHookPayload
  onVersionRejected: IStorageEnvelopeCheckHookPayload &
    IStorageHookFailure &
    Readonly<{ version?: number }>
  beforeMigrationStep: IStorageMigrationStepHookPayload
  afterMigrationStep: IStorageMigrationStepHookPayload
  afterMigrate: IStorageEnvelopeHookPayload &
    Readonly<{ mode: 'steps' | 'reset'; stepCount: number; elapsedMs: number }>
  beforeEncode: IStorageCodecHookPayload
  afterEncode: IStorageCodecHookPayload
  onEncodeError: IStorageCodecHookPayload & IStorageHookFailure
  beforeDecode: IStorageCodecHookPayload
  afterDecode: IStorageCodecHookPayload
  onDecodeError: IStorageCodecHookPayload & IStorageHookFailure
  beforeQuery: IStorageQueryHookPayload &
    Readonly<{ plan: Parameters<NonNullable<IQueryStageObserver['beforeQuery']>>[2] }>
  afterQuery: IStorageQueryHookPayload &
    Readonly<{ stats: Parameters<NonNullable<IQueryStageObserver['afterQuery']>>[2] }>
  onQueryError: IStorageQueryHookPayload & IStorageHookFailure
  beforeTransaction: IStorageHookIdentity
  onTransactionStart: IStorageHookIdentity
  beforeTxOperation: IStorageOperationHookPayload
  afterTxOperation: IStorageOperationHookPayload
  beforeCommit: IStorageHookIdentity
  afterCommit: IStorageHookIdentity & Readonly<{ changedKeys: number }>
  afterRollback: IStorageHookIdentity & IStorageHookFailure
  onTransactionClose: IStorageHookIdentity
  beforePersistFlush: IStorageHookIdentity
  afterPersistFlush: IStorageHookIdentity
  beforeBackendCreate: IStorageHookIdentity
  afterBackendCreate: IStorageHookIdentity
  onBackendRejected: IStorageHookIdentity & IStorageHookFailure
  afterBackendInstall: IStorageHookIdentity
  onBackendDisposeStart: IStorageHookIdentity
  afterBackendDispose: IStorageHookIdentity
  beforeSql: IStorageHookIdentity & Readonly<{ parameterCount: number; sqlBytes: number }>
  afterSql: IStorageHookIdentity & Readonly<{ elapsedMs: number; rows: number | bigint }>
  onSqlError: IStorageHookIdentity & IStorageHookFailure
  beforeStorageOperation: IStorageOperationHookPayload
  afterStorageOperation: IStorageOperationHookPayload &
    Readonly<{ elapsedMs: number; count: number }>
  onStorageOperationError: IStorageOperationHookPayload & IStorageHookFailure
  onStorageIterationClose: IStorageHookIdentity & Readonly<{ count: number }>
  beforeLockAcquire: IStorageHookIdentity & Readonly<{ policyName: string; keyCount: number }>
  onLockAcquired: IStorageLockAttemptHookPayload
  onLockConflict: IStorageLockAttemptHookPayload &
    Readonly<{ phase: 'acquire' | 'commit'; holder: IConcurrencyHolder | undefined }>
  onLockWait: IStorageHookIdentity & Readonly<{ attempt: number; waitedMs: number }>
  onConcurrencyDecision: IStorageHookIdentity &
    Readonly<{ action: IConcurrencyDecision['action']; attempt: number }>
  onRetry: IStorageHookIdentity &
    Readonly<{ attempt: number; delayMs: number; reason?: 'physical' | 'write-conflict' }>
  onLockReleased: IStorageLockAttemptHookPayload
  onLockLost: IStorageLockAttemptHookPayload
  beforeLockInspect: IStorageHookIdentity
  afterLockInspect: IStorageHookIdentity & Readonly<{ count: number }>
  onLockInspectError: IStorageHookIdentity & IStorageHookFailure
  beforeLogOpen: IStorageLogHookPayload<'beforeLogOpen'>
  afterLogOpen: IStorageLogHookPayload<'afterLogOpen'>
  onLogOpenError: IStorageLogHookPayload<'onLogOpenError'>
  beforeLogOperation: IStorageLogHookPayload<'beforeLogOperation'>
  afterLogOperation: IStorageLogHookPayload<'afterLogOperation'>
  onLogOperationError: IStorageLogHookPayload<'onLogOperationError'>
  beforeLogClose: IStorageLogHookPayload<'beforeLogClose'>
  afterLogClose: IStorageLogHookPayload<'afterLogClose'>
  onLogCloseError: IStorageLogHookPayload<'onLogCloseError'>
  onAppend: IStorageLogHookPayload<'onAppend'>
  onWalPending: IStorageLogHookPayload<'onWalPending'>
  onBinlogAppendError: IStorageJournalHookPayload & IStorageHookFailure & Readonly<{ txId: string }>
  beforeJournalRecover: IStorageJournalHookPayload
  afterJournalRecover: IStorageJournalHookPayload & Readonly<{ count: number; elapsedMs: number }>
  onJournalRecoverError: IStorageJournalHookPayload & IStorageHookFailure
  beforeDetect: IStorageHookIdentity
  afterDetect: IStorageHookIdentity & Readonly<{ checkCount: number; elapsedMs: number }>
  onDetectError: IStorageHookIdentity & IStorageHookFailure
}
