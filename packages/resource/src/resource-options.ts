/** Single-read constructor and cache-snapshot admission; no runtime ownership or fetch side effects. */
import { tryReadProperty } from '@migaia/utils/error'
import { snapshotScheduler } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import type {
  IResourceOptions,
  IResourceRetryPolicy,
  IResourceCacheSnapshot
} from './resource-types.ts'
import { createResourceError, tagResourceError } from './errors.ts'
import { createResourceOptionTypeError } from './resource-failure.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'

/** Normalized, validated constructor options retained after the single admission snapshot. */
export type IResourceOptionSnapshot<T> = {
  readonly debugName: string | undefined
  readonly ttl: number
  readonly autoStart: boolean
  readonly staleWhileRevalidate: boolean
  readonly retry: IResourceRetryPolicy
  readonly retryDelay: number | ((failureCount: number, error: unknown) => number)
  readonly keepAlive: boolean
  readonly initialSnapshot: IResourceCacheSnapshot<T> | undefined
  readonly scheduler: IScheduler
}

/** Rejects unsupported TTL values before creating any runtime-owned Resource state. */
function validateTtl(ttl: number): void {
  if (ttl !== Infinity && (!Number.isFinite(ttl) || ttl < 0)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.ttlInvalid),
      ResourceErrorCode.invalidOption
    )
  }
}

/** Rejects numeric retry policies outside the nonnegative integer domain. */
function validateRetry(retry: IResourceRetryPolicy): void {
  if (typeof retry === 'number' && (!Number.isInteger(retry) || retry < 0)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.retryInvalid),
      ResourceErrorCode.invalidOption
    )
  }
}

/** Reads one public option once and maps a hostile accessor to Resource INVALID_OPTION. */
function readResourceOption<T, K extends keyof IResourceOptions<T>>(
  options: IResourceOptions<T>,
  key: K,
  message: string
): IResourceOptions<T>[K] {
  /** The option failure remains the cause of the package-owned TypeError. */
  const read = tryReadProperty(options, key)
  if (read.threw) throw createResourceOptionTypeError(message, read.error)
  return read.value
}

/** Snapshots and validates one initial cache value before runtime ownership is established. */
export function snapshotInitialSnapshot<T>(value: unknown): IResourceCacheSnapshot<T> | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') {
    throw createResourceError(ResourceErrorCode.invalidSnapshot, ResourceErrorText.invalidSnapshot)
  }
  /** Snapshot schema version is read before the payload and duration metadata. */
  let version: unknown
  /** Payload remains caller-owned and is never cloned by admission. */
  let data: T
  /** Captured cache age must be a finite nonnegative duration. */
  let ageMs: unknown
  /** Null means unlimited lifetime; numeric values remain finite and nonnegative. */
  let remainingTtlMs: unknown
  try {
    version = (value as { version?: unknown }).version
    data = (value as { data: T }).data
    ageMs = (value as { ageMs?: unknown }).ageMs
    remainingTtlMs = (value as { remainingTtlMs?: unknown }).remainingTtlMs
  } catch (error) {
    throw createResourceError(
      ResourceErrorCode.invalidSnapshot,
      ResourceErrorText.invalidSnapshot,
      { cause: error }
    )
  }
  if (
    version !== 2 ||
    typeof ageMs !== 'number' ||
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    (remainingTtlMs !== null &&
      (typeof remainingTtlMs !== 'number' ||
        !Number.isFinite(remainingTtlMs) ||
        remainingTtlMs < 0))
  ) {
    throw createResourceError(ResourceErrorCode.invalidSnapshot, ResourceErrorText.invalidSnapshot)
  }
  return { version: 2, data, ageMs, remainingTtlMs }
}

