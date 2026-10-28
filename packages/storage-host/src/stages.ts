import { assertTransactionOwner } from './authoring/transaction.ts'
import {
  StorageStageKind,
  type IStorageBase,
  type ICodecStageObserver,
  type IQueryStageObserver,
  type ITransactionStageObserver,
  type IConcurrencyStageObserver,
  type IBackendStageObserver,
  type ISqlStageObserver,
  type IStorageOperationStageObserver
} from '@migaia/storage-contract'
import type { IStorageHookIdentity, IStorageHookMap } from './hook-types.ts'
import type { IStorageHookEmitter } from './hooks.ts'
import { StorageHookName as Hook } from './hook-names.ts'

/** Original observer families carry no execution, lifecycle or transaction authority. */
export type IStorageObserverSet = Readonly<{
  backend: IBackendStageObserver
  operation: IStorageOperationStageObserver
  codec: ICodecStageObserver
  transaction: ITransactionStageObserver
  concurrency: IConcurrencyStageObserver
  sql: ISqlStageObserver
  query: IQueryStageObserver
}>

/** Registration-local inputs point to the original owners instead of reconstructing their state. */
export type IStorageObserverBinding = Readonly<{
  identity: () => IStorageHookIdentity
  assertCurrent: () => void
  emit: IStorageHookEmitter
  hasListeners: (name: keyof IStorageHookMap) => boolean
  report: (error: unknown) => void
}>

/** Explicit observation context borrows authority from the canonical registration and scope owners. */
type IStorageObserverContext = {
  readonly binding: IStorageObserverBinding
  readonly store: () => IStorageBase
  readonly scope?: object
  readonly transactionId?: string
  readonly report: (error: unknown) => undefined
}

/**
 * Capture transaction identity while its scope is valid; terminal events keep it after
 * finalization.
 */
export function createStorageObservers(
  binding: IStorageObserverBinding,
  store: () => IStorageBase,
  scope?: object
): IStorageObserverSet {
  /** This immutable binding retains no execution, resource, or transaction ownership. */
  const context: IStorageObserverContext = {
    binding,
    store,
    scope,
    transactionId: scope === undefined ? undefined : assertTransactionOwner(store(), scope).id,
    report: (error) => reportStorageObservation(binding, error)
  }
  return {
    backend: createBackendObservers(context),
    operation: createOperationObservers(context),
    codec: createCodecObservers(context),
    query: createQueryObservers(context),
    transaction: createTransactionObservers(context),
    concurrency: createConcurrencyObservers(context),
    sql: createSqlObservers(context)
  }
}

/** Read organization identity lazily while retaining the accepted transaction identifier. */
function observerIdentity(context: IStorageObserverContext): IStorageHookIdentity {
  return context.transactionId === undefined
    ? context.binding.identity()
    : { ...context.binding.identity(), transactionId: context.transactionId }
}

/** Only nonterminal observations re-enter registration and transaction admission. */
function dispatchStorageObservation<K extends keyof IStorageHookMap>(
  context: IStorageObserverContext,
  name: K,
  payload: () => IStorageHookMap[K],
  terminal = false
): void {
  try {
    if (!terminal) {
      context.binding.assertCurrent()
      if (context.scope !== undefined) assertTransactionOwner(context.store(), context.scope)
    }
    context.binding.emit(name, payload)
  } catch (error) {
    context.binding.report(error)
  }
}

/** Neutral observer reports remain synchronous and observational. */
function reportStorageObservation(binding: IStorageObserverBinding, error: unknown): undefined {
  binding.report(error)
  return undefined
}

