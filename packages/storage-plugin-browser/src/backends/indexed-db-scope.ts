// Transaction scope channels and native registration for the IndexedDB backend (see ./indexed-db.ts).
import { IndexedDbFeature } from '../constants.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  runTransactionOperation,
  useTransactionCapability,
  readConcurrencyLockIdentities,
  lockKey,
  snapshotStorageKeyPrefix,
  snapshotStorageKey,
  createStorageToken
} from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageTransactionOperation } from '../constants.js'
import { assertStringStorageKey } from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { readTransactionConflictPolicy } from '@migaia/storage-contract'
import { indexedDbFeatureMissing } from './indexed-db-base-access.js'
import { runNativeIndexedDbTransaction } from './indexed-db-transaction.js'
import {
  request,
  write,
  remove,
  recordIterator,
  executeOperation,
  clearRoot,
  removePrefix
} from './indexed-db-attempt.js'
import type { IIndexedDbNativeCallback } from './indexed-db-attempt.js'
import {
  readIndexedDbBytes,
  toIdbKey,
  snapshotWriteValue,
  REVISIONS_STORE_NAME,
  RECORD_EPOCH_KEY
} from './indexed-db-layout.js'
import { indexScopeEpochKey } from './indexed-db-lifecycle.js'
import type { IIndexedDbTransactionScope, IIndexedDbContext } from './indexed-db.js'

/** Every short-lived view closes over the same native transaction and complete method set. */
/** Each complete view borrows the same original native callback and transaction admission. */
export type IIndexedDbScopeContext<TValue, T> = {
  /** The physical callback owns native data, signal, stages and terminal outcome. */
  readonly nativeState: IIndexedDbNativeCallback<TValue, T>
  /** The original transaction owner authenticates this exact public view. */
  scope: IIndexedDbTransactionScope<TValue>
}
/** Publish all native channel methods before adding the selected Feature API. */
export function createScope<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): IIndexedDbTransactionScope<TValue> {
  /** No callback runs before this original view has finished construction. */
  const scopeState = { nativeState } as IIndexedDbScopeContext<TValue, T>
  scopeState.scope = {
    use: (capability) => useTransactionCapability(scopeState.scope, capability),
    ...(nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.batch?.scope(
      scopeState
    ) ?? indexedDbFeatureMissing.batch()),
    ...createIndexedDbScopeText(scopeState),
    ...createIndexedDbScopeBytes(scopeState),
    ...createIndexedDbScopeRecords(scopeState),
    ...(nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.indexes?.scope(
      scopeState
    ) ?? indexedDbFeatureMissing.scopeIndexes())
  }
  /** Feature methods attach to the same authentic native view. */
  const api =
    nativeState.attemptState.logicalTransaction.indexedDbContext.runtime.createTransactionApi(
      scopeState.scope
    )
  if (api !== undefined)
    Object.defineProperty(scopeState.scope, 'api', { value: api, enumerable: true })
  return scopeState.scope
}

/**
 * Store shape the IndexedDbScopeText class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbScopeTextShape<TValue> = Pick<
  IIndexedDbTransactionScope<TValue>,
  'get' | 'set' | 'remove' | 'has'
>

/** Text channel of one IndexedDB transaction scope. */
class IndexedDbScopeText<TValue, T> implements IIndexedDbScopeTextShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #scopeState: IIndexedDbScopeContext<TValue, T>

  get: IIndexedDbScopeTextShape<TValue>['get'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.get,
      key,
      async (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (!(await this.#scopeState.nativeState.ttlAccess.present('value', key))) return null
        const value = await request(this.#scopeState.nativeState, () =>
          this.#scopeState.nativeState.native
            .objectStore(
              this.#scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext
                .kvStoreName
            )
            .get(key)
        )
        return typeof value === 'string' ? value : null
      }
    )

  set: IIndexedDbScopeTextShape<TValue>['set'] = (key, value, options) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.set,
      { key, value, options },
      (_view, { key, value, options }) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (typeof value !== 'string')
          throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError(StorageErrorText.storageValueInvalid)
          })
        return write(
          this.#scopeState.nativeState,
          'value',
          key,
          value,
          readTransactionConflictPolicy(options, StorageBackend.indexedDb)
        )
      }
    )

  remove: IIndexedDbScopeTextShape<TValue>['remove'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.remove,
      key,
      (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return remove(this.#scopeState.nativeState, 'value', key)
      }
    )

  has: IIndexedDbScopeTextShape<TValue>['has'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.has,
      key,
      async (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return this.#scopeState.nativeState.ttlAccess.present('value', key)
      }
    )

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(scopeState: IIndexedDbScopeContext<TValue, T>) {
    this.#scopeState = scopeState
  }
}

