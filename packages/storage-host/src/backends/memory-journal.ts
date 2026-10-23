import { createEventChannel } from '@migaia/event-subscriber'
import { createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from '../journal/types.js'

/** A private native scope carries the same draft and terminal effects as its business writes. */
export type IMemoryJournalTransaction = {
  run<R>(prefix: string, work: (view: IStorageJournalNamespaceView) => Promise<R>): Promise<R>
  onCommit(effect: () => void): () => void
  onRollback(effect: () => void): () => void
}
/** Only the current attempt's reads and changes are retained, without cloning journal history. */
type IMemoryJournalDraft = {
  readonly base: Map<string, string> | undefined
  readonly reads: Map<string, string | undefined>
  readonly writes: Map<string, string | undefined>
  keys: Set<string> | undefined
}
/** Private strings use the original argument code and never coerce a caller's object. */
function assertText(value: unknown): asserts value is string {
  if (typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
}
/** Private journal rows share the physical memory namespace and its original transaction owner. */
export function createMemoryJournalData(options: {
  readonly assertLive: () => void
  readonly report: (error: unknown) => void
  readonly transaction: <R>(work: (port: IMemoryJournalTransaction) => Promise<R>) => Promise<R>
  readonly scope: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly info: ITransactionInfo
    readonly port: IMemoryJournalTransaction
  }
}) {
  /** Business clear and capacity never enumerate these original backend-private metadata rows. */
  let namespaces = new Map<string, Map<string, string>>()

  /** Prepare sparse private writes beside the same native attempt's existing business draft. */
  function draft() {
    /** Replacing the private physical map invalidates even an initially empty pre-drop attempt. */
    const generation = namespaces
    /** Each touched private namespace retains its original committed map identity. */
    const touched = new Map<string, IMemoryJournalDraft>()
    /** Original event delivery observes synchronous and late terminal-listener failures. */
    const committed = createEventChannel<void>({ report: ({ error }) => options.report(error) })
    /** Rollback effects use the same terminal channel owner and report policy. */
    const rolledBack = createEventChannel<void>({ report: ({ error }) => options.report(error) })
    /** A native attempt publishes exactly one actual terminal result. */
    let settled = false
    /** Capture a namespace on first access; untouched rows stay in the original physical Map. */
    const state = (prefix: string): IMemoryJournalDraft => {
      let entry = touched.get(prefix)
      if (entry === undefined) {
        entry = {
          base: namespaces.get(prefix),
          reads: new Map(),
          writes: new Map(),
          keys: undefined
        }
        touched.set(prefix, entry)
      }
      return entry
    }
    /** First reads are repeatable, including absence, until this same draft overwrites the key. */
    const read = (entry: IMemoryJournalDraft, key: string): string | undefined => {
      if (entry.writes.has(key)) return entry.writes.get(key)
      if (!entry.reads.has(key)) entry.reads.set(key, entry.base?.get(key))
      return entry.reads.get(key)
    }
    /** The original scope supplies authorization on every extracted private method invocation. */
    const port = {
      run: async <R>(
        prefix: string,
        work: (view: IStorageJournalNamespaceView) => Promise<R>,
        execute: <V>(run: () => V) => Promise<Awaited<V>>
      ): Promise<R> => {
        const entry = state(prefix)
        /**
         * Prefix-wide metadata operations retain one exact membership observation for commit
         * checks.
         */
        const keys = (): Set<string> => {
          entry.keys ??= new Set(entry.base?.keys())
          const result = new Set(entry.keys)
          for (const [key, value] of entry.writes) {
            if (value === undefined) result.delete(key)
            else result.add(key)
          }
          return result
        }
        /** Both legacy text clear names affect only this authenticated private namespace. */
        const clear = () =>
          execute(() => {
            for (const key of keys()) {
              read(entry, key)
              entry.writes.set(key, undefined)
            }
          })
        const view: IStorageJournalNamespaceView = {
          get: (key) =>
            execute(() => {
              assertText(key)
              return read(entry, key) ?? null
            }),
          has: (key) =>
            execute(() => {
              assertText(key)
              return read(entry, key) !== undefined
            }),
          set: (key, value) =>
            execute(() => {
              assertText(key)
              assertText(value)
              read(entry, key)
              entry.writes.set(key, value)
            }),
          remove: (key) =>
            execute(() => {
              assertText(key)
              read(entry, key)
              entry.writes.set(key, undefined)
            }),
          keys: () => execute(() => [...keys()]),
          clearValues: clear,
          clearAll: clear
        }
        return work(Object.freeze(view))
      },
      onCommit: (effect: () => void) => committed.subscribe(() => effect()),
      onRollback: (effect: () => void) => rolledBack.subscribe(() => effect())
    }
    return {
      port,
      conflict: (): string | undefined => {
        if (generation !== namespaces) return touched.keys().next().value
        for (const [prefix, entry] of touched) {
          const current = namespaces.get(prefix)
          if (current !== entry.base) return prefix
          for (const [key, value] of entry.reads) if (current?.get(key) !== value) return prefix
          if (
            entry.keys !== undefined &&
            ((current?.size ?? 0) !== entry.keys.size ||
              [...(current?.keys() ?? [])].some((key) => !entry.keys!.has(key)))
          )
            return prefix
        }
        return undefined
      },
      commit: (): void => {
        for (const [prefix, entry] of touched) {
          if (entry.writes.size === 0) continue
          const current = entry.base ?? new Map<string, string>()
          for (const [key, value] of entry.writes) {
            if (value === undefined) current.delete(key)
            else current.set(key, value)
          }
          namespaces.set(prefix, current)
        }
      },
      complete: (success: boolean): void => {
        if (settled) return
        settled = true
        if (success) committed.publish(undefined)
        else rolledBack.publish(undefined)
        committed.clear()
        rolledBack.clear()
        touched.clear()
      }
    }
  }

  /**
   * A handle drains accepted ordinary work and authentic transaction terminals through lifecycle's
   * tracker.
   */
  async function open(prefix: string): Promise<IStorageJournalNamespace> {
    options.assertLive()
    assertText(prefix)
    if (prefix.length === 0)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    const lifetime = createQuiescenceTracker<object>()
    const resource = Object.freeze({})
    const attempts = new Map<string, () => void>()
    let main: Promise<void> | undefined
    let symbolic: Promise<void> | undefined
    /** Closing this handle never closes its original backend or another namespace handle. */
    const assertOpen = (): void => {
      options.assertLive()
      if (lifetime.isSealed(resource))
        throw new StorageContractError(StorageContractErrorCode.disposed)
    }
    /** A current native transaction retains the handle until its actual commit or rollback. */
    const transaction = (scope: Omit<ITransactionScope, 'use'>) => {
      options.assertLive()
      const current = options.scope(scope)
      if (!attempts.has(current.info.id)) {
        assertOpen()
        const release = lifetime.retain(resource)
        let offCommit: (() => void) | undefined
        let offRollback: (() => void) | undefined
        const finish = () => {
          offCommit?.()
          offRollback?.()
          attempts.delete(current.info.id)
          release()
        }
        attempts.set(current.info.id, finish)
        offCommit = current.port.onCommit(finish)
        offRollback = current.port.onRollback(finish)
      }
      return current.port
    }
    const dispose = (): Promise<void> => {
      if (main !== undefined) return main
      lifetime.seal(resource)
      main = lifetime.whenZero(resource)
      return main
    }
    return Object.freeze({
      nativeAtomic: true,
      run: <R>(
        work: (view: IStorageJournalNamespaceView) => Promise<R>,
        scope?: Omit<ITransactionScope, 'use'>
      ): Promise<R> => {
        try {
          assertOpen()
          if (typeof work !== 'function')
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          if (scope !== undefined) return transaction(scope).run(prefix, work)
          const release = lifetime.retain(resource)
          return options.transaction((port) => port.run(prefix, work)).finally(release)
        } catch (error) {
          return Promise.reject(error)
        }
      },
      onCommit: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) => {
        if (typeof effect !== 'function')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return transaction(scope).onCommit(effect)
      },
      onRollback: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) => {
        if (typeof effect !== 'function')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return transaction(scope).onRollback(effect)
      },
      dispose,
      [Symbol.asyncDispose]: () => (symbolic ??= dispose().catch(options.report))
    })
  }
  return {
    draft,
    open,
    clear: () => {
      namespaces = new Map()
    }
  }
}