/** Build the backend observation table with the original registration and scope identity. */
function createBackendObservers(context: IStorageObserverContext): IBackendStageObserver {
  return {
    kind: StorageStageKind.backend,
    beforeBackendCreate: () => {
      if (!context.binding.hasListeners(Hook.beforeBackendCreate)) return
      dispatchStorageObservation(context, Hook.beforeBackendCreate, () => observerIdentity(context))
    },
    afterBackendCreate: () => {
      if (!context.binding.hasListeners(Hook.afterBackendCreate)) return
      dispatchStorageObservation(context, Hook.afterBackendCreate, () => observerIdentity(context))
    },
    onBackendRejected: (code) => {
      if (!context.binding.hasListeners(Hook.onBackendRejected)) return
      dispatchStorageObservation(
        context,
        Hook.onBackendRejected,
        () => ({ ...observerIdentity(context), code }),
        true
      )
    },
    afterBackendInstall: () => {
      if (!context.binding.hasListeners(Hook.afterBackendInstall)) return
      dispatchStorageObservation(context, Hook.afterBackendInstall, () => observerIdentity(context))
    },
    onBackendDisposeStart: () => {
      if (!context.binding.hasListeners(Hook.onBackendDisposeStart)) return
      dispatchStorageObservation(
        context,
        Hook.onBackendDisposeStart,
        () => observerIdentity(context),
        true
      )
    },
    afterBackendDispose: () => {
      if (!context.binding.hasListeners(Hook.afterBackendDispose)) return
      dispatchStorageObservation(
        context,
        Hook.afterBackendDispose,
        () => observerIdentity(context),
        true
      )
    },
    report: context.report
  }
}

/** Build the operation observation table with the original registration and scope identity. */
function createOperationObservers(
  context: IStorageObserverContext
): IStorageOperationStageObserver {
  return {
    kind: StorageStageKind.operation,
    forTransaction: (next) =>
      createStorageObservers(context.binding, context.store, next).operation,
    beforeStorageOperation: (operation, count) => {
      if (!context.binding.hasListeners(Hook.beforeStorageOperation)) return
      dispatchStorageObservation(context, Hook.beforeStorageOperation, () => ({
        ...observerIdentity(context),
        operation,
        ...(count === undefined ? {} : { count })
      }))
    },
    afterStorageOperation: (operation, elapsedMs, count) => {
      if (!context.binding.hasListeners(Hook.afterStorageOperation)) return
      dispatchStorageObservation(context, Hook.afterStorageOperation, () => ({
        ...observerIdentity(context),
        operation,
        elapsedMs,
        count
      }))
    },
    onStorageOperationError: (operation, code, count) => {
      if (!context.binding.hasListeners(Hook.onStorageOperationError)) return
      dispatchStorageObservation(
        context,
        Hook.onStorageOperationError,
        () => ({
          ...observerIdentity(context),
          operation,
          code,
          ...(count === undefined ? {} : { count })
        }),
        true
      )
    },
    onStorageIterationClose: (count) => {
      if (!context.binding.hasListeners(Hook.onStorageIterationClose)) return
      dispatchStorageObservation(
        context,
        Hook.onStorageIterationClose,
        () => ({ ...observerIdentity(context), count }),
        true
      )
    },
    report: context.report
  }
}

/** Build the codec observation table with the original registration and scope identity. */
function createCodecObservers(context: IStorageObserverContext): ICodecStageObserver {
  return {
    kind: StorageStageKind.codec,
    forTransaction: (next) => createStorageObservers(context.binding, context.store, next).codec,
    beforeEncode: (operation, codec) => {
      if (!context.binding.hasListeners(Hook.beforeEncode)) return
      dispatchStorageObservation(context, Hook.beforeEncode, () => ({
        ...observerIdentity(context),
        operation,
        codec
      }))
    },
    afterEncode: (operation, codec) => {
      if (!context.binding.hasListeners(Hook.afterEncode)) return
      dispatchStorageObservation(context, Hook.afterEncode, () => ({
        ...observerIdentity(context),
        operation,
        codec
      }))
    },
    onEncodeError: (operation, codec, code) => {
      if (!context.binding.hasListeners(Hook.onEncodeError)) return
      dispatchStorageObservation(
        context,
        Hook.onEncodeError,
        () => ({ ...observerIdentity(context), operation, codec, code }),
        true
      )
    },
    beforeDecode: (operation, codec) => {
      if (!context.binding.hasListeners(Hook.beforeDecode)) return
      dispatchStorageObservation(context, Hook.beforeDecode, () => ({
        ...observerIdentity(context),
        operation,
        codec
      }))
    },
    afterDecode: (operation, codec) => {
      if (!context.binding.hasListeners(Hook.afterDecode)) return
      dispatchStorageObservation(context, Hook.afterDecode, () => ({
        ...observerIdentity(context),
        operation,
        codec
      }))
    },
    onDecodeError: (operation, codec, code) => {
      if (!context.binding.hasListeners(Hook.onDecodeError)) return
      dispatchStorageObservation(
        context,
        Hook.onDecodeError,
        () => ({ ...observerIdentity(context), operation, codec, code }),
        true
      )
    },
    report: context.report
  }
}