/** Compose this authentic native scope's text operations. */
function createIndexedDbScopeText<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<IIndexedDbTransactionScope<TValue>, 'get' | 'set' | 'remove' | 'has'> {
  return new IndexedDbScopeText<TValue, T>(scopeState)
}

/**
 * Store shape the IndexedDbScopeBytes class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbScopeBytesShape<TValue> = Pick<
  IIndexedDbTransactionScope<TValue>,
  'getBytes' | 'setBytes' | 'removeBytes'
>

/** Bytes channel of one IndexedDB transaction scope. */
class IndexedDbScopeBytes<TValue, T> implements IIndexedDbScopeBytesShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #scopeState: IIndexedDbScopeContext<TValue, T>

  getBytes: IIndexedDbScopeBytesShape<TValue>['getBytes'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.getBytes,
      key,
      async (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (!(await this.#scopeState.nativeState.ttlAccess.present('bytes', key))) return null
        const value = await request(this.#scopeState.nativeState, () =>
          this.#scopeState.nativeState.native
            .objectStore(
              this.#scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext
                .bytesStoreName
            )
            .get(key)
        )
        return readIndexedDbBytes(value)
      }
    )

  setBytes: IIndexedDbScopeBytesShape<TValue>['setBytes'] = (key, value, options) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.setBytes,
      { key, value, options },
      (_view, { key, value, options }) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        if (!isUint8Array(value))
          throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
            backend: StorageBackend.indexedDb,
            key,
            cause: new TypeError(StorageErrorText.storageBytesInvalid)
          })
        const snapshot =
          this.#scopeState.nativeState.attemptState.logicalTransaction.root === undefined
            ? value.slice()
            : value
        return write(
          this.#scopeState.nativeState,
          'bytes',
          key,
          snapshot,
          readTransactionConflictPolicy(options, StorageBackend.indexedDb)
        )
      }
    )

  removeBytes: IIndexedDbScopeBytesShape<TValue>['removeBytes'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.removeBytes,
      key,
      (_view, key) => {
        assertStringStorageKey(key, StorageBackend.indexedDb)
        return remove(this.#scopeState.nativeState, 'bytes', key)
      }
    )

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(scopeState: IIndexedDbScopeContext<TValue, T>) {
    this.#scopeState = scopeState
  }
}

/** Compose this authentic native scope's bytes operations. */
function createIndexedDbScopeBytes<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<IIndexedDbTransactionScope<TValue>, 'getBytes' | 'setBytes' | 'removeBytes'> {
  return new IndexedDbScopeBytes<TValue, T>(scopeState)
}

/**
 * Store shape the IndexedDbScopeRecords class implements; named because implements cannot take an
 * intersection.
 */
type IIndexedDbScopeRecordsShape<TValue> = Pick<
  IIndexedDbTransactionScope<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'iterateRecords'
>

