import type {
  IKeyValueApi,
  ILockKey,
  IStorageResource,
  ITransactionInfo,
  ITransactionScope
} from '@migaia/storage-contract'
import type { ILogPayload } from '@migaia/logger/plugins/durable'

/** Private strings belong to the original backend, outside business keys, clear and notifications. */
export type IStorageJournalNamespaceView = {
  get(key: Parameters<IKeyValueApi['get']>[0]): ReturnType<IKeyValueApi['get']>
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
/** One admitted descriptor closes over its original native transaction and immutable org projection. */
export type IStorageJournalBackendBinding = {
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
