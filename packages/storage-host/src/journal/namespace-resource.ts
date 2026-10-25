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

/** One namespace owns only its original reservation, accepted work and cached disposal promises. */
class BackendJournalNamespace implements IStorageJournalNamespace {
  /** Native authority and quiescence remain borrowed from their original owners. */
  readonly #options: IBackendJournalNamespaceOptions
  /** The original backend reservation stays held until all retained native work has ended. */
  readonly #released: ReturnType<typeof deferred<void>>
  /** The original reservation reports eventual release failure on explicit disposal. */
  readonly #reservation: Promise<void>
  /** Lifecycle's tracker counts accepted I/O and real native attempts only. */
  readonly #lifetime = createQuiescenceTracker<object>()
  /** This namespace is the tracker key; it carries no independent generation or lease system. */
  readonly #resource = {}
  /** Authenticated native attempts retain one original quiescence hold until their actual end. */
  readonly #attempts = new Map<string, () => void>()
  /** Explicit cleanup caches the original rejecting completion. */
  #main: Promise<void> | undefined
  /** Symbol cleanup caches its separately reported completion. */
  #symbolic: Promise<void> | undefined
  /** The original backend close signal has one listener, removed after disposal settles. */
  #unsubscribe = () => undefined as void
  /** Native atomicity is an admitted fact, never inferred from a backend label. */
  readonly nativeAtomic: boolean
  /** Nonexclusive namespaces cannot retain a private cached log index. */
  declare readonly indexExclusive?: false

  /** Adopt an acquired reservation without creating another native or lifecycle owner. */
  constructor(
    options: IBackendJournalNamespaceOptions,
    released: ReturnType<typeof deferred<void>>,
    reservation: Promise<void>
  ) {
    this.#options = options
    this.#released = released
    this.#reservation = reservation
    this.nativeAtomic = options.nativeAtomic
    if (options.indexExclusive !== undefined) this.indexExclusive = options.indexExclusive
    this.#unsubscribe = subscribeToAbort(
      options.closingSignal,
      () => {
        void this.dispose().catch(options.report)
      },
      options.report
    )
  }
  /** Native work rechecks the backend owner and this namespace's original sealed state. */
  readonly assertLive = (): void => {
    this.#options.assertLive()
    if (this.#lifetime.isSealed(this.#resource))
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: this.#options.backend
      })
  }
  /** Retain real native work; transactionInfo alone does not extend resource lifetime. */
  #transaction(scope: Omit<ITransactionScope, 'use'>): IBackendJournalTransaction {
    const current = this.#options.authenticate(scope)
    if (!this.#attempts.has(current.info.id)) {
      this.assertLive()
      const release = this.#lifetime.retain(this.#resource)
      let off: (() => void) | undefined
      const finish = () => {
        off?.()
        this.#attempts.delete(current.info.id)
        release()
      }
      this.#attempts.set(current.info.id, finish)
      off = current.port.onEnd(finish)
    }
    return current.port
  }
  /** Explicit disposal waits for accepted work and returns the same original completion. */
  readonly dispose = (): Promise<void> => {
    if (this.#main !== undefined) return this.#main
    this.#lifetime.seal(this.#resource)
    this.#main = this.#lifetime
      .whenZero(this.#resource)
      .then(async () => {
        this.#released.resolve()
        await this.#reservation
      })
      .finally(() => this.#unsubscribe())
    return this.#main
  }
  /** Public native execution retains original transaction and post-commit publication order. */
  readonly run = <R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    scope?: Omit<ITransactionScope, 'use'>,
    committed?: (value: R) => void
  ): Promise<R> => {
    try {
      this.assertLive()
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
      if (scope !== undefined) return invoke(this.#transaction(scope))
      const release = this.#lifetime.retain(this.#resource)
      return this.#options.transaction(invoke).finally(release)
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /** Terminal observers remain registered on the original authenticated attempt. */
  #listen(scope: Omit<ITransactionScope, 'use'>, effect: () => void, success: boolean) {
    if (typeof effect !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    const port = this.#transaction(scope)
    return success ? port.onCommit(effect) : port.onRollback(effect)
  }
  /** Information lookup authenticates the scope without retaining native work. */
  readonly transactionInfo = (scope: Omit<ITransactionScope, 'use'>) => {
    this.assertLive()
    return this.#options.authenticate(scope).info
  }
  /** Publish inside the original commit terminal before its head reservation is released. */
  readonly runCommitted = <R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    committed: (value: R) => void
  ) => {
    if (typeof committed !== 'function')
      return Promise.reject(new StorageContractError(StorageContractErrorCode.invalidArgument))
    return this.run(work, undefined, committed)
  }
  /** A successful native commit alone invokes this observer. */
  readonly onCommit = (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
    this.#listen(scope, effect, true)
  /** A known native rollback alone invokes this observer. */
  readonly onRollback = (scope: Omit<ITransactionScope, 'use'>, effect: () => void) =>
    this.#listen(scope, effect, false)
  /** Symbol disposal reports the original explicit error and caches its own stable promise. */
  readonly [asyncDisposeKey] = () => (this.#symbolic ??= this.dispose().catch(this.#options.report))
}
/** Acquire the backend's original reservation before exposing the named namespace resource. */
export async function createBackendJournalNamespace(
  options: IBackendJournalNamespaceOptions
): Promise<IStorageJournalNamespace> {
  options.assertLive()
  const acquired = deferred<void>()
  const released = deferred<void>()
  const reservation = options.reserve(async () => {
    acquired.resolve()
    await released.promise
  })
  void reservation.then(undefined, acquired.reject)
  await acquired.promise
  return new BackendJournalNamespace(options, released, reservation)
}
