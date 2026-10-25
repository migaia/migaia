import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { type IConflictPolicy, type IOperationContext, type ISyncWriteOptions } from './context.js'
import { ConflictPolicy } from './context.js'
import { assertStorageOrgId } from './org.js'
import { StorageContractErrorText } from './error-text.js'

/** Write callers share the context validator without requiring a supplied conflict choice. */
export type IOperationValidationContext = IOperationContext & {
  readonly conflictPolicy?: unknown
}

/** Operation fields captured before backend work; the signal retains its original live identity. */
export type IOperationContextSnapshot = IOperationContext & {
  /** Omission preserves the backend's conflict-policy default. */
  readonly conflictPolicy?: IConflictPolicy
}

/** Validates the shared conflict-policy domain without copying the caller's options. */
function assertConflictPolicy(policy: unknown): void {
  if (
    policy !== undefined &&
    policy !== ConflictPolicy.conflict &&
    policy !== ConflictPolicy.replace
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.conflictPolicy)
    })
}

/**
 * Validates operation inputs without allocating a snapshot, timer or listener. Backends retain
 * cancellation and deadline ownership. An already-aborted, structurally valid signal is accepted.
 */
export function assertOperationContext(ctx: IOperationValidationContext | undefined): void {
  if (ctx === undefined) return
  if (typeof ctx !== 'object' || ctx === null || Array.isArray(ctx))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.operationContextObject)
    })
  /** Validation borrows the original live cancellation source without copying its methods. */
  const signal = ctx.signal
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.operationContextSignal)
    })
  if (ctx.timeoutMs !== undefined && (!Number.isSafeInteger(ctx.timeoutMs) || ctx.timeoutMs < 0))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError(StorageContractErrorText.operationContextTimeout)
    })
  if (
    ctx.pageSize !== undefined &&
    (!Number.isInteger(ctx.pageSize) || ctx.pageSize < 1 || ctx.pageSize > 4096)
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError(StorageContractErrorText.operationContextPageSize)
    })
  assertConflictPolicy(ctx.conflictPolicy)
  if (ctx.orgId !== undefined) assertStorageOrgId(ctx.orgId)
}

/** Validates synchronous write options without allocating or admitting asynchronous control fields. */
export function assertSyncWriteOptions(
  options: unknown
): asserts options is ISyncWriteOptions | undefined {
  if (options === undefined) return
  if (typeof options !== 'object' || options === null || Array.isArray(options))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.syncWriteObject)
    })
  /** Only the existing reduced synchronous write shape is accepted. */
  const candidate = options as {
    readonly signal?: unknown
    readonly timeoutMs?: unknown
    readonly conflictPolicy?: unknown
  }
  if (candidate.signal !== undefined || candidate.timeoutMs !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.syncWriteContext)
    })
  assertConflictPolicy(candidate.conflictPolicy)
}
