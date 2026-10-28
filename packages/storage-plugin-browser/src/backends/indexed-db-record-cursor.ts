// Record rows, record cursor and record pages for the IndexedDB backend (see ./indexed-db.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  mergeSignals,
  readAbortReason,
  throwIfAborted,
  snapshotKeyRange
} from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageBackend, StorageOperation } from '../constants.ts'
import { subscribeToAbort } from './backend-errors.ts'
import {
  fromIdbRequest,
  installIdbRequestHandlers,
  installIdbTransactionHandlers,
  readIdbRequestError,
  readIdbRequestResult,
  readIdbTransactionError
} from '../utils/idb-request.ts'
import type { IKeyRange, IOperationContext, IStorageKey } from '../types/context.ts'
import {
  META_STORE_NAME,
  REVISIONS_STORE_NAME,
  INDEX_RECORDS_STORE_NAME,
  toIdbRange
} from './indexed-db-layout.ts'
import { assertLive, withMutationLease } from './indexed-db-lifecycle.ts'
import { open, createTransaction } from './indexed-db-open.ts'
import { createNativeDataAccess, runTransaction, assertExpiryRemoval } from './indexed-db-root.ts'
import { publishChange } from './indexed-db.ts'
import type { IIndexedDbContext, IMutationLeaseContext } from './indexed-db.ts'

/** Advance the original bounded native cursor while retaining its signal and page ownership. */
/** One bounded index iterator owns continuation, epoch observations and its existing signal. */

/** Advance the original native index pages without adding a cursor or transaction lifecycle. */

/** Advance the original bounded native cursor while retaining its signal and page ownership. */
/** One bounded record iterator owns continuation and its original signal across native pages. */
type IIndexedDbRecordIterator<TValue> = {
  /** Original indexedDbContext belongs to this bounded native iterator. */
  readonly indexedDbContext: IIndexedDbContext<TValue>
  /** Original range belongs to this bounded native iterator. */
  readonly range?: IKeyRange
  /** Original ctx belongs to this bounded native iterator. */
  readonly ctx?: IOperationContext

  rangeSnapshot: ReturnType<typeof snapshotKeyRange>

  /** One reporter shared by every abort subscription inside this iteration operation. */
  runtime: IStorageOperationRuntime
  /** The same merged signal owns cancellation and cleanup for the full iterator. */
  merged: ReturnType<typeof mergeSignals>
  /** The original merged signal port belongs to this iterator only. */
  signal: ReturnType<typeof mergeSignals>['signal']
  /** The original merged dispose port belongs to this iterator only. */
  disposeSignal: ReturnType<typeof mergeSignals>['dispose']
  /** The original merged context port belongs to this iterator only. */
  context: ReturnType<typeof mergeSignals>['context']

  pageSize: number

  lower: IStorageKey | undefined

  lowerOpen: boolean | undefined
}
/** Advance the original native index pages without adding a cursor or transaction lifecycle. */
export async function* indexedDbRecordRows<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  range?: IKeyRange,
  ctx?: IOperationContext
): AsyncGenerator<[IStorageKey, TValue], void, unknown> {
  /** State initializes on the first native advance, preserving the original lazy input boundary. */
  const iteratorState = { indexedDbContext, range, ctx } as IIndexedDbRecordIterator<TValue>

  iteratorState.rangeSnapshot = snapshotKeyRange(iteratorState.range, StorageBackend.indexedDb)

  assertLive(iteratorState.indexedDbContext)

  /** One reporter shared by every abort subscription inside this iteration operation. */
  iteratorState.runtime = createStorageOperationRuntime()
  iteratorState.merged = mergeSignals(iteratorState.ctx, iteratorState.runtime.reporter)
  iteratorState.signal = iteratorState.merged.signal
  iteratorState.disposeSignal = iteratorState.merged.dispose
  iteratorState.context = iteratorState.merged.context

  iteratorState.pageSize = iteratorState.context?.pageSize ?? 128

  iteratorState.lower = iteratorState.rangeSnapshot?.lower

  iteratorState.lowerOpen = iteratorState.rangeSnapshot?.lowerOpen

  try {
    while (true) {
      throwIfAborted(iteratorState.signal)
      const pageRange =
        iteratorState.lower === undefined && iteratorState.rangeSnapshot?.upper === undefined
          ? undefined
          : {
              lower: iteratorState.lower,
              lowerOpen: iteratorState.lowerOpen,
              upper: iteratorState.rangeSnapshot?.upper,
              upperOpen: iteratorState.rangeSnapshot?.upperOpen
            }
      const page = await withMutationLease(iteratorState.indexedDbContext, (lease) =>
        readIndexedDbRecordPage(iteratorState, pageRange, lease)
      )
      if (page.length === 0) return
      for (const entry of page) {
        throwIfAborted(iteratorState.signal)
        yield entry
      }
      if (page.length < iteratorState.pageSize) return
      iteratorState.lower = page[page.length - 1]![0]
      iteratorState.lowerOpen = true
    }
  } finally {
    iteratorState.disposeSignal()
  }
}

