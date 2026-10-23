import {
  assertLogInteger,
  createLogStoreIndex,
  LogRecordState,
  prepareLogAppend,
  snapshotLogRecords,
  type ILogAppendPort,
  type ILogAppendNotice,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'
import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionScope
} from '@migaia/storage-contract'
import { PluginHostError } from '@migaia/plugin-host'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { resolveStorageJournalBinding, type IStorageJournalBackendAccess } from './binding.js'
import {
  appendStorageLog,
  prepareStorageLogAppend,
  persistStorageLogAppend,
  readStorageLogHead,
  recoverStorageLog,
  reclaimStorageLogRows,
  setStorageLogState,
  truncateStorageLog,
  type IStorageLogHead,
  type IStorageLogAppend
} from './protocol.js'
import type {
  IStorageBackendPluginHandle,
  IPluginStoreMap,
  IStorageHost,
  IStorageOrgView
} from '../types.js'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from './types.js'
import { storageLogNativeAccess, type IStorageLogNativeAccess } from './append-port.js'
import { storageJournalLockKey, StorageJournalLock } from './keys.js'

/** Pending records belong only to one authenticated live attempt and vanish at its actual terminal. */
type IStorageLogPending = {
  head: IStorageLogHead | undefined
  readonly ready: Promise<void>
  readonly plans: IStorageLogAppend[]
}

/** Keep original coded storage failures and retain unknown native I/O errors on cause. */
function journalFailure(cause: unknown): Error {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(
        StorageErrorCode.journalRecoveryFailed,
        { cause },
        StorageErrorText.journalRecoveryFailed
      )
}

/**
 * Open one admitted backend's private journal in this facade's immutable organization. Recovery
 * completes before the log becomes visible; the original registration owns eventual cleanup.
 */
export async function storageLogStore<
  const P extends readonly IStorageBackendPluginHandle[],
  N extends keyof IPluginStoreMap<P> & string
