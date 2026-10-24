import { assertTransactionOwner } from './authoring/transaction.js'
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
import type { IStorageHookIdentity, IStorageHookMap } from './hook-types.js'
import type { IStorageHookEmitter } from './hooks.js'
import { StorageHookName as Hook } from './hook-names.js'

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

/** Bind stages to one real store; transaction projections consult only the canonical owner. */
export function createStorageObservers(
  binding: IStorageObserverBinding,
  store: () => IStorageBase,
  scope?: object
): IStorageObserverSet {
  /** Capture authentic transaction identity while its actual scope is valid. */
  const transaction = scope === undefined ? undefined : assertTransactionOwner(store(), scope)
  /** Each observation retains the registration's immutable organization identity. */
  const identity = (): IStorageHookIdentity =>
    transaction === undefined
      ? binding.identity()
      : { ...binding.identity(), transactionId: transaction.id }
  /** Terminal observations retain the identity captured before the owner finalized its scope. */
  const dispatch = <K extends keyof IStorageHookMap>(
    name: K,
    payload: () => IStorageHookMap[K],
    terminal = false
  ): void => {
    try {
      if (!terminal) {
        binding.assertCurrent()
        if (scope !== undefined) assertTransactionOwner(store(), scope)
      }
      binding.emit(name, payload)
    } catch (error) {
      binding.report(error)
    }
  }
  /** Return the caller's report result synchronously as required by every neutral observer. */
  const report = (error: unknown): undefined => {
    binding.report(error)
    return undefined
  }
  return {
    backend: {
      kind: StorageStageKind.backend,
      beforeBackendCreate: () => {
        if (!binding.hasListeners(Hook.beforeBackendCreate)) return
        dispatch(Hook.beforeBackendCreate, identity)
      },
      afterBackendCreate: () => {
        if (!binding.hasListeners(Hook.afterBackendCreate)) return
        dispatch(Hook.afterBackendCreate, identity)
      },
      onBackendRejected: (code) => {
        if (!binding.hasListeners(Hook.onBackendRejected)) return
        dispatch(Hook.onBackendRejected, () => ({ ...identity(), code }), true)
      },
      afterBackendInstall: () => {
        if (!binding.hasListeners(Hook.afterBackendInstall)) return
        dispatch(Hook.afterBackendInstall, identity)
      },
      onBackendDisposeStart: () => {
        if (!binding.hasListeners(Hook.onBackendDisposeStart)) return
        dispatch(Hook.onBackendDisposeStart, identity, true)
      },
      afterBackendDispose: () => {
        if (!binding.hasListeners(Hook.afterBackendDispose)) return
        dispatch(Hook.afterBackendDispose, identity, true)
      },
      report
    },
    operation: {
      kind: StorageStageKind.operation,
      forTransaction: (next) => createStorageObservers(binding, store, next).operation,
      beforeStorageOperation: (operation, count) => {
        if (!binding.hasListeners(Hook.beforeStorageOperation)) return
        dispatch(Hook.beforeStorageOperation, () => ({
          ...identity(),
          operation,
          ...(count === undefined ? {} : { count })
        }))
      },
      afterStorageOperation: (operation, elapsedMs, count) => {
        if (!binding.hasListeners(Hook.afterStorageOperation)) return
        dispatch(Hook.afterStorageOperation, () => ({
          ...identity(),
          operation,
          elapsedMs,
          count
        }))
      },
      onStorageOperationError: (operation, code, count) => {
        if (!binding.hasListeners(Hook.onStorageOperationError)) return
        dispatch(
          Hook.onStorageOperationError,
          () => ({
            ...identity(),
            operation,
            code,
            ...(count === undefined ? {} : { count })
          }),
          true
        )
      },
      onStorageIterationClose: (count) => {
        if (!binding.hasListeners(Hook.onStorageIterationClose)) return
        dispatch(Hook.onStorageIterationClose, () => ({ ...identity(), count }), true)
      },
      report
    },
    codec: {
      kind: StorageStageKind.codec,
      forTransaction: (next) => createStorageObservers(binding, store, next).codec,
      beforeEncode: (operation, codec) => {
        if (!binding.hasListeners(Hook.beforeEncode)) return
        dispatch(Hook.beforeEncode, () => ({ ...identity(), operation, codec }))
      },
      afterEncode: (operation, codec) => {
        if (!binding.hasListeners(Hook.afterEncode)) return
        dispatch(Hook.afterEncode, () => ({ ...identity(), operation, codec }))
      },
      onEncodeError: (operation, codec, code) => {
        if (!binding.hasListeners(Hook.onEncodeError)) return
        dispatch(Hook.onEncodeError, () => ({ ...identity(), operation, codec, code }), true)
      },
      beforeDecode: (operation, codec) => {
        if (!binding.hasListeners(Hook.beforeDecode)) return
        dispatch(Hook.beforeDecode, () => ({ ...identity(), operation, codec }))
      },
      afterDecode: (operation, codec) => {
        if (!binding.hasListeners(Hook.afterDecode)) return
        dispatch(Hook.afterDecode, () => ({ ...identity(), operation, codec }))
      },
      onDecodeError: (operation, codec, code) => {
        if (!binding.hasListeners(Hook.onDecodeError)) return
        dispatch(Hook.onDecodeError, () => ({ ...identity(), operation, codec, code }), true)
      },
      report
    },
    query: {
      kind: StorageStageKind.query,
      forTransaction: (next) => createStorageObservers(binding, store, next).query,
      beforeQuery: (source, index, plan) => {
        if (!binding.hasListeners(Hook.beforeQuery)) return
        dispatch(Hook.beforeQuery, () => ({ ...identity(), source, index, plan }))
      },
      afterQuery: (source, index, stats) => {
        if (!binding.hasListeners(Hook.afterQuery)) return
        dispatch(Hook.afterQuery, () => ({ ...identity(), source, index, stats }))
      },
      onQueryError: (source, index, code) => {
        if (!binding.hasListeners(Hook.onQueryError)) return
        dispatch(Hook.onQueryError, () => ({ ...identity(), source, index, code }), true)
      },
      report
    },
    transaction: {
      kind: StorageStageKind.transaction,
      forTransaction: (next) => createStorageObservers(binding, store, next).transaction,
      beforeTransaction: () => {
        if (!binding.hasListeners(Hook.beforeTransaction)) return
        dispatch(Hook.beforeTransaction, identity)
      },
      onTransactionStart: () => {
        if (!binding.hasListeners(Hook.onTransactionStart)) return
        dispatch(Hook.onTransactionStart, identity)
      },
      beforeTxOperation: (operation) => {
        if (!binding.hasListeners(Hook.beforeTxOperation)) return
        dispatch(Hook.beforeTxOperation, () => ({ ...identity(), operation }))
      },
      afterTxOperation: (operation) => {
        if (!binding.hasListeners(Hook.afterTxOperation)) return
        dispatch(Hook.afterTxOperation, () => ({ ...identity(), operation }))
      },
      beforeCommit: () => {
        if (!binding.hasListeners(Hook.beforeCommit)) return
        dispatch(Hook.beforeCommit, identity)
      },
      afterCommit: (changedKeys) => {
        if (!binding.hasListeners(Hook.afterCommit)) return
        dispatch(Hook.afterCommit, () => ({ ...identity(), changedKeys }), true)
      },
      afterRollback: (code) => {
        if (!binding.hasListeners(Hook.afterRollback)) return
        dispatch(Hook.afterRollback, () => ({ ...identity(), code }), true)
      },
      onTransactionClose: () => {
        if (!binding.hasListeners(Hook.onTransactionClose)) return
        dispatch(Hook.onTransactionClose, identity, true)
      },
      beforePersistFlush: () => {
        if (!binding.hasListeners(Hook.beforePersistFlush)) return
        dispatch(Hook.beforePersistFlush, identity)
      },
      afterPersistFlush: () => {
        if (!binding.hasListeners(Hook.afterPersistFlush)) return
        dispatch(Hook.afterPersistFlush, identity)
      },
      report
    },
    concurrency: {
      kind: StorageStageKind.concurrency,
      beforeLockAcquire: (policyName, keyCount) => {
        if (!binding.hasListeners(Hook.beforeLockAcquire)) return
        dispatch(Hook.beforeLockAcquire, () => ({ ...identity(), policyName, keyCount }))
      },
      onLockAcquired: (attempt, keyCount) => {
        if (!binding.hasListeners(Hook.onLockAcquired)) return
        dispatch(Hook.onLockAcquired, () => ({ ...identity(), attempt, keyCount }))
      },
      onLockConflict: (phase, attempt, keyCount, holder) => {
        if (!binding.hasListeners(Hook.onLockConflict)) return
        dispatch(Hook.onLockConflict, () => ({ ...identity(), phase, attempt, keyCount, holder }))
      },
      onLockWait: (attempt, waitedMs) => {
        if (!binding.hasListeners(Hook.onLockWait)) return
        dispatch(Hook.onLockWait, () => ({ ...identity(), attempt, waitedMs }))
      },
      onConcurrencyDecision: (action, attempt) => {
        if (!binding.hasListeners(Hook.onConcurrencyDecision)) return
        dispatch(Hook.onConcurrencyDecision, () => ({ ...identity(), action, attempt }))
      },
      onRetry: (attempt, delayMs, reason) => {
        if (!binding.hasListeners(Hook.onRetry)) return
        dispatch(Hook.onRetry, () => ({ ...identity(), attempt, delayMs, reason }))
      },
      onLockReleased: (attempt, keyCount) => {
        if (!binding.hasListeners(Hook.onLockReleased)) return
        dispatch(Hook.onLockReleased, () => ({ ...identity(), attempt, keyCount }), true)
      },
      onLockLost: (attempt, keyCount) => {
        if (!binding.hasListeners(Hook.onLockLost)) return
        dispatch(Hook.onLockLost, () => ({ ...identity(), attempt, keyCount }), true)
      },
      beforeLockInspect: () => {
        if (!binding.hasListeners(Hook.beforeLockInspect)) return
        dispatch(Hook.beforeLockInspect, identity)
      },
      afterLockInspect: (count) => {
        if (!binding.hasListeners(Hook.afterLockInspect)) return
        dispatch(Hook.afterLockInspect, () => ({ ...identity(), count }))
      },
      onLockInspectError: (code) => {
        if (!binding.hasListeners(Hook.onLockInspectError)) return
        dispatch(Hook.onLockInspectError, () => ({ ...identity(), code }), true)
      },
      report
    },
    sql: {
      kind: StorageStageKind.sql,
      forTransaction: (next) => createStorageObservers(binding, store, next).sql,
      beforeSql: (parameterCount, sqlBytes) => {
        if (!binding.hasListeners(Hook.beforeSql)) return
        dispatch(Hook.beforeSql, () => ({ ...identity(), parameterCount, sqlBytes }))
      },
      afterSql: (elapsedMs, rows) => {
        if (!binding.hasListeners(Hook.afterSql)) return
        dispatch(Hook.afterSql, () => ({ ...identity(), elapsedMs, rows }))
      },
      onSqlError: (code) => {
        if (!binding.hasListeners(Hook.onSqlError)) return
        dispatch(Hook.onSqlError, () => ({ ...identity(), code }), true)
      },
      report
    }
  }
}
