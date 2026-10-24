import type {
  IKeyValueApi,
  IOperationContext,
  ILockKey,
  IStorageResource,
  ITransactionInfo,
  ITransactionScope
} from '@migaia/storage-contract'
import type { ILogPayload, ILogStore, IWalExt } from '@migaia/logger/plugins/durable'
import type { ILoggerCore } from '@migaia/logger'
import type { ILevelPluginExt } from '@migaia/logger/plugins'

/** A configured logger remains borrowed; storage never acquires shutdown or installation rights. */
type IStorageJournalLogger = Pick<
  ILoggerCore,
  'dispatchRaw' | 'onFailure' | 'hook' | 'flush' | 'defer'
>
/** One immutable org configuration selects the original logger and explicit native log objects. */
export type IStorageJournalOptions<L extends IStorageJournalLogger> = {
  readonly logger: L
  readonly namespace: string
  readonly binlogValues?: boolean
  readonly atomicBinlog?: Readonly<Record<string, ILogStore>>
  readonly indexedDbUndo?: boolean
  readonly atomicUndo?: Readonly<Record<string, ILogStore>>
  /** Every redo participant borrows this exact original latest-pending WAL object. */
  readonly redoWal?: IWalExt['wal']
} & (L extends ILevelPluginExt ? { readonly telemetry?: boolean } : { readonly telemetry?: false })
/** Initializers can open only actual installed backend bindings for their immutable org. */
export type IStorageJournalInitializerContext = {
  readonly orgId: string
  storageLogStore(id: string, options: { readonly prefix: string }): Promise<ILogStore>
}
/** Contextual options retain the level-plugin requirement for telemetry=true. */
type IStorageJournalAnyOptions =
  | IStorageJournalOptions<IStorageJournalLogger>
  | IStorageJournalOptions<IStorageJournalLogger & ILevelPluginExt>
/** The original host prepares one configuration per org; initializer results are never replaced. */
export type IStorageJournalConfiguration =
  | IStorageJournalAnyOptions
  | ((
      context: IStorageJournalInitializerContext
    ) => IStorageJournalAnyOptions | PromiseLike<IStorageJournalAnyOptions>)
/** Undo restores a committed target only after its original revision and value checks. */
export type IUndoableStore = {
  undo(
    txId: string,
    ctx?: import('@migaia/storage-contract').IOperationContext
  ): Promise<{ readonly txId: string }>
}
/** The backend invokes its original transaction builder after the journal supplies all locks. */
export type IStorageJournalUndoRunner = (
  keys: readonly ILockKey[],
  work: (scope: Omit<ITransactionScope, 'use'>) => Promise<{ readonly txId: string }>
) => Promise<{ readonly txId: string }>
/** A native attempt records through its actual original scope before the owner's commit. */
export type IStorageJournalAttempt = {
  readonly txId: string
  record(scope: Omit<ITransactionScope, 'use'>): Promise<void>
  /** Drain commit-only external work; failures are reported without changing the native result. */
  settle?(): Promise<void>
}
/** Fixed-org author ports prepare before acquisition and leave all commits with the original owner. */
export type IStorageJournalExecutionPort = {
  prepare(): Promise<void>
  /** Original text owners hold native protection across recovery and the complete operation. */
  runRedo?<R>(run: () => Promise<R>, signal?: IOperationContext['signal']): Promise<R>
  /** The original owner authenticates an exact text-only scope without fake record methods. */
  beginRedo?(scope: object): IStorageJournalRedoAttempt | undefined
  headLocks(): readonly ILockKey[]
  active(): boolean
  begin(scope: Omit<ITransactionScope, 'use'>): IStorageJournalAttempt | undefined
  undo(txId: string, run: IStorageJournalUndoRunner): Promise<{ readonly txId: string }>
}

