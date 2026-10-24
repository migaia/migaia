import { createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from '@migaia/storage-host'
import { asyncDisposeKey, subscribeToAbort } from '@migaia/storage-host/authoring/backend'
import { deferred, type INativeAbortSignal } from '@migaia/utils/promise'
import { SqliteNames } from './constants.js'

/** Effects belong only to this original native attempt and are discarded at its actual terminal. */
export type ISqliteJournalTerminal = {
  readonly committed: Set<() => void>
  readonly rolledBack: Set<() => void>
  /** Native cleanup completion does not assert a known data commit or rollback. */
  readonly ended: Set<() => void>
}

/** Namespace resources borrow authenticated scopes; they never own a connection or transaction. */
export function createSqliteJournalNamespace(options: {
  readonly assertLive: () => void
  readonly closingSignal: INativeAbortSignal
  readonly report: (error: unknown) => void
  readonly exclusive: boolean
  readonly reserve: (hold: () => Promise<void>) => Promise<void>
  readonly authenticate: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly info: ITransactionInfo
    readonly terminal: ISqliteJournalTerminal
  }
  readonly view: (scope: Omit<ITransactionScope, 'use'>) => IStorageJournalNamespaceView
  readonly transaction: <R>(
    work: (scope: Omit<ITransactionScope, 'use'>) => Promise<R>
  ) => Promise<R>
}): Promise<IStorageJournalNamespace> {
  return open()

  /** The original local metadata lease spans only an in-memory namespace's resource lifetime. */
  async function open(): Promise<IStorageJournalNamespace> {
    options.assertLive()
    /** Admission and release settle the existing held lock attempt, without another lock owner. */
    const acquired = deferred<void>()
    const released = deferred<void>()
    const reservation = options.exclusive
      ? options.reserve(async () => {
          acquired.resolve()
          await released.promise
        })
      : Promise.resolve()
    void reservation.then(undefined, acquired.reject)
    if (options.exclusive) await acquired.promise
    /** The lifecycle package tracks accepted operations and original native terminals. */
    const tracker = createQuiescenceTracker<object>()
    const owner = {}
    const attempts = new Map<string, () => void>()
    let main: Promise<void> | undefined
    let symbolic: Promise<void> | undefined
    let unsubscribe = () => undefined as void
    /** Extracted namespace methods retain this exact resource's original seal. */
    const assertLive = (): void => {
      options.assertLive()
      if (tracker.isSealed(owner))
        throw new StorageContractError(StorageContractErrorCode.disposed, {
          backend: SqliteNames.backend
        })
    }
    /** An already accepted native attempt keeps its handle until the actual commit or rollback. */
    const authenticate = (scope: Omit<ITransactionScope, 'use'>) => {
      const current = options.authenticate(scope)
      if (!attempts.has(current.info.id)) {
        assertLive()
        const release = tracker.retain(owner)
        const finish = () => {
          current.terminal.ended.delete(finish)
          attempts.delete(current.info.id)
          release()
        }
        attempts.set(current.info.id, finish)
        current.terminal.ended.add(finish)
      }
      return current
    }
    /** Closing this resource drains its work and releases only its original metadata reservation. */
    const dispose = (): Promise<void> => {
      if (main !== undefined) return main
      tracker.seal(owner)
      main = tracker
        .whenZero(owner)
        .then(async () => {
          released.resolve()
          await reservation
        })
        .finally(() => unsubscribe())
      return main
    }
    unsubscribe = subscribeToAbort(
      options.closingSignal,
      () => {
        void dispose().catch(options.report)
      },
      options.report
    )
    /** Namespace I/O uses the original scope or original transaction entry, never public KV keys. */
    const run = <R>(
      work: (view: IStorageJournalNamespaceView) => Promise<R>,
      scope?: Omit<ITransactionScope, 'use'>,
      committed?: (value: R) => void
    ): Promise<R> => {
      try {
        assertLive()
        if (typeof work !== 'function')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        const invoke = async (current: Omit<ITransactionScope, 'use'>): Promise<R> => {
          const native = authenticate(current)
          const value = await work(options.view(current))
          if (committed !== undefined) native.terminal.committed.add(() => committed(value))
          return value
        }
        if (scope !== undefined) return invoke(scope)
        const release = tracker.retain(owner)
        return options.transaction(invoke).finally(release)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    /** Terminal subscription preserves the backend's actual commit decision and native identity. */
    const listen = (
      scope: Omit<ITransactionScope, 'use'>,
      effect: () => void,
      success: boolean
    ) => {
      if (typeof effect !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      const current = authenticate(scope)
      const effects = success ? current.terminal.committed : current.terminal.rolledBack
      effects.add(effect)
      return () => {
        effects.delete(effect)
      }
    }
    return Object.freeze({
      nativeAtomic: true,
      ...(options.exclusive ? {} : { indexExclusive: false as const }),
      assertLive,
      transactionInfo: (scope: Omit<ITransactionScope, 'use'>) => authenticate(scope).info,
      run,
      runCommitted: <R>(
        work: (view: IStorageJournalNamespaceView) => Promise<R>,
        committed: (value: R) => void
      ) => {
        if (typeof committed !== 'function')
          return Promise.reject(new StorageContractError(StorageContractErrorCode.invalidArgument))
        return run(work, undefined, committed)
      },
      onCommit: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
        listen(scope, effect, true),
      onRollback: (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
        listen(scope, effect, false),
      dispose,
      [asyncDisposeKey]: () => (symbolic ??= dispose().catch(options.report))
    })
  }
}