/** Build the query observation table with the original registration and scope identity. */
function createQueryObservers(context: IStorageObserverContext): IQueryStageObserver {
  return {
    kind: StorageStageKind.query,
    forTransaction: (next) => createStorageObservers(context.binding, context.store, next).query,
    beforeQuery: (source, index, plan) => {
      if (!context.binding.hasListeners(Hook.beforeQuery)) return
      dispatchStorageObservation(context, Hook.beforeQuery, () => ({
        ...observerIdentity(context),
        source,
        index,
        plan
      }))
    },
    afterQuery: (source, index, stats) => {
      if (!context.binding.hasListeners(Hook.afterQuery)) return
      dispatchStorageObservation(context, Hook.afterQuery, () => ({
        ...observerIdentity(context),
        source,
        index,
        stats
      }))
    },
    onQueryError: (source, index, code) => {
      if (!context.binding.hasListeners(Hook.onQueryError)) return
      dispatchStorageObservation(
        context,
        Hook.onQueryError,
        () => ({ ...observerIdentity(context), source, index, code }),
        true
      )
    },
    report: context.report
  }
}

/** Build the transaction observation table with the original registration and scope identity. */
function createTransactionObservers(context: IStorageObserverContext): ITransactionStageObserver {
  return {
    kind: StorageStageKind.transaction,
    forTransaction: (next) =>
      createStorageObservers(context.binding, context.store, next).transaction,
    beforeTransaction: () => {
      if (!context.binding.hasListeners(Hook.beforeTransaction)) return
      dispatchStorageObservation(context, Hook.beforeTransaction, () => observerIdentity(context))
    },
    onTransactionStart: () => {
      if (!context.binding.hasListeners(Hook.onTransactionStart)) return
      dispatchStorageObservation(context, Hook.onTransactionStart, () => observerIdentity(context))
    },
    beforeTxOperation: (operation) => {
      if (!context.binding.hasListeners(Hook.beforeTxOperation)) return
      dispatchStorageObservation(context, Hook.beforeTxOperation, () => ({
        ...observerIdentity(context),
        operation
      }))
    },
    afterTxOperation: (operation) => {
      if (!context.binding.hasListeners(Hook.afterTxOperation)) return
      dispatchStorageObservation(context, Hook.afterTxOperation, () => ({
        ...observerIdentity(context),
        operation
      }))
    },
    beforeCommit: () => {
      if (!context.binding.hasListeners(Hook.beforeCommit)) return
      dispatchStorageObservation(context, Hook.beforeCommit, () => observerIdentity(context))
    },
    afterCommit: (changedKeys) => {
      if (!context.binding.hasListeners(Hook.afterCommit)) return
      dispatchStorageObservation(
        context,
        Hook.afterCommit,
        () => ({ ...observerIdentity(context), changedKeys }),
        true
      )
    },
    afterRollback: (code) => {
      if (!context.binding.hasListeners(Hook.afterRollback)) return
      dispatchStorageObservation(
        context,
        Hook.afterRollback,
        () => ({ ...observerIdentity(context), code }),
        true
      )
    },
    onTransactionClose: () => {
      if (!context.binding.hasListeners(Hook.onTransactionClose)) return
      dispatchStorageObservation(
        context,
        Hook.onTransactionClose,
        () => observerIdentity(context),
        true
      )
    },
    beforePersistFlush: () => {
      if (!context.binding.hasListeners(Hook.beforePersistFlush)) return
      dispatchStorageObservation(context, Hook.beforePersistFlush, () => observerIdentity(context))
    },
    afterPersistFlush: () => {
      if (!context.binding.hasListeners(Hook.afterPersistFlush)) return
      dispatchStorageObservation(context, Hook.afterPersistFlush, () => observerIdentity(context))
    },
    report: context.report
  }
}

