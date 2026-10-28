import { IndexedDbTtlLayout } from './indexed-db-deadline-metadata.js'
import { captureIndexedDbTtlClock, createIndexedDbTtlAccess } from './indexed-db-ttl.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  ttl,
  assertStorageTtlDuration,
  type ITtlTarget,
  type ITransactionTtlApi
} from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  runTransactionOperation,
  snapshotStorageTtlTarget
} from '@migaia/storage-host/sdk'
import { StorageBackend, BrowserTtlMethod, StorageTransactionOperation } from '../constants.js'
import { type ITransactionScope } from '@migaia/storage-contract'
import {
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbNativeRegistration,
  executeOperation,
  rootMutation
} from './indexed-db.js'
/** Public vector TTL is not supported by an IndexedDB backend with no vector collection source. */
export function captureTtlTarget(
  input: ITtlTarget
): Exclude<ITtlTarget, { readonly channel: 'vector' }> {
  /** The original lock/key owner captures and validates every supported target field once. */
  const target = snapshotStorageTtlTarget(input, StorageBackend.indexedDb)
  if (target.channel === 'vector')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: StorageBackend.indexedDb
    })
  return target
}

/** The real native handle is borrowed only after the original owner authorizes this view. */
export function transactionTtlApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: ITransactionScope
): ITransactionTtlApi {
  const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
  const native = indexedDbContext.nativeTransactions.get(id)
  if (native === undefined) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return native.ttl(scope)
}

/** Root TTL endpoints retain one original policy, native transaction and complete pipeline. */
export function createIndexedDbTtlApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['ttlApi'] {
  return {
    expire: (target, ms, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        indexedDbContext,
        BrowserTtlMethod.expire,
        { target, ms },
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input.target)
          assertStorageTtlDuration(input.ms, StorageBackend.indexedDb)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).expire(captured, input.ms) }
        }
      )
    },
    remaining: (target, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        indexedDbContext,
        BrowserTtlMethod.remaining,
        target,
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).remaining(captured) }
        }
      )
    },
    persist: (target, ctx) => {
      let channel: 'value' | 'bytes' | 'record' = 'value'
      return rootMutation(
        indexedDbContext,
        BrowserTtlMethod.persist,
        target,
        ctx,
        {
          get channel() {
            return channel
          },
          kind: 'batch'
        },
        (input) => {
          const captured = captureTtlTarget(input)
          channel = captured.channel === 'text' ? 'value' : captured.channel
          return { keys: [captured], run: (scope) => scope.use(ttl).persist(captured) }
        }
      )
    }
  }
}

/** Borrow the same native registration's ttl operations without adding a resource owner. */
export function indexedDbRegistrationTtl<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<IIndexedDbNativeRegistration<TValue>['ttl']>
): ReturnType<IIndexedDbNativeRegistration<TValue>['ttl']> {
  const [scope] = args
  return {
    expire: (target, ms) =>
      runTransactionOperation(scope, (view) =>
        executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.ttlExpire,
          { target, ms },
          async (_view, input) => {
            const target = captureTtlTarget(input.target)
            assertStorageTtlDuration(input.ms, StorageBackend.indexedDb)
            return nativeState.ttlAccess.expire(
              target.channel === 'text' ? 'value' : target.channel,
              target.key,
              input.ms
            )
          }
        )
      ),
    remaining: (target) =>
      runTransactionOperation(scope, (view) =>
        executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.ttlRemaining,
          target,
          (_view, input) => {
            const target = captureTtlTarget(input)
            return nativeState.ttlAccess.remaining(
              target.channel === 'text' ? 'value' : target.channel,
              target.key
            )
          }
        )
      ),
    persist: (target) =>
      runTransactionOperation(scope, (view) =>
        executeOperation(
          nativeState,
          view,
          StorageTransactionOperation.ttlPersist,
          target,
          (_view, input) => {
            const target = captureTtlTarget(input)
            return nativeState.ttlAccess.persist(
              target.channel === 'text' ? 'value' : target.channel,
              target.key
            )
          }
        )
      )
  }
}

/** TTL Feature owns native deadline schema, clock mapping and the canonical TTL projections. */
export class IndexedDbTtlAssembly {
  readonly clock = captureIndexedDbTtlClock
  readonly access = createIndexedDbTtlAccess
  readonly api = createIndexedDbTtlApi
  readonly transaction = transactionTtlApi
  readonly registration = indexedDbRegistrationTtl
  /** Declare deadline lookup only for the explicitly selected TTL owner. */
  ensureSchema(metadata: IDBObjectStore): boolean {
    if (this.hasSchema(metadata)) return false
    metadata.createIndex(IndexedDbTtlLayout.index, IndexedDbTtlLayout.expiresAt)
    return true
  }
  /** Existing databases upgrade through the original opener when this Feature is added. */
  hasSchema(metadata: IDBObjectStore): boolean {
    return metadata.indexNames.contains(IndexedDbTtlLayout.index)
  }
}
