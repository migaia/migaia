// Namespace sync, text, bytes, records, transactions and observation surfaces for the memory backend (see ./memory.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertTransactionCallback,
  type ITransactionOptions
} from '@migaia/storage-contract'
import { lockKey } from '../authoring/concurrency.ts'
import { snapshotStorageKey } from '../authoring/key.ts'
import { snapshotSyncWriteOptions } from '../authoring/context.ts'
import { createTransactionBuilder } from '../authoring/transaction.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation } from './memory-constants.ts'
import { createStorageToken } from '../core/storage-token.ts'
import {
  read,
  prepareWrite,
  assertUnlocked,
  planCapacity,
  commitCapacity,
  remove,
  liveEntry,
  mutationRanges,
  clear,
  mutationEntry,
  clearEntry
} from './memory-entries.ts'
import { asyncEntry, rootIterator, atomicEntry, watchChanges } from './memory-namespace-base.ts'
import type { IMemoryNamespaceContext, IMemoryScope } from './memory.ts'

/** Construct synchronous native access without entering asynchronous concurrency. */
export function createMemoryNamespaceSync<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['base']['sync'] {
  return {
    get: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.get, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'value', captured) as string | undefined) ?? null
        }
      ),
    set: (key, value, options) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.set, input: { key, value, options } },
        (captured) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          /** Sync policy capture never calls the asynchronous concurrency callback. */
          const options = snapshotSyncWriteOptions(captured.options)
          /** Payload preparation precedes the final active-key probe. */
          const mutation = prepareWrite(
            namespaceContext,
            'value',
            captured.key,
            captured.value,
            options.conflictPolicy
          )
          assertUnlocked(namespaceContext, mutation.keys)
          /**
           * Synchronous writes share exact victim planning but reject a busy victim without
           * waiting.
           */
          const plan =
            mutation.capacityChanges === undefined
              ? undefined
              : planCapacity(namespaceContext, mutation.capacityChanges())
          const held =
            plan === undefined ? undefined : namespaceContext.locks.probe(plan.identities)
          if (held !== undefined)
            throw new StorageContractError(StorageContractErrorCode.lockRejected, {
              backend: STORAGE_MEMORY_BACKEND,
              keys: [held.key],
              holder: held.holder
            })
          commitCapacity(namespaceContext, plan, mutation.run)
        }
      ),
    remove: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.remove, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          assertUnlocked(namespaceContext, [lockKey.text(captured)])
          remove(namespaceContext, 'value', captured)
        }
      ),
    has: (key) =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.has, input: key },
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read(namespaceContext, 'value', captured) !== undefined
        }
      ),
    keys: () =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.keys, input: undefined },
        () => {
          namespaceContext.controller.assertLive()
          return [...namespaceContext.data.value.entries()]
            .filter(([encoded]) => liveEntry(namespaceContext, 'value', encoded) !== undefined)
            .map(([, entry]) => entry.key)
            .filter((key): key is string => typeof key === 'string')
        }
      ),
    clearValues: () =>
      namespaceContext.core.execution.runSync(
        { operation: MemoryOperation.clearValues, input: undefined },
        () => {
          namespaceContext.controller.assertLive()
          assertUnlocked(namespaceContext, [], mutationRanges(namespaceContext, ['value']))
          clear(namespaceContext, 'value')
        }
      )
  }
}
/** Compose the namespace's original text operations. */
export function createMemoryNamespaceBaseText<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll'
> {
  return {
    get: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.get,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'value', captured) as string | undefined) ?? null
        },
        (captured) => [lockKey.text(captured)]
      ),
    set: (key, value, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.set,
        { key, value },
        ctx,
        (captured, context) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          return prepareWrite(
            namespaceContext,
            'value',
            captured.key,
            captured.value,
            context.conflictPolicy
          )
        }
      ),
    remove: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.remove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.text(captured)],
          invoke: (draft) => {
            draft.remove('value', captured)
          },
          run: () => remove(namespaceContext, 'value', captured)
        }
      }),
    has: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.has,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return read(namespaceContext, 'value', captured) !== undefined
        },
        (captured) => [lockKey.text(captured)]
      ),
    keys: (ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.keys, undefined, ctx, () => {
        namespaceContext.controller.assertLive()
        return [...namespaceContext.data.value.entries()]
          .filter(([encoded]) => liveEntry(namespaceContext, 'value', encoded) !== undefined)
          .map(([, entry]) => entry.key)
          .filter((key): key is string => typeof key === 'string')
      }),
    clearValues: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearValues, 'value', ctx),
    clearAll: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearAll, undefined, ctx)
  }
}
/** Compose the namespace's original bytes operations. */
export function createMemoryNamespaceBaseBytes<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'getBytes' | 'setBytes' | 'removeBytes' | 'clearBytes'
> {
  return {
    getBytes: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.getBytes,
        key,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return (read(namespaceContext, 'bytes', captured) as Uint8Array | undefined) ?? null
        },
        (captured) => [lockKey.bytes(captured)]
      ),
    setBytes: (key, value, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.setBytes,
        { key, value },
        ctx,
        (captured, context) => {
          assertStringStorageKey(captured.key, STORAGE_MEMORY_BACKEND)
          return prepareWrite(
            namespaceContext,
            'bytes',
            captured.key,
            captured.value,
            context.conflictPolicy
          )
        }
      ),
    removeBytes: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.removeBytes, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.bytes(captured)],
          invoke: (draft) => {
            draft.remove('bytes', captured)
          },
          run: () => remove(namespaceContext, 'bytes', captured)
        }
      }),
    clearBytes: (ctx) => clearEntry(namespaceContext, MemoryOperation.clearBytes, 'bytes', ctx)
  }
}
/** Compose the namespace's original records operations. */
export function createMemoryNamespaceBaseRecords<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'getRecord' | 'putRecord' | 'deleteRecord' | 'clearRecords' | 'iterateRecords'
> {
  return {
    getRecord: (key, ctx) =>
      asyncEntry(
        namespaceContext,
        MemoryOperation.getRecord,
        key,
        ctx,
        (captured) => read(namespaceContext, 'record', captured) as T | undefined,
        (captured) => [lockKey.record(captured)]
      ),
    putRecord: (value, key, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.putRecord,
        { value, key },
        ctx,
        (captured, context) => {
          /** Generated identity is fixed once for the logical write, including retries and waiting. */
          const resolved = snapshotStorageKey(
            captured.key ?? createStorageToken(),
            STORAGE_MEMORY_BACKEND
          )
          /** The mutation retains the same detached identity that its implicit locks protect. */
          const mutation = prepareWrite(
            namespaceContext,
            'record',
            resolved,
            captured.value,
            context.conflictPolicy
          )
          return {
            ...mutation,
            invoke: (draft) => {
              mutation.invoke!(draft)
              return resolved
            },
            run: () => {
              mutation.run()
              return resolved
            }
          }
        }
      ),
    deleteRecord: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.deleteRecord, key, ctx, (captured) => {
        /** Mutable record identity detaches before the original policy can wait. */
        const key = snapshotStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [lockKey.record(key)],
          invoke: (draft) => {
            draft.remove('record', key)
          },
          run: () => remove(namespaceContext, 'record', key)
        }
      }),
    clearRecords: (ctx) =>
      clearEntry(namespaceContext, MemoryOperation.clearRecords, 'record', ctx),
    iterateRecords: (range, ctx) => rootIterator(namespaceContext, range, ctx)
  }
}
/** Compose the namespace's original transactions operations. */
export function createMemoryNamespaceBaseTransactions<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<IMemoryNamespaceContext<T>['base'], 'transaction' | 'tx'> {
  return {
    transaction: <R>(
      run: (scope: IMemoryScope<T>) => R,
      ctx?: ITransactionOptions
    ): Promise<Awaited<R>> =>
      atomicEntry(
        namespaceContext,
        MemoryOperation.transaction,
        (context) => ({ run, ctx: context }),
        ctx,
        (input, admit) => {
          assertTransactionCallback(input.run, STORAGE_MEMORY_BACKEND)
          admit()
          /**
           * Keep the original second read before waiting, with no receiver or private draft
           * argument.
           */
          const callback = input.run
          return { invoke: (scope) => callback(scope) }
        }
      ),
    tx: () =>
      createTransactionBuilder(
        namespaceContext.store,
        undefined,
        namespaceContext.core.getChainMethods('tx')
      )
  }
}
/** Compose the namespace's original observation operations. */
export function createMemoryNamespaceBaseObservation<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): Pick<
  IMemoryNamespaceContext<T>['base'],
  'inspectLocks' | 'watch' | 'subscribeChanges' | 'dispose'
> {
  return {
    inspectLocks: (ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.inspectLocks, undefined, ctx, () => {
        namespaceContext.controller.assertLive()
        return namespaceContext.locks.inspectLocks()
      }),
    watch: (key, ctx) => {
      namespaceContext.controller.assertLive()
      assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
      return watchChanges(namespaceContext, 'value', ctx, key)
    },
    subscribeChanges: (listener) => {
      namespaceContext.controller.assertLive()
      return namespaceContext.controller.subscribe((change) => {
        if (namespaceContext.root || change.orgId === namespaceContext.orgId)
          return listener(change)
      })
    },
    dispose: () => namespaceContext.controller.dispose()
  }
}