/** Record channel of one IndexedDB transaction scope. */
class IndexedDbScopeRecords<TValue, T> implements IIndexedDbScopeRecordsShape<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #scopeState: IIndexedDbScopeContext<TValue, T>

  getRecord: IIndexedDbScopeRecordsShape<TValue>['getRecord'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.getRecord,
      key,
      async (_view, key) => {
        const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        if (!(await this.#scopeState.nativeState.ttlAccess.present('record', snapshot)))
          return undefined
        return request(this.#scopeState.nativeState, () =>
          this.#scopeState.nativeState.native
            .objectStore(
              this.#scopeState.nativeState.attemptState.logicalTransaction.indexedDbContext
                .recordsStoreName
            )
            .get(toIdbKey(snapshot))
        ) as Promise<TValue | undefined>
      }
    )

  putRecord: IIndexedDbScopeRecordsShape<TValue>['putRecord'] = (value, key, options) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.putRecord,
      { value, key, options },
      async (_view, { value, key, options }) => {
        const snapshot = snapshotStorageKey(key ?? createStorageToken(), StorageBackend.indexedDb)
        const copy =
          this.#scopeState.nativeState.attemptState.logicalTransaction.root === undefined
            ? snapshotWriteValue(value, snapshot)
            : value
        await write(
          this.#scopeState.nativeState,
          'record',
          snapshot,
          copy,
          readTransactionConflictPolicy(options, StorageBackend.indexedDb)
        )
        return snapshot
      }
    )

  deleteRecord: IIndexedDbScopeRecordsShape<TValue>['deleteRecord'] = (key) =>
    indexedDbScopeOperation(
      this.#scopeState,
      StorageTransactionOperation.deleteRecord,
      key,
      (_view, key) => {
        const snapshot = snapshotStorageKey(key, StorageBackend.indexedDb)
        return remove(this.#scopeState.nativeState, 'record', snapshot)
      }
    )

  iterateRecords: IIndexedDbScopeRecordsShape<TValue>['iterateRecords'] = (range) =>
    recordIterator(this.#scopeState.nativeState, this.#scopeState.scope, range)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(scopeState: IIndexedDbScopeContext<TValue, T>) {
    this.#scopeState = scopeState
  }
}

/** Compose this authentic native scope's records operations. */
function createIndexedDbScopeRecords<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<
  IIndexedDbTransactionScope<TValue>,
  'getRecord' | 'putRecord' | 'deleteRecord' | 'iterateRecords'
> {
  return new IndexedDbScopeRecords<TValue, T>(scopeState)
}
/** Compose this authentic native scope's indexes operations. */

/** Admit one scope operation before the original pipeline and native request. */
export function indexedDbScopeOperation<TValue, T, TInput, R>(
  scopeState: IIndexedDbScopeContext<TValue, T>,
  name: string,
  input: TInput,
  run: (view: IIndexedDbTransactionScope<TValue>, input: TInput) => R
): Promise<Awaited<R>> {
  return runTransactionOperation(scopeState.scope, (view) =>
    executeOperation(scopeState.nativeState, view, name, input, run)
  )
}

/** The original native runner's callbacks retain the actual complete transaction scope. */
export type IIndexedDbNativeRun<TValue, T> = Parameters<
  typeof runNativeIndexedDbTransaction<TValue, T, IIndexedDbTransactionScope<TValue>>
>[0]
/** Execute the original native registerNative phase under its existing transaction owner. */
export function indexedDbNativeRegisterNative<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>> {
  const [scope, abort] = args
  const { id } = assertTransactionOwner(
    nativeState.attemptState.logicalTransaction.indexedDbContext.store,
    scope
  )
  nativeState.attemptState.logicalTransaction.indexedDbContext.nativeTransactions.set(
    id,
    createIndexedDbNativeRegistration(nativeState, abort)
  )
  return () => {
    nativeState.attemptState.logicalTransaction.indexedDbContext.nativeTransactions.delete(id)
  }
}
/** Execute the original native beforeCommit phase under its existing transaction owner. */
export async function indexedDbNativeBeforeCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['beforeCommit']>>
): Promise<void> {
  const [scope] = args
  await nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.indexes?.beforeCommit(
    nativeState
  )
  await nativeState.finishIndexes()
  await nativeState.journalAttempt?.record(scope)
}
/** Execute the original native validateCommit phase under its existing transaction owner. */
export function indexedDbNativeValidateCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['validateCommit']>> {
  /** A retained value whose deadline elapsed cannot be committed as still live. */
  const expired = nativeState.ttlAccess.expiredObservation()
  if (expired !== undefined) {
    const key =
      expired.channel === 'value'
        ? lockKey.text(expired.key)
        : expired.channel === 'record'
          ? lockKey.record(expired.key)
          : lockKey.bytes(expired.key as string)
    nativeState.attemptState.commitFailure = new StorageContractError(
      StorageContractErrorCode.writeConflict,
      {
        backend: StorageBackend.indexedDb,
        keys: [key]
      }
    )
    nativeState.attemptState.commitConflict = {
      status: 'conflict',
      phase: 'commit',
      keys: [key],
      holder: undefined,
      cause: nativeState.attemptState.commitFailure
    }
    throw nativeState.attemptState.commitFailure
  }
  /** New logical holders are checked after real native work and before commit. */
  const held =
    nativeState.attemptState.logicalTransaction.indexedDbContext.coordination.keyPort.probe(
      readConcurrencyLockIdentities(nativeState.attemptState.context),
      nativeState.attemptState.logicalTransaction.root?.ranges(),
      nativeState.attemptState.context
    )
  if (held !== undefined) {
    nativeState.attemptState.commitFailure = new StorageContractError(
      StorageContractErrorCode.writeConflict,
      {
        backend: StorageBackend.indexedDb,
        keys: [held.key],
        holder: held.holder
      }
    )
    nativeState.attemptState.commitConflict = {
      status: 'conflict',
      phase: 'commit',
      keys: [held.key],
      holder: held.holder,
      cause: nativeState.attemptState.commitFailure
    }
    throw nativeState.attemptState.commitFailure
  }
}

