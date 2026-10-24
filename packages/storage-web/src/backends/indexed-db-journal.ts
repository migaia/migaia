import {
  StorageContractError,
  StorageContractErrorCode,
  runTransactionOperation,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalNamespaceView } from '@migaia/storage-host'
import { createEventChannel } from '@migaia/event-subscriber'

/** Private array keys never overlap public metadata strings or existing TTL/index rows. */
export const IndexedDbJournalLayout = {
  namespace: 'journal',
  resource: 'storage-web:journal'
} as const

/** Native terminal observations reuse the original event owner and retain no transaction history. */
export function createIndexedDbJournalTerminal(report: (error: unknown) => void) {
  /** Callbacks run only for the native complete event, before business notifications. */
  const committed = createEventChannel<void>({ report: ({ error }) => report(error) })
  /** Native abort is distinct from a requested abort or a failed user callback. */
  const rolledBack = createEventChannel<void>({ report: ({ error }) => report(error) })
  /** Resource cleanup also observes the actual native end. */
  const ended = createEventChannel<void>({ report: ({ error }) => report(error) })
  return {
    onCommit: (effect: () => void) => committed.subscribe(() => effect()),
    onRollback: (effect: () => void) => rolledBack.subscribe(() => effect()),
    onEnd: (effect: () => void) => ended.subscribe(() => effect()),
    complete: (success: boolean): void => {
      try {
        if (success) committed.publish(undefined)
        else rolledBack.publish(undefined)
      } finally {
        ended.publish(undefined)
        committed.clear()
        rolledBack.clear()
        ended.clear()
      }
    }
  }
}

/** Private I/O borrows the exact authenticated scope, native META store and original request bridge. */
export function createIndexedDbJournalView(input: {
  readonly scope: Omit<ITransactionScope, 'use'>
  readonly metadata: IDBObjectStore
  readonly namespace: string
  readonly prefix: string
  readonly keyRange: typeof IDBKeyRange
  readonly request: <R>(make: () => IDBRequest<R>) => Promise<R>
}): IStorageJournalNamespaceView {
  /** This fixed tuple is private to this physical organization's existing META object store. */
  const prefix = [input.namespace, IndexedDbJournalLayout.namespace, input.prefix]
  /** All supported row keys are strings, which sort below this exclusive array sentinel. */
  const range = input.keyRange.bound(prefix, [...prefix, []], false, true)
  /** Strings are never coerced, so caller objects cannot alter an owned metadata address. */
  const key = (value: unknown): IDBValidKey => {
    if (typeof value !== 'string')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return [...prefix, value]
  }
  /** Both clear names affect only this fixed private namespace, without business invalidations. */
  const clear = () =>
    runTransactionOperation(input.scope, async () => {
      await input.request(() => input.metadata.delete(range))
    })
  return Object.freeze({
    get: (value: string) =>
      runTransactionOperation(
        input.scope,
        async () =>
          ((await input.request(() => input.metadata.get(key(value)))) as string | undefined) ??
          null
      ),
    has: (value: string) =>
      runTransactionOperation(
        input.scope,
        async () => (await input.request(() => input.metadata.count(key(value)))) !== 0
      ),
    set: (value: string, text: string) =>
      runTransactionOperation(input.scope, async () => {
        if (typeof text !== 'string')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        await input.request(() => input.metadata.put(text, key(value)))
      }),
    remove: (value: string) =>
      runTransactionOperation(input.scope, async () => {
        await input.request(() => input.metadata.delete(key(value)))
      }),
    keys: () =>
      runTransactionOperation(input.scope, async () =>
        (await input.request(() => input.metadata.getAllKeys(range))).map(
          (key) => (key as string[])[3]!
        )
      ),
    clearValues: clear,
    clearAll: clear
  })
}
