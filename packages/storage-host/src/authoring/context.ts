import {
  type IOperationValidationContext,
  type IOperationContextSnapshot,
  assertOperationContext,
  assertSyncWriteOptions,
  type IConflictPolicy,
  type ISyncWriteOptions
} from '@migaia/storage-contract'

/**
 * Captures scalar options before backend awaits so later caller mutation cannot change accepted
 * cancellation, timeout, paging, conflict or organization choices. The live signal is borrowed.
 */
export function snapshotOperationContext(
  ctx: IOperationValidationContext | undefined
): IOperationContextSnapshot | undefined {
  assertOperationContext(ctx)
  if (ctx === undefined) return undefined
  return {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    pageSize: ctx.pageSize,
    conflictPolicy: ctx.conflictPolicy as IConflictPolicy | undefined,
    ...(ctx.orgId === undefined ? {} : { orgId: ctx.orgId })
  }
}

/** Captures the reduced conflict choice for callers that retain options beyond synchronous work. */
export function snapshotSyncWriteOptions(options: unknown): ISyncWriteOptions {
  assertSyncWriteOptions(options)
  return { conflictPolicy: options?.conflictPolicy }
}