/** A native page owns only its selected rows and exhaustion result. */

/** Read one original native index page through the same mutation lease and canonical transaction. */

/** Scan one authenticated native index page in its original transaction. */

/** Reject epoch, generation or readiness changes before this page opens its original cursor. */

/** Seek past the prior physical continuation with the original inclusive native-key rules. */

/** Native record-cursor inputs borrow the original transaction, deadline access and reporter. */
type IIndexedDbRecordCursorOptions<TValue> = {
  readonly indexedDbContext: IIndexedDbContext<TValue>
  readonly transaction: IDBTransaction
  readonly request: IDBRequest<IDBCursorWithValue | null>
  readonly access: ReturnType<typeof createNativeDataAccess<TValue>>
  readonly signal: ReturnType<typeof mergeSignals>['signal']
  readonly runtime: IStorageOperationRuntime
  readonly pageSize: number
}

/** Own one original cursor terminal without adding another native transaction or resource scope. */
class IndexedDbRecordCursor<TValue> {
  /** Native ports retain exactly the page transaction and request already opened by the iterator. */
  #options: IIndexedDbRecordCursorOptions<TValue>
  /** Selected live records remain bounded by the original native page size. */
  #values: Array<[IStorageKey, TValue]> = []
  /** Native completion succeeds only after cursor exhaustion or the original page boundary. */
  #cursorFinished = false
  /** Exactly one native outcome releases the abort subscription and settles this page. */
  #settled = false
  /** Cancellation retains its original reason until the native abort event chooses the result. */
  #cancelled = false
  /** The original abort reason remains reachable on the contract error. */
  #abortReason: unknown
  /** Native setup may settle before abort subscription registration completes. */
  #disposeAbort: () => void = () => {}
  /** The sole page promise resolves after physical completion and commit-only notifications. */
  #resolve!: (values: Array<[IStorageKey, TValue]>) => void
  /** The sole page promise rejects with the original cursor error policy. */
  #reject!: (cause: unknown) => void

  /** Borrow existing native ports; no handlers or subscriptions are installed until run. */
  constructor(options: IIndexedDbRecordCursorOptions<TValue>) {
    this.#options = options
  }

  /** Install handlers synchronously inside the original page promise executor. */
  run(): Promise<Array<[IStorageKey, TValue]>> {
    return new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#install()
    })
  }

  /** Settle the original terminal once and release its exact abort subscription first. */
  #finish(callback: () => void): void {
    if (this.#settled) return
    this.#settled = true
    this.#disposeAbort()
    callback()
  }

  /** Preserve contract errors and the existing native cursor normalization boundary. */
  #failure(cause: unknown): StorageError | StorageContractError {
    return isStorageContractError(cause)
      ? cause
      : new StorageError(StorageBrowserErrorCode.transactionFailed, {
          backend: StorageBackend.indexedDb,
          operation: StorageOperation.indexedDbCursor,
          cause: cause instanceof StorageError ? (cause.cause ?? cause) : cause
        })
  }

  /** Request original native rollback while retaining cancellation as the primary outcome. */
  #abort(): void {
    this.#cancelled = true
    this.#abortReason = readAbortReason(this.#options.signal)
    try {
      this.#options.transaction.abort()
    } catch {
      this.#finish(() =>
        this.#reject(
          new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
        )
      )
    }
  }

  /** Publish original expiry removals only after the page transaction physically completes. */
  #complete(): void {
    this.#finish(() => {
      if (this.#cancelled) {
        this.#reject(
          new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
        )
        return
      }
      if (!this.#cursorFinished) {
        this.#reject(
          this.#failure(new Error('IndexedDB transaction completed before cursor finished'))
        )
        return
      }
      for (const [channel, keys] of this.#options.access.changed)
        if (keys.size > 0)
          publishChange(this.#options.indexedDbContext, {
            channel,
            kind: 'remove',
            keys: [...keys.values()]
          })
      this.#resolve(this.#values)
    })
  }

  /** Preserve the original native error event and its cursor-owned failure metadata. */
  #nativeError(): void {
    this.#finish(() =>
      this.#reject(this.#failure(readIdbTransactionError(this.#options.transaction)))
    )
  }

  /** Native abort selects cancellation only when the original signal requested it. */
  #nativeAbort(): void {
    this.#finish(() =>
      this.#reject(
        this.#cancelled
          ? new StorageContractError(StorageContractErrorCode.aborted, { cause: this.#abortReason })
          : this.#failure(readIdbTransactionError(this.#options.transaction))
      )
    )
  }

  /** Keep native request activity and asynchronous TTL removal on the original callback path. */
  #requestSuccess(): void {
    void this.#advance().catch((cause) => {
      this.#finish(() => this.#reject(this.#failure(cause)))
      try {
        this.#options.transaction.abort()
      } catch {
        /* Native end already owns cleanup. */
      }
    })
  }

  /** Read cursor fields before TTL work and finish indexes at the original page boundary. */
  async #advance(): Promise<void> {
    /** Native cursor identity belongs to the current request activity window. */
    const cursor = readIdbRequestResult(this.#options.request)
    if (cursor === null || this.#values.length >= this.#options.pageSize) {
      await this.#options.access.finishIndexes()
      this.#cursorFinished = true
      return
    }
    /** Original key and value detach from cursor movement before any TTL request can run. */
    const key = cursor.key as IStorageKey
    /** Native structured-clone output remains the row yielded by this page. */
    const value = cursor.value as TValue
    if (await this.#options.access.ttlAccess.present('record', key)) this.#values.push([key, value])
    if (this.#values.length < this.#options.pageSize) cursor.continue()
    else {
      await this.#options.access.finishIndexes()
      this.#cursorFinished = true
    }
  }

  /** Request errors settle through the same original cursor normalization path. */
  #requestFailure(): void {
    this.#finish(() => this.#reject(this.#failure(readIdbRequestError(this.#options.request))))
  }

  /** Native setup keeps its original handler order, subscription point and rollback behavior. */
  #install(): void {
    try {
      installIdbTransactionHandlers(
        this.#options.transaction,
        () => this.#complete(),
        () => this.#nativeError(),
        () => this.#nativeAbort()
      )
      installIdbRequestHandlers(
        this.#options.request,
        () => this.#requestSuccess(),
        () => this.#requestFailure()
      )
      this.#disposeAbort = subscribeToAbort(
        this.#options.signal,
        () => this.#abort(),
        this.#options.runtime.reporter
      )
    } catch (cause) {
      this.#finish(() =>
        this.#reject(
          isStorageContractError(cause) ||
            (cause instanceof StorageError && cause.code === StorageBrowserErrorCode.invalidConfig)
            ? cause
            : this.#failure(cause)
        )
      )
      try {
        this.#options.transaction.abort()
      } catch {
        /* Setup failure already owns the result. */
      }
    }
  }
}

