import { createQuiescenceTracker } from '@migaia/lifecycle'
import { deferred, type INativeAbortSignal } from '@migaia/utils/promise'
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'
import { subscribeToAbort } from '../core/operation.js'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from './types.js'

/**
 * A transaction borrows private I/O and terminal observation without commit or native-handle
 * rights.
 */
export type IBackendJournalTransaction = {
  run<R>(work: (view: IStorageJournalNamespaceView) => Promise<R>): Promise<R>
  onCommit(effect: () => void): () => void
  onRollback(effect: () => void): () => void
  /** Actual native resource completion includes outcomes whose commit result remains unknown. */
  onEnd(effect: () => void): () => void
}
/**
 * Original backend owners authenticate scopes and retain their own data, locks and native
 * terminals.
 */
export type IBackendJournalNamespaceOptions = {
  readonly assertLive: () => void
  readonly closingSignal: INativeAbortSignal
  readonly report: (error: unknown) => void
  readonly backend?: IBackendKind
  readonly nativeAtomic: boolean
  readonly indexExclusive?: false
  readonly reserve: (hold: () => Promise<void>) => Promise<void>
  readonly authenticate: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly info: ITransactionInfo
    readonly port: IBackendJournalTransaction
  }
  readonly transaction: <R>(work: (port: IBackendJournalTransaction) => Promise<R>) => Promise<R>
}

/** Reuse the original namespace reservation, quiescence and dual-disposal resource algorithm. */
export async function createBackendJournalNamespace(
  options: IBackendJournalNamespaceOptions
): Promise<IStorageJournalNamespace> {
  options.assertLive()
  /** The backend's original reservation owns acquisition and eventual release. */
  const acquired = deferred<void>()
  const released = deferred<void>()
  const reservation = options.reserve(async () => {
    acquired.resolve()
    await released.promise
  })
  void reservation.then(undefined, acquired.reject)
  await acquired.promise
  /** Accepted I/O and native terminals share lifecycle's original drain owner. */
  const lifetime = createQuiescenceTracker<object>()
  const resource = {}
  const attempts = new Map<string, () => void>()
  let main: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  let unsubscribe = () => undefined as void
  const assertOpen = (): void => {
    options.assertLive()
    if (lifetime.isSealed(resource))
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: options.backend
      })
  }
  /** Retain only real native work; a transactionInfo lookup itself grants no retained work. */
  const transaction = (scope: Omit<ITransactionScope, 'use'>): IBackendJournalTransaction => {
    const current = options.authenticate(scope)
    if (!attempts.has(current.info.id)) {
      assertOpen()
      const release = lifetime.retain(resource)
      let off: (() => void) | undefined
      const finish = () => {
        off?.()
        attempts.delete(current.info.id)
        release()
      }
      attempts.set(current.info.id, finish)
      off = current.port.onEnd(finish)
    }
    return current.port
  }
  const dispose = (): Promise<void> => {
    if (main !== undefined) return main
    lifetime.seal(resource)
    main = lifetime
      .whenZero(resource)
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
  const run = <R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    scope?: Omit<ITransactionScope, 'use'>,
    committed?: (value: R) => void
  ): Promise<R> => {
    try {
      assertOpen()
      if (typeof work !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      const invoke = (port: IBackendJournalTransaction): Promise<R> =>
        committed === undefined
          ? port.run(work)
          : port.run((view) =>
              work(view).then((value) => {
                port.onCommit(() => committed(value))
                return value
              })
            )
      if (scope !== undefined) return invoke(transaction(scope))
      const release = lifetime.retain(resource)
      return options.transaction(invoke).finally(release)
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const listen = (scope: Omit<ITransactionScope, 'use'>, effect: () => void, success: boolean) => {
    if (typeof effect !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    const port = transaction(scope)
    return success ? port.onCommit(effect) : port.onRollback(effect)
  }
  return {
    nativeAtomic: options.nativeAtomic,
    ...(options.indexExclusive === undefined ? {} : { indexExclusive: options.indexExclusive }),
    assertLive: assertOpen,
    transactionInfo: (scope: Omit<ITransactionScope, 'use'>) => {
      assertOpen()
      return options.authenticate(scope).info
    },
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
  }
}