/** The physical registry stores exactly the existing native operation table. */
export type IIndexedDbNativeRegistration<TValue> =
  IIndexedDbContext<TValue>['nativeTransactions'] extends Map<string, infer V> ? V : never
/** Borrow the same native registration's readKeys operations without adding a resource owner. */
async function indexedDbRegistrationReadKeys<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): Promise<string[]> {
  const keys = await request(nativeState, () =>
    nativeState.native
      .objectStore(nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName)
      .getAllKeys()
  )
  const live: string[] = []
  for (const key of keys) {
    assertStringStorageKey(key, StorageBackend.indexedDb, 'persisted value key')
    if (await nativeState.ttlAccess.present('value', key)) live.push(key)
  }
  return live
}

/** Assemble only the original native transaction's retained operation ports. */
function createIndexedDbNativeRegistration<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  abort: Parameters<NonNullable<IIndexedDbNativeRun<TValue, T>['registerNative']>>[1]
): IIndexedDbNativeRegistration<TValue> {
  return {
    native: nativeState.native,
    readKeys: () => indexedDbRegistrationReadKeys(nativeState),
    journal: (...args) => {
      const owner = nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.journal
      if (owner === undefined) return indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
      return owner.registration(nativeState, ...args)
    },
    images:
      nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.journal?.registrationImages(
        nativeState
      ) ?? indexedDbFeatureMissing.images(),
    abort,
    clearRoot: (channel: 'value' | 'bytes' | 'record' | undefined) =>
      clearRoot(nativeState, channel),
    expiredRecord: (key) => nativeState.ttlAccess.expired('record', key),
    recordEpoch: async (scope) => ({
      global:
        ((await request(nativeState, () =>
          nativeState.native.objectStore(REVISIONS_STORE_NAME).get(RECORD_EPOCH_KEY)
        )) as number) ?? 0,
      scope:
        (((await request(nativeState, () =>
          nativeState.native.objectStore(REVISIONS_STORE_NAME).get(indexScopeEpochKey(scope))
        )) as number) ?? 0) + (nativeState.indexedScopes.has(scope) ? 1 : 0)
    }),
    ttl: (...args) => {
      const owner = nativeState.attemptState.logicalTransaction.indexedDbContext.assemblies.ttl
      if (owner === undefined) return indexedDbFeatureMissing.fail(IndexedDbFeature.ttl)
      return owner.registration(nativeState, ...args)
    },
    removeRecordsByPrefix: (scope, prefix) =>
      runTransactionOperation(scope, (view) => {
        const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
        return executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.removeRecordsByPrefix,
          undefined,
          () => removePrefix(nativeState, 'record', captured)
        )
      })
  }
}