/** Read one native record page on the original journal or direct cursor path. */
async function readIndexedDbRecordPage<TValue>(
  iteratorState: IIndexedDbRecordIterator<TValue>,
  pageRange: IKeyRange | undefined,
  lease: IMutationLeaseContext
): Promise<Array<[IStorageKey, TValue]>> {
  if (iteratorState.indexedDbContext.runtimeJournal !== undefined)
    return runTransaction(
      iteratorState.indexedDbContext,
      async (scope) => {
        const values: Array<[IStorageKey, TValue]> = []
        for await (const entry of scope.iterateRecords(pageRange)) {
          values.push(entry)
          if (values.length >= iteratorState.pageSize) break
        }
        return values
      },
      { ...iteratorState.context, signal: iteratorState.signal },
      lease,
      false,
      {
        read: true,
        executeAttempt: (_context, proceed) => proceed(),
        lock: () => [],
        ranges: () => [],
        notification: { channel: 'record', kind: 'remove' }
      }
    )
  const database = await open(iteratorState.indexedDbContext, iteratorState.runtime, lease)
  assertLive(iteratorState.indexedDbContext)
  const transaction = createTransaction(
    database,
    [
      iteratorState.indexedDbContext.kvStoreName,
      iteratorState.indexedDbContext.bytesStoreName,
      iteratorState.indexedDbContext.recordsStoreName,
      META_STORE_NAME,
      REVISIONS_STORE_NAME,
      ...(database.objectStoreNames.contains(INDEX_RECORDS_STORE_NAME)
        ? [INDEX_RECORDS_STORE_NAME]
        : [])
    ],
    'readwrite'
  )
  /** The original cursor owns this native lifetime; only physical mutations are shared. */
  const access = createNativeDataAccess(
    iteratorState.indexedDbContext,
    transaction,
    undefined,
    iteratorState.runtime,
    (make) => fromIdbRequest(make(), undefined, iteratorState.runtime),
    (
      channel: 'value' | 'bytes' | 'record',
      key: IStorageKey,
      context?: Parameters<IIndexedDbContext<TValue>['coordination']['keyPort']['probe']>[2]
    ) => assertExpiryRemoval(iteratorState.indexedDbContext, channel, key, context)
  )
  const store = transaction.objectStore(iteratorState.indexedDbContext.recordsStoreName)
  const idbRange = toIdbRange(pageRange, iteratorState.indexedDbContext.keyRange)
  const request = idbRange ? store.openCursor(idbRange) : store.openCursor()
  const values = await new IndexedDbRecordCursor<TValue>({
    indexedDbContext: iteratorState.indexedDbContext,
    transaction,
    request,
    access,
    signal: iteratorState.signal,
    runtime: iteratorState.runtime,
    pageSize: iteratorState.pageSize
  }).run()
  return values
}
