import { type IAnyStorageCapability, type ITransactionCapabilityView } from './capability.js'
import { type kv } from './capabilities/kv.js'
import { type ICodecValue } from '@migaia/serialize/codec'
import { type IRecordQuery } from './query-chain.js'
import { StorageStageKind } from './stage-kind.js'
import { type IConflictPolicy, type IStorageKey, type IKeyRange } from './context.js'
import { type IStorageIterator } from './resource.js'
import {
  type IRecordIndexHandle,
  type IRecordIndexProjection,
  type IRecordIndexQuery
} from './secondary-index.js'
import { StorageContractErrorText } from './error-text.js'
import { type IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

/** Reduced write options used inside a backend-owned transaction scope. */
export type ITransactionWriteOptions = {
  /**
   * Conflict rejects an existing key; replace permits overwrite. Omission is interpreted as
   * conflict.
   */
  readonly conflictPolicy?: IConflictPolicy
}

/** Text operations bound to the original transaction scope, without root operation contexts. */
export type ITransactionKeyValueApi = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: ITransactionWriteOptions): Promise<void>
  remove(key: string): Promise<void>
  has(key: string): Promise<boolean>
  getMany(keys: readonly IStorageKey[]): Promise<readonly (string | undefined)[]>
  setMany(
    entries: readonly {
      readonly key: IStorageKey
      readonly value: string
      readonly ttlMs?: number
    }[]
  ): Promise<void>
  removeMany(keys: readonly IStorageKey[]): Promise<number>
  removeByPrefix(prefix: IStorageKey): Promise<number>
}

/** Transaction record queries share the real executor while refusing ordinary operation contexts. */
export type ITransactionRecordsApi<
  TValue = ICodecValue,
  TAugmentMethods extends object = Record<never, never>
> = {
  query<R = TValue>(): IRecordQuery<R, undefined, TAugmentMethods>
  removeByPrefix(prefix: IStorageKey): Promise<number>
}

/** Complete backend-owned transaction view; all methods use the same physical transaction. */
export type ITransactionScope<
  TValue = unknown,
  TCaps extends IAnyStorageCapability = never
> = ITransactionCapabilityView<typeof kv | TCaps, TValue> &
  ITransactionKeyValueApi & {
    getBytes(key: string): Promise<Uint8Array | null>
    setBytes(key: string, value: Uint8Array, options?: ITransactionWriteOptions): Promise<void>
    removeBytes(key: string): Promise<void>
    getRecord(key: IStorageKey): Promise<TValue | undefined>
    putRecord(
      value: TValue,
      key?: IStorageKey,
      options?: ITransactionWriteOptions
    ): Promise<IStorageKey>
    deleteRecord(key: IStorageKey): Promise<void>
    iterateRecords(range?: IKeyRange): IStorageIterator<[IStorageKey, TValue]>
    putIndexedRecord?(
      value: TValue,
      key: IStorageKey,
      handle: IRecordIndexHandle,
      projection: IRecordIndexProjection,
      options?: ITransactionWriteOptions
    ): Promise<IStorageKey>
    /**
     * Reads only this transaction's native index snapshot. Missing, pending or stale handles return
     * false; complete metadata must match the handle's generation and fingerprint. No index is
     * refreshed or created.
     */
    isRecordIndexReady?(handle: IRecordIndexHandle): Promise<boolean>
    iterateRecordIndex?(query: IRecordIndexQuery): IStorageIterator<[IStorageKey, TValue]>
  }

/**
 * Rejects a non-callable transaction callback before a provider allocates transaction resources.
 * Valid functions return without being invoked. Invalid input throws INVALID_ARGUMENT with the
 * supplied backend label and a native TypeError cause; this does not validate callback results.
 */
export const assertTransactionCallback = (run: unknown, backend: IBackendKind): void => {
  if (typeof run === 'function') return
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError(StorageContractErrorText.transactionCallback)
  })
}

/**
 * Reads one transaction write policy before the provider changes records. Omitted options or an
 * omitted conflictPolicy return conflict; the only other accepted value is replace. Invalid
 * shapes/policies throw INVALID_ARGUMENT with the supplied backend label. Accessor or reflection
 * failure remains reachable as cause. No transaction or storage operation is started.
 */
export const readTransactionConflictPolicy = (
  options: unknown,
  backend: IBackendKind
): IConflictPolicy => {
  if (options === undefined) return 'conflict'
  if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
    /** The ordinary option field selects one existing write policy. */
    const policy = (options as { conflictPolicy?: unknown }).conflictPolicy
    if (policy === undefined || policy === 'conflict') return 'conflict'
    if (policy === 'replace') return 'replace'
  }
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError(StorageContractErrorText.transactionWriteOptions)
  })
}

/** Original transaction observations never admit work or alter commit decisions. */
export type ITransactionStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.transaction
  forTransaction: (scope: object) => ITransactionStageObserver
  beforeTransaction?: () => void | PromiseLike<void>
  onTransactionStart?: () => void | PromiseLike<void>
  beforeTxOperation?: (operation: string) => void | PromiseLike<void>
  afterTxOperation?: (operation: string) => void | PromiseLike<void>
  beforeCommit?: () => void | PromiseLike<void>
  afterCommit?: (changedKeys: number) => void | PromiseLike<void>
  afterRollback?: (code?: string) => void | PromiseLike<void>
  onTransactionClose?: () => void | PromiseLike<void>
  beforePersistFlush?: () => void | PromiseLike<void>
  afterPersistFlush?: () => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>

/** Actual backend activity mode, never a caller-supplied permission claim. */
export const TransactionActivityMode = { managed: 'managed', native: 'native' } as const

/** Activity names share the canonical runtime declaration. */
export type TransactionActivityMode = keyof typeof TransactionActivityMode

/** All short-lived views of one transaction return this same immutable fact record. */
export type ITransactionInfo = Readonly<{ id: string; activityMode: TransactionActivityMode }>

/** Working boundaries remain observations; only the backend executes and commits. */
export const TransactionBeforeStage = {
  beforeTransaction: 'beforeTransaction',
  beforeTxOperation: 'beforeTxOperation',
  beforeCommit: 'beforeCommit',
  beforePersistFlush: 'beforePersistFlush'
} as const

/** Before-stage names share one canonical declaration. */
export type TransactionBeforeStage = keyof typeof TransactionBeforeStage

/** Terminal observations use captured identity without reopening a data view. */
export const TransactionObservedStage = {
  onTransactionStart: 'onTransactionStart',
  afterTxOperation: 'afterTxOperation',
  afterCommit: 'afterCommit',
  afterRollback: 'afterRollback',
  onTransactionClose: 'onTransactionClose',
  afterPersistFlush: 'afterPersistFlush'
} as const

/** Observed-stage names share one canonical declaration. */
export type TransactionObservedStage = keyof typeof TransactionObservedStage
