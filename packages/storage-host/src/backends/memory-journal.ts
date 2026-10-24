import { createEventChannel } from '@migaia/event-subscriber'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  createBackendJournalNamespace,
  type IBackendJournalTransaction
} from '../journal/namespace-resource.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from '../journal/types.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'

/** Commit evidence stays in the same private physical data universe as original log namespaces. */
const markerNamespace = Symbol()
/** Ordinary marker I/O reuses one fixed canonical metadata head lock, without dynamic tx locks. */
const markerLockNamespace = 'storage.commit.markers'
/** A marker contains only commit evidence; tx identity is its original native owner-issued key. */
const markerValue = '1'

/** A private native scope carries the same draft and terminal effects as its business writes. */
export type IMemoryJournalTransaction = {
  run<R>(
    prefix: string | symbol,
    work: (view: IStorageJournalNamespaceView) => Promise<R>
  ): Promise<R>
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
  readonly closingSignal: INativeAbortSignal
  readonly reserve: (prefix: string, run: () => Promise<void>) => Promise<void>
  readonly transaction: <R>(
    prefix: string,
    work: (port: IMemoryJournalTransaction) => Promise<R>
  ) => Promise<R>
  readonly scope: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly info: ITransactionInfo
    readonly port: IMemoryJournalTransaction
  }
}) {
  /** Business clear and capacity never enumerate these original backend-private metadata rows. */
  let namespaces = new Map<string | symbol, Map<string, string>>()

  /** Prepare sparse private writes beside the same native attempt's existing business draft. */
  function draft() {
    /** Replacing the private physical map invalidates even an initially empty pre-drop attempt. */
    const generation = namespaces
    /** Each touched private namespace retains its original committed map identity. */
    const touched = new Map<string | symbol, IMemoryJournalDraft>()
    /** Original event delivery observes synchronous and late terminal-listener failures. */
    const committed = createEventChannel<void>({ report: ({ error }) => options.report(error) })
    /** Rollback effects use the same terminal channel owner and report policy. */
    const rolledBack = createEventChannel<void>({ report: ({ error }) => options.report(error) })
    /** A native attempt publishes exactly one actual terminal result. */
    let settled = false
    /** Capture a namespace on first access; untouched rows stay in the original physical Map. */
    const state = (prefix: string | symbol): IMemoryJournalDraft => {
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
        prefix: string | symbol,
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
        return work(view)
      },
      onCommit: (effect: () => void) => committed.subscribe(() => effect()),
      onRollback: (effect: () => void) => rolledBack.subscribe(() => effect())
    }
    return {
      port,
      conflict: (): string | symbol | undefined => {
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

  /** Fixed-prefix I/O and native terminal channels remain on the original memory draft. */
  const project = (
    prefix: string,
    port: IMemoryJournalTransaction
  ): IBackendJournalTransaction => ({
    run: (work) => port.run(prefix, work),
    onCommit: port.onCommit,
    onRollback: port.onRollback,
    onEnd: (effect) => {
      const offCommit = port.onCommit(effect)
      const offRollback = port.onRollback(effect)
      return () => {
        offCommit()
        offRollback()
      }
    }
  })
  /** The shared original resource algorithm borrows only this fixed native namespace. */
  async function open(prefix: string): Promise<IStorageJournalNamespace> {
    options.assertLive()
    assertText(prefix)
    if (prefix.length === 0)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    const generation = namespaces
    return createBackendJournalNamespace({
      ...options,
      nativeAtomic: true,
      assertLive: () => {
        options.assertLive()
        if (generation !== namespaces)
          throw new StorageContractError(StorageContractErrorCode.disposed)
      },
      reserve: (hold) => options.reserve(prefix, hold),
      authenticate: (scope) => {
        const current = options.scope(scope)
        return { info: current.info, port: project(prefix, current.port) }
      },
      transaction: (work) => options.transaction(prefix, (port) => work(project(prefix, port)))
    })
  }
  return {
    draft,
    open,
    /** Marker and business data share this exact native attempt and its original rollback path. */
    writeMarker: (scope: Omit<ITransactionScope, 'use'>, txId: string): Promise<void> => {
      const current = options.scope(scope)
      if (txId !== current.info.id)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      return current.port.run(markerNamespace, (view) => view.set(txId, markerValue))
    },
    /** Recovery reads original private metadata without opening a second log resource owner. */
    hasMarker: (txId: string): Promise<boolean> => {
      assertText(txId)
      return options.transaction(markerLockNamespace, (port) =>
        port.run(markerNamespace, async (view) => {
          const value = await view.get(txId)
          if (value === null) return false
          if (value === markerValue) return true
          throw new StorageError(
            StorageErrorCode.journalRecordInvalid,
            {},
            StorageErrorText.journalRecordInvalid
          )
        })
      )
    },
    /** Terminal intent cleanup removes only its fixed-org evidence through the original owner. */
    removeMarker: (txId: string): Promise<void> => {
      assertText(txId)
      return options.transaction(markerLockNamespace, (port) =>
        port.run(markerNamespace, (view) => view.remove(txId))
      )
    },
    clear: () => {
      namespaces = new Map()
    }
  }
}