>(
  host: IStorageHost<P> | IStorageOrgView<P>,
  id: N,
  options: { readonly prefix: string }
): Promise<ILogStore> {
  let prefix: string
  try {
    prefix = options?.prefix
    if (typeof prefix !== 'string' || prefix.length === 0)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  const access = resolveStorageJournalBinding(host, id)
  let namespace: IStorageJournalNamespace
  try {
    namespace = await access.binding.openNamespace(prefix)
  } catch (cause) {
    throw journalFailure(cause)
  }
  const report = createStorageOperationReporter()
  let index: ReturnType<typeof createLogStoreIndex> | undefined
  /** Native append composition requires the original owner's pre-release publication callback. */
  let runCommitted: IStorageJournalNamespace['runCommitted']
  /** This descriptor fact is read once before exposing any native append composition. */
  let nativeAtomic: boolean
  try {
    nativeAtomic = namespace.nativeAtomic
    if (typeof nativeAtomic !== 'boolean')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    runCommitted = namespace.runCommitted
    if (runCommitted !== undefined && typeof runCommitted !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    index = createLogStoreIndex(await namespace.run(recoverStorageLog))
  } catch (cause) {
    try {
      await namespace.dispose()
    } catch (cleanup) {
      reportCleanupError(report, cleanup)
    }
    throw journalFailure(cause)
  }
  /** Ordinary calls share the original FIFO owner; scoped native ports never enter this limiter. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** Only actual committed nonempty batches publish through this resource's original event channel. */
  const appended = createEventChannel<ILogAppendNotice>({
    dispatchPolicy: EventDispatchPolicy.queued,
    report: ({ error }) => reportCleanupError(report, error)
  })
  /** This contains only active attempt data; namespace authentication and lifecycle remain original. */
  const pending = new Map<string, IStorageLogPending>()
  let accepting = true
  let failure: Error | undefined
  let main: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  /** Explicitly closed handles release their original cell row instead of retaining closed history. */
  let forget = () => undefined as void
  const admit = (): void => {
    if (failure !== undefined) throw failure
    if (!accepting) throw new StorageContractError(StorageContractErrorCode.disposed)
  }
  /** Admission happens before the FIFO; accepted work keeps its original place during closing. */
  const run = <R>(work: () => R | PromiseLike<R>): Promise<R> => {
    try {
      admit()
    } catch (cause) {
      return Promise.reject(cause)
    }
    return limiter.run(() => {
      if (failure !== undefined) throw failure
      return work()
    })
  }
  /** Any uncertain physical write seals this handle; reopening reads the single durable head. */
  const write = async <R>(
    work: (view: IStorageJournalNamespaceView, beforeWrite: () => void) => Promise<R>,
    committed?: (value: R) => void
  ): Promise<R> => {
    /** Native admission can reject before the protocol performs any private I/O. */
    let entered = false
    /** Only a physical write attempt can leave a candidate or an unconfirmed head behind. */
    let writing = false
    try {
      const operation = (view: IStorageJournalNamespaceView) => {
        entered = true
        return work(view, () => {
          writing = true
        })
      }
      if (runCommitted !== undefined && committed !== undefined)
        return (await Reflect.apply(runCommitted, namespace, [operation, committed])) as R
      const value = await namespace.run(operation)
      committed?.(value)
      return value
    } catch (cause) {
      if (!entered) {
        if (isStorageErrorFamily(cause) || cause instanceof PluginHostError) throw cause
        throw new StorageError(StorageErrorCode.extensionFailed, { cause })
      }
      if (!writing) throw journalFailure(cause)
      failure = journalFailure(cause)
      throw failure
    }
  }
  /** Publish all same-attempt batches after their original native owner has actually committed. */
  const committed = (plans: readonly IStorageLogAppend[]): void => {
    let count = 0
    for (const plan of plans) {
      if (plan.batch.length === 0) continue
      index!.applyAppend(plan.batch)
      count += plan.batch.length
    }
    if (count === 0) return
    try {
      appended.publish(Object.freeze({ lastSeq: index!.lastSeq, count }))
    } catch (cause) {
      reportCleanupError(report, cause)
    }
  }
  /** Only the original private namespace authenticates scopes and owns real terminal callbacks. */
  const createPort = (scope: Omit<ITransactionScope, 'use'>): ILogAppendPort => {
    admit()
    if (!nativeAtomic || runCommitted === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    const info = namespace.transactionInfo(scope)
    return Object.freeze({
      store,
      append: (input: Parameters<ILogAppendPort['append']>[0]) => {
        try {
          admit()
          if (namespace.transactionInfo(scope).id !== info.id)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          let group = pending.get(info.id)
          if (group === undefined) {
            /** One original native head read closes the gap between physical commit and publication. */
            const ready = deferred<void>()
            group = { head: undefined, ready: ready.promise, plans: [] }
            const original = group
            let offCommit = () => undefined as void
            let offRollback = () => undefined as void
            const release = () => {
              pending.delete(info.id)
              offCommit()
              offRollback()
            }
            try {
              offCommit = namespace.onCommit(scope, () => {
                release()
                committed(original.plans)
              })
              offRollback = namespace.onRollback(scope, release)
              pending.set(info.id, original)
              void namespace.run(readStorageLogHead, scope).then((current) => {
                original.head = current
                ready.resolve()
              }, ready.reject)
            } catch (cause) {
              release()
              throw cause
            }
          }
          const original = group
          /** Only the same native GET is awaited; there is no ordinary FIFO or external task here. */
          return namespace.run((view) => {
            const captured = snapshotLogRecords(input)
            return original.ready.then(() => {
              const plan = prepareStorageLogAppend(original.head!, captured)
              if (plan.batch.length !== 0) {
                original.head = plan.head
                original.plans.push(plan)
              }
              return persistStorageLogAppend(view, plan, undefined, true).then(() =>
                plan.batch.map((row) => row.seq)
              )
            })
          }, scope)
        } catch (cause) {
          return Promise.reject(cause)
        }
      },
      onCommit: (effect: () => void) => namespace.onCommit(scope, effect),
      onRollback: (effect: () => void) => namespace.onRollback(scope, effect)
    })
  }
  const store: ILogStore = {
    append: (input) => {
      let captured: ReturnType<typeof snapshotLogRecords>
      try {
        admit()
        captured = snapshotLogRecords(input)
      } catch (cause) {
        return Promise.reject(cause)
      }
      return run(async () => {
        if (captured.length === 0) return []
        /** Pure logger admission precedes native wrapping and consults its clock exactly once. */
        const prepared = prepareLogAppend(captured, index!)
        const plan = await write(
          (view, beforeWrite) => appendStorageLog(view, captured, prepared, beforeWrite),
          (plan) => committed([plan])
        )
        return plan.batch.map((row) => row.seq)
      })
    },
    read: (fromSeq, limit) => {
      try {
        assertLogInteger(fromSeq)
        assertLogInteger(limit, 0)
      } catch (cause) {
        return Promise.reject(cause)
      }
      return run(() => index!.read(fromSeq, limit))
    },
    lastSeq: () => run(() => index!.lastSeq),
    onAppend: (listener) => {
      admit()
      if (typeof listener !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      return appended.subscribe((event) => listener(event.value))
    },
    truncate: (beforeSeq) => {
      try {
        assertLogInteger(beforeSeq)
      } catch (cause) {
        return Promise.reject(cause)
      }
      return run(async () => {
        if (!index!.checkTruncate(beforeSeq)) return
        const truncated = await write(
          (view, beforeWrite) => truncateStorageLog(view, beforeSeq, beforeWrite),
          () => index!.applyTruncate(beforeSeq)
        )
        /** Cleanup runs after the floor's real commit, even when native transactions are available. */
        await write((view, beforeWrite) => reclaimStorageLogRows(view, truncated, beforeWrite))
      })
    },
    setState: (seq, state) => {
      try {
        assertLogInteger(seq)
        if (!Object.values(LogRecordState).includes(state))
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      } catch (cause) {
        return Promise.reject(cause)
      }
      return run(async () => {
        if (!index!.checkState(seq, state)) return
        await write(
          (view, beforeWrite) => setStorageLogState(view, seq, state, beforeWrite),
          () => index!.applyState(seq, state)
        )
      })
    },
    states: (filter) =>
      filter !== LogRecordState.pending
        ? Promise.reject(new StorageContractError(StorageContractErrorCode.invalidArgument))
        : run(() => index!.pending()),
    dispose: () => {
      if (main !== undefined) return main
      const completion = deferred<void>()
      main = completion.promise
      accepting = false
      void (async () => {
        await limiter.whenIdle()
        limiter.close()
        try {
          await namespace.dispose()
        } finally {
          appended.clear()
          index = undefined
          forget()
        }
      })().then(completion.resolve, completion.reject)
      return main
    },
    [Symbol.asyncDispose]: () => {
      if (symbolic !== undefined) return symbolic
      const completion = deferred<void>()
      symbolic = completion.promise
      void store.dispose().then(completion.resolve, (cause) => {
        reportCleanupError(report, cause)
        completion.resolve()
      })
      return symbolic
    }
  }
  /** The closure verifies this exact object even if a caller copies an enumerable symbol manually. */
  const nativeAccess: IStorageLogNativeAccess = Object.freeze({
    matches: (candidate: IStorageJournalBackendAccess) =>
      candidate.registration === access.registration &&
      candidate.orgId === access.orgId &&
      candidate.backendInstanceId === access.backendInstanceId,
    orgId: access.orgId,
    backendInstanceId: access.backendInstanceId,
    headLock: storageJournalLockKey(prefix, StorageJournalLock.head),
    createPort
  })
  Object.defineProperty(store, storageLogNativeAccess, {
    value: (candidate: ILogStore) => {
      if (candidate !== store) throw new StorageContractError(StorageContractErrorCode.unsupported)
      return nativeAccess
    }
  })
  try {
    forget = access.retain(store)
  } catch (cause) {
    try {
      await store.dispose()
    } catch (cleanup) {
      reportCleanupError(report, cleanup)
    }
    throw cause
  }
  return store
}