/** Admits every public constructor option exactly once before Resource ownership or fetch setup. */
export function snapshotResourceOptions<T>(
  options: IResourceOptions<T>
): IResourceOptionSnapshot<T> {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function')) {
    throw createResourceOptionTypeError(ResourceErrorText.optionsSnapshotFailed)
  }
  /** Diagnostic label is the first public option sampled. */
  const debugName = readResourceOption(
    options,
    'debugName',
    ResourceErrorText.debugNameAccessorFailed
  )
  /** Freshness duration is sampled once before its numeric validation. */
  const ttl = readResourceOption(options, 'ttl', ResourceErrorText.optionsSnapshotFailed)
  /** Constructor-start policy is sampled before any fetch side effects. */
  const autoStart = readResourceOption(
    options,
    'autoStart',
    ResourceErrorText.autoStartAccessorFailed
  )
  /** Refresh presentation policy is read in the original option order. */
  const staleWhileRevalidate = readResourceOption(
    options,
    'staleWhileRevalidate',
    ResourceErrorText.optionsSnapshotFailed
  )
  /** Retry count or policy callback is sampled before validation. */
  const retry = readResourceOption(options, 'retry', ResourceErrorText.optionsSnapshotFailed)
  /** Retry-delay value or callback is sampled without executing the callback. */
  const retryDelay = readResourceOption(
    options,
    'retryDelay',
    ResourceErrorText.optionsSnapshotFailed
  )
  /** Dependency retention policy is sampled once during admission. */
  const keepAlive = readResourceOption(
    options,
    'keepAlive',
    ResourceErrorText.optionsSnapshotFailed
  )
  /** Initial cache input is sampled before snapshot schema admission. */
  const initialSnapshot = readResourceOption(
    options,
    'initialSnapshot',
    ResourceErrorText.initialSnapshotAccessorFailed
  )
  /** Injected scheduler is sampled last, before any scheduler method snapshot. */
  const schedulerOption = readResourceOption(
    options,
    'scheduler',
    ResourceErrorText.optionsSnapshotFailed
  )

  if (debugName !== undefined && typeof debugName !== 'string') {
    throw createResourceOptionTypeError(ResourceErrorText.debugNameInvalid)
  }
  /** Normalized TTL preserves the existing nullish default and validation order. */
  const admittedTtl = ttl ?? Infinity
  if (typeof admittedTtl !== 'number') {
    throw createResourceOptionTypeError(ResourceErrorText.ttlInvalid)
  }
  validateTtl(admittedTtl)
  if (autoStart !== undefined && typeof autoStart !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  if (staleWhileRevalidate !== undefined && typeof staleWhileRevalidate !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  /** Normalized retry policy retains its existing zero default. */
  const admittedRetry = retry ?? 0
  if (typeof admittedRetry !== 'number' && typeof admittedRetry !== 'function') {
    throw createResourceOptionTypeError(ResourceErrorText.retryInvalid)
  }
  /** Admitted policy has the public retry union after runtime kind validation. */
  const validatedRetry = admittedRetry as IResourceRetryPolicy
  validateRetry(validatedRetry)
  /** Normalized delay retains its existing zero default. */
  const admittedRetryDelay = retryDelay ?? 0
  if (typeof admittedRetryDelay !== 'number' && typeof admittedRetryDelay !== 'function') {
    throw createResourceOptionTypeError(ResourceErrorText.retryDelayInvalid)
  }
  if (
    typeof admittedRetryDelay === 'number' &&
    (!Number.isFinite(admittedRetryDelay) || admittedRetryDelay < 0)
  ) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.retryDelayInvalid),
      ResourceErrorCode.invalidOption
    )
  }
  if (keepAlive !== undefined && typeof keepAlive !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  /** Admitted delay has the public numeric-or-callback contract. */
  const validatedRetryDelay = admittedRetryDelay as
    | number
    | ((failureCount: number, error: unknown) => number)
  /** Validated portable cache snapshot is ready before scheduler admission. */
  const admittedInitialSnapshot = snapshotInitialSnapshot<T>(initialSnapshot)
  /** Default scheduler is replaced only by one successfully admitted snapshot. */
  let admittedScheduler = systemScheduler
  if (schedulerOption !== undefined) {
    /** Lifecycle owns method snapshot and scheduler contract validation. */
    let schedulerSnapshot: IScheduler | undefined
    try {
      schedulerSnapshot = snapshotScheduler(schedulerOption)
    } catch (error) {
      /** Preserve the host getter error already carried by lifecycle admission. */
      const cause = error instanceof Error && 'cause' in error ? error.cause : error
      throw createResourceOptionTypeError(ResourceErrorText.schedulerAccessorFailed, cause)
    }
    if (schedulerSnapshot === undefined) {
      throw createResourceOptionTypeError(ResourceErrorText.schedulerInvalid)
    }
    admittedScheduler = schedulerSnapshot
  }
  return {
    debugName: debugName as string | undefined,
    ttl: admittedTtl,
    autoStart: (autoStart ?? true) as boolean,
    staleWhileRevalidate: (staleWhileRevalidate ?? false) as boolean,
    retry: validatedRetry,
    retryDelay: validatedRetryDelay,
    keepAlive: (keepAlive ?? false) as boolean,
    initialSnapshot: admittedInitialSnapshot,
    scheduler: admittedScheduler
  }
}