/** Build the concurrency observation table with the original registration and scope identity. */
function createConcurrencyObservers(context: IStorageObserverContext): IConcurrencyStageObserver {
  return {
    kind: StorageStageKind.concurrency,
    beforeLockAcquire: (policyName, keyCount) => {
      if (!context.binding.hasListeners(Hook.beforeLockAcquire)) return
      dispatchStorageObservation(context, Hook.beforeLockAcquire, () => ({
        ...observerIdentity(context),
        policyName,
        keyCount
      }))
    },
    onLockAcquired: (attempt, keyCount) => {
      if (!context.binding.hasListeners(Hook.onLockAcquired)) return
      dispatchStorageObservation(context, Hook.onLockAcquired, () => ({
        ...observerIdentity(context),
        attempt,
        keyCount
      }))
    },
    onLockConflict: (phase, attempt, keyCount, holder) => {
      if (!context.binding.hasListeners(Hook.onLockConflict)) return
      dispatchStorageObservation(context, Hook.onLockConflict, () => ({
        ...observerIdentity(context),
        phase,
        attempt,
        keyCount,
        holder
      }))
    },
    onLockWait: (attempt, waitedMs) => {
      if (!context.binding.hasListeners(Hook.onLockWait)) return
      dispatchStorageObservation(context, Hook.onLockWait, () => ({
        ...observerIdentity(context),
        attempt,
        waitedMs
      }))
    },
    onConcurrencyDecision: (action, attempt) => {
      if (!context.binding.hasListeners(Hook.onConcurrencyDecision)) return
      dispatchStorageObservation(context, Hook.onConcurrencyDecision, () => ({
        ...observerIdentity(context),
        action,
        attempt
      }))
    },
    onRetry: (attempt, delayMs, reason) => {
      if (!context.binding.hasListeners(Hook.onRetry)) return
      dispatchStorageObservation(context, Hook.onRetry, () => ({
        ...observerIdentity(context),
        attempt,
        delayMs,
        reason
      }))
    },
    onLockReleased: (attempt, keyCount) => {
      if (!context.binding.hasListeners(Hook.onLockReleased)) return
      dispatchStorageObservation(
        context,
        Hook.onLockReleased,
        () => ({ ...observerIdentity(context), attempt, keyCount }),
        true
      )
    },
    onLockLost: (attempt, keyCount) => {
      if (!context.binding.hasListeners(Hook.onLockLost)) return
      dispatchStorageObservation(
        context,
        Hook.onLockLost,
        () => ({ ...observerIdentity(context), attempt, keyCount }),
        true
      )
    },
    beforeLockInspect: () => {
      if (!context.binding.hasListeners(Hook.beforeLockInspect)) return
      dispatchStorageObservation(context, Hook.beforeLockInspect, () => observerIdentity(context))
    },
    afterLockInspect: (count) => {
      if (!context.binding.hasListeners(Hook.afterLockInspect)) return
      dispatchStorageObservation(context, Hook.afterLockInspect, () => ({
        ...observerIdentity(context),
        count
      }))
    },
    onLockInspectError: (code) => {
      if (!context.binding.hasListeners(Hook.onLockInspectError)) return
      dispatchStorageObservation(
        context,
        Hook.onLockInspectError,
        () => ({ ...observerIdentity(context), code }),
        true
      )
    },
    report: context.report
  }
}

/** Build the sql observation table with the original registration and scope identity. */
function createSqlObservers(context: IStorageObserverContext): ISqlStageObserver {
  return {
    kind: StorageStageKind.sql,
    forTransaction: (next) => createStorageObservers(context.binding, context.store, next).sql,
    beforeSql: (parameterCount, sqlBytes) => {
      if (!context.binding.hasListeners(Hook.beforeSql)) return
      dispatchStorageObservation(context, Hook.beforeSql, () => ({
        ...observerIdentity(context),
        parameterCount,
        sqlBytes
      }))
    },
    afterSql: (elapsedMs, rows) => {
      if (!context.binding.hasListeners(Hook.afterSql)) return
      dispatchStorageObservation(context, Hook.afterSql, () => ({
        ...observerIdentity(context),
        elapsedMs,
        rows
      }))
    },
    onSqlError: (code) => {
      if (!context.binding.hasListeners(Hook.onSqlError)) return
      dispatchStorageObservation(
        context,
        Hook.onSqlError,
        () => ({ ...observerIdentity(context), code }),
        true
      )
    },
    report: context.report
  }
}
