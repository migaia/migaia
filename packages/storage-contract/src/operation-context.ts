import type { IAbortSignal } from '@migaia/utils/promise'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import type { IConflictPolicy, IOperationContext } from './context.js'
import { ConflictPolicy } from './context.js'
import { StorageContractErrorText } from './error-text.js'

type IOperationValidationContext = IOperationContext & {
  readonly conflictPolicy?: unknown
}

/** Frozen operation fields captured once. The signal remains the original live signal object. */
export type IOperationContextSnapshot = IOperationContext & {
  /**
   * Optional validated write policy; omission remains undefined rather than inserting a provider
   * default.
   */
  readonly conflictPolicy?: IConflictPolicy
}

/** Tracks frozen snapshots created here so layered consumers never re-read host getters. */
const operationContextSnapshots = new WeakSet<object>()

/**
 * Captures operation fields before a backend starts I/O, timers, or cancellation handling.
 * undefined stays undefined; a snapshot previously produced here is returned by identity. Otherwise
 * reads signal, timeoutMs, pageSize, and conflictPolicy once into a frozen record.
 *
 * TimeoutMs must be a non-negative safe integer; pageSize an integer from 1 through 4096;
 * conflictPolicy is conflict or replace. A signal must expose boolean aborted and callable
 * add/remove methods. Invalid fields/getters throw INVALID_ARGUMENT with the original cause. No
 * timer or listener is installed, and an already-aborted valid signal is not rejected here.
 */
export const snapshotOperationContext = (
  ctx: IOperationValidationContext | undefined
): IOperationContextSnapshot | undefined => {
  if (ctx === undefined) return undefined
  if (operationContextSnapshots.has(ctx)) return ctx as IOperationContextSnapshot
  if (typeof ctx !== 'object' || ctx === null || Array.isArray(ctx))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('operation context must be an object')
    })
  let signal: unknown
  let timeoutMs: unknown
  let pageSize: unknown
  let conflictPolicy: unknown
  try {
    signal = ctx.signal
    timeoutMs = ctx.timeoutMs
    pageSize = ctx.pageSize
    conflictPolicy = ctx.conflictPolicy
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  let signalAborted: unknown
  let signalAddEventListener: unknown
  let signalRemoveEventListener: unknown
  if (typeof signal === 'object' && signal !== null) {
    try {
      signalAborted = (signal as IAbortSignal).aborted
      signalAddEventListener = (signal as IAbortSignal).addEventListener
      signalRemoveEventListener = (signal as IAbortSignal).removeEventListener
    } catch (cause) {
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
    }
  }
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof signalAborted !== 'boolean' ||
      typeof signalAddEventListener !== 'function' ||
      typeof signalRemoveEventListener !== 'function')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('signal must implement the IAbortSignal surface')
    })
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 0))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError('timeoutMs must be a non-negative safe integer')
    })
  if (
    pageSize !== undefined &&
    (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 4096)
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError('pageSize must be an integer between 1 and 4096')
    })
  if (
    conflictPolicy !== undefined &&
    conflictPolicy !== ConflictPolicy.conflict &&
    conflictPolicy !== ConflictPolicy.replace
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.conflictPolicy)
    })
  const snapshot: IOperationContextSnapshot = Object.freeze({
    signal: signal as IAbortSignal | undefined,
    timeoutMs: timeoutMs as number | undefined,
    pageSize: pageSize as number | undefined,
    conflictPolicy: conflictPolicy as IConflictPolicy | undefined
  })
  operationContextSnapshots.add(snapshot)
  return snapshot
}

/**
 * Validates the same operation shape as snapshotOperationContext and discards the snapshot. Valid
 * input returns void; invalid fields throw INVALID_ARGUMENT. This performs no I/O and does not
 * enforce a deadline, observe cancellation, or create a timer.
 */
export const assertOperationContext = (ctx: IOperationValidationContext | undefined): void => {
  snapshotOperationContext(ctx)
}

/**
 * Captures a synchronous write's conflictPolicy without creating asynchronous control state.
 * Omitted options produce a new record with an undefined policy. conflict and replace are valid;
 * non-undefined signal/timeoutMs, malformed options, or invalid policy throw INVALID_ARGUMENT.
 * Getter/reflection failures are retained as cause. The returned record is not frozen.
 */
export const snapshotSyncWriteOptions = (
  options: unknown
): { readonly conflictPolicy?: IConflictPolicy } => {
  const candidate = options as
    | { readonly signal?: unknown; readonly timeoutMs?: unknown; readonly conflictPolicy?: unknown }
    | undefined
  let signal: unknown
  let timeoutMs: unknown
  let conflictPolicy: unknown
  try {
    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    )
      throw new TypeError(StorageContractErrorText.syncWriteObject)
    signal = candidate?.signal
    timeoutMs = candidate?.timeoutMs
    conflictPolicy = candidate?.conflictPolicy
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (signal !== undefined || timeoutMs !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.syncWriteContext)
    })
  if (
    conflictPolicy !== undefined &&
    conflictPolicy !== ConflictPolicy.conflict &&
    conflictPolicy !== ConflictPolicy.replace
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.conflictPolicy)
    })
  return { conflictPolicy: conflictPolicy as IConflictPolicy | undefined }
}

/** Validates snapshotSyncWriteOptions' reduced shape, returning void or throwing INVALID_ARGUMENT. */
export const assertSyncWriteOptions = (options: unknown): void => {
  snapshotSyncWriteOptions(options)
}