/** Private strings belong to the original backend, outside business keys, clear and notifications. */
export type IStorageJournalNamespaceView = {
  get(key: Parameters<IKeyValueApi['get']>[0]): ReturnType<IKeyValueApi['get']>
  /** Atomically bootstrap and lock an absent head row inside the original native transaction. */
  getOrInsert?(key: string, initial: string): Promise<string>
  has(key: Parameters<IKeyValueApi['has']>[0]): ReturnType<IKeyValueApi['has']>
  set(
    key: Parameters<IKeyValueApi['set']>[0],
    value: Parameters<IKeyValueApi['set']>[1]
  ): ReturnType<IKeyValueApi['set']>
  remove(key: Parameters<IKeyValueApi['remove']>[0]): ReturnType<IKeyValueApi['remove']>
  clearValues(): ReturnType<IKeyValueApi['clearValues']>
  clearAll(): ReturnType<IKeyValueApi['clearAll']>
  keys(): Promise<readonly string[]>
}
/** A namespace borrows authentic native scopes and forwards their actual terminal callbacks. */
export type IStorageJournalNamespace = IStorageResource & {
  readonly nativeAtomic: boolean
  /** False when the original owner cannot keep a cached log index exclusively valid for its life. */
  readonly indexExclusive?: false
  /** Recheck the original namespace generation before cached reads or native append composition. */
  assertLive?(): void
  /** Return the original authenticated transaction identity for this exact store and organization. */
  transactionInfo(scope: Omit<ITransactionScope, 'use'>): ITransactionInfo
  run<R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    scope?: Omit<ITransactionScope, 'use'>
  ): Promise<R>
  /** Publish ordinary committed metadata inside the original terminal, before its head lease ends. */
  runCommitted?<R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    committed: (value: R) => void
  ): Promise<R>
  onCommit(scope: Omit<ITransactionScope, 'use'>, effect: () => void): () => void
  onRollback(scope: Omit<ITransactionScope, 'use'>, effect: () => void): () => void
}
/** Present values retain the original codec wire; missing values never become null. */
export type IStorageJournalImage =
  | { readonly present: false }
  | { readonly present: true; readonly value: string }
/** Metadata targets use the backend's original finite private lock mapping. */
export type IStorageJournalTarget =
  | ILockKey
  | { readonly channel: 'metadata'; readonly key: string }
/** The backend captures complete revisions and images during the original data transaction. */
export type IStorageJournalChange = Readonly<{
  target: IStorageJournalTarget
  before: IStorageJournalImage
  after: IStorageJournalImage
  afterRevision: ILogPayload
}>
/** Exact text-only scopes retain the same original transaction authentication and finalizer. */
export type IStorageJournalRedoAttempt = {
  readonly txId: string
  record(scope: object): Promise<void>
}
/** A text owner applies only a prepared draft and keeps native protection/lifetime ownership. */
export type IStorageJournalRedoBinding = {
  transactionInfo(scope: object): ITransactionInfo
  changes(scope: object): readonly IStorageJournalChange[]
  protect<R>(run: () => Promise<R>, signal?: IOperationContext['signal']): Promise<R>
  apply(scope: object): void
  /** Return only original invalidation work, dispatched after durable completion succeeds. */
  replay(changes: readonly IStorageJournalChange[]): void | (() => void)
  seal(cause: unknown): void
}

/** One admitted descriptor closes over its original native transaction and immutable org projection. */
export type IStorageJournalBackendBinding = {
  /** Redo never claims a native atomic terminal or private log namespace. */
  readonly redo?: IStorageJournalRedoBinding
  /** This original native owner requires the existing explicit indexedDbUndo configuration. */
  readonly requiresIndexedDbUndo?: true
  /** Original native owner can await external intent I/O after producing final business images. */
  readonly externalWal?: true
  /** Map private image identities onto their original canonical point lock, without granting locks. */
  lockTarget?(target: IStorageJournalTarget): ILockKey
  forOrg(orgId: string): IStorageJournalBackendBinding
  openNamespace(prefix: string): Promise<IStorageJournalNamespace>
  changes?(scope: Omit<ITransactionScope, 'use'>): readonly IStorageJournalChange[]
  readImage?(
    scope: Omit<ITransactionScope, 'use'>,
    target: IStorageJournalTarget
  ): Promise<IStorageJournalImage>
  writeImage?(
    scope: Omit<ITransactionScope, 'use'>,
    target: IStorageJournalTarget,
    image: IStorageJournalImage
  ): Promise<void>
  readRevision?(
    scope: Omit<ITransactionScope, 'use'>,
    target: IStorageJournalTarget
  ): Promise<ILogPayload>
  writeCommitMarker?(scope: Omit<ITransactionScope, 'use'>, txId: string): Promise<void>
  hasCommitMarker?(txId: string): Promise<boolean>
  removeCommitMarker?(txId: string): Promise<void>
}
