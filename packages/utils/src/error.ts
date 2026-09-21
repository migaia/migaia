import { UtilsErrorCode, type IUtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'

/** Base error retaining the utils source and stable semantic code. */
export abstract class UtilsError extends Error {
  readonly source = '@migaia/utils' as const
  readonly code: IUtilsErrorCode

  protected constructor(
    code: IUtilsErrorCode,
    message: string,
    options?: { readonly cause?: unknown }
  ) {
    super(message, options)
    this.name = 'UtilsError'
    this.code = code
  }
}

/** Error representing cooperative cancellation. */
export class UtilsAbortError extends UtilsError {
  readonly name = 'AbortError' as const

  constructor(reason?: unknown) {
    super(UtilsErrorCode.aborted, UtilsErrorText.aborted, { cause: reason })
  }
}

/** Error representing an operation, attempt, or total deadline. */
export class UtilsTimeoutError extends UtilsError {
  readonly name = 'TimeoutError' as const

  constructor(
    readonly scope: 'operation' | 'attempt' | 'total',
    readonly timeoutMs: number
  ) {
    super(UtilsErrorCode.deadlineExceeded, UtilsErrorText.deadlineExceeded(scope, timeoutMs))
  }
}

/** Stable identity fields shared by package-boundary native errors. */
export type IErrorIdentity = {
  readonly source: string
  readonly code: string
  readonly phase?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/**
 * Caller-owned recovery for an identity attachment conflict or descriptor write failure. Each hook
 * returns the target that receives any remaining identity fields.
 */
export type IErrorIdentityHooks<T extends object> = {
  readonly onConflict?: (context: {
    readonly target: T
    readonly key: string
    readonly existing: unknown
    readonly incoming: unknown
  }) => T
  readonly onFailure?: (context: {
    readonly target: T
    readonly key: string
    readonly incoming: unknown
    readonly cause: unknown
  }) => T
}

/**
 * Attaches stable identity without replacing the original object. Optional hooks let a package
 * preserve its own fallback semantics for conflicts and non-extensible targets.
 */
export function attachErrorIdentity<T extends object>(
  error: T,
  identity: IErrorIdentity,
  hooks?: IErrorIdentityHooks<T>
): T {
  /** Target may change only when caller-selected recovery returns a replacement object. */
  let target = error
  for (const [key, value] of Object.entries(identity)) {
    const existing = Object.getOwnPropertyDescriptor(target, key)
    if (existing && existing.value !== value) {
      if (hooks?.onConflict) {
        target = hooks.onConflict({ target, key, existing: existing.value, incoming: value })
        continue
      }
      throw new TypeError(UtilsErrorText.errorIdentityConflict(key), { cause: target })
    }
    if (existing) continue
    try {
      Object.defineProperty(target, key, {
        configurable: false,
        enumerable: true,
        value,
        writable: false
      })
    } catch (cause) {
      if (hooks?.onFailure) {
        target = hooks.onFailure({ target, key, incoming: value, cause })
        continue
      }
      throw cause
    }
  }
  return target
}

/**
 * Appends secondary failures to a primary without changing primary identity. A hostile or
 * non-extensible primary receives an `AggregateError` fallback whose first entry is the primary.
 */
export function attachSecondaryErrors(
  primary: unknown,
  secondaryErrors: readonly unknown[]
): unknown {
  if (secondaryErrors.length === 0) return primary
  if (primary !== null && (typeof primary === 'object' || typeof primary === 'function')) {
    try {
      const existingDescriptor = Object.getOwnPropertyDescriptor(primary, 'errors')
      const existing = existingDescriptor
        ? 'value' in existingDescriptor
          ? existingDescriptor.value
          : Reflect.get(primary, 'errors', primary)
        : undefined
      if (existingDescriptor !== undefined && !Array.isArray(existing))
        return new AggregateError([primary, ...secondaryErrors])
      const errors = Object.freeze([
        ...(Array.isArray(existing) ? existing : []),
        ...secondaryErrors
      ])
      Object.defineProperty(primary, 'errors', {
        configurable: true,
        enumerable: false,
        value: errors,
        writable: false
      })
      return primary
    } catch {
      // Frozen primaries and hostile accessors use the identity-preserving aggregate fallback.
    }
  }
  return new AggregateError([primary, ...secondaryErrors])
}

/** Reads an arbitrary failure's diagnostic reason once, returning a caller-owned safe fallback. */
export function safeErrorReason(error: unknown, fallback: string): string {
  try {
    if (error instanceof Error) {
      try {
        const message = error.message
        return typeof message === 'string' ? message : String(message)
      } catch {
        return fallback
      }
    }
    try {
      return String(error)
    } catch {
      return fallback
    }
  } catch {
    return fallback
  }
}

/** Converts arbitrary thrown values while preserving the original as cause. */
export function toError(value: unknown, options?: { readonly message?: string }): Error {
  if (isErrorLike(value)) return value
  let message = options?.message ?? UtilsErrorText.nonErrorValue
  try {
    if (options?.message === undefined && typeof value === 'string') message = value
  } catch {
    message = UtilsErrorText.nonErrorValue
  }
  return new UtilsErrorValue(message, value)
}

/** Recognizes native errors from other realms without relying on this realm's constructor. */
function isErrorLike(value: unknown): value is Error {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    const candidate = value as {
      readonly name?: unknown
      readonly message?: unknown
      readonly stack?: unknown
    }
    return (
      typeof candidate.name === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.stack === 'string'
    )
  } catch {
    return false
  }
}

class UtilsErrorValue extends UtilsError {
  constructor(message: string, cause: unknown) {
    super(UtilsErrorCode.nonErrorValue, message, { cause })
  }
}

/** Walks cause and AggregateError chains with bounded identity deduplication. */
export function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly unknown[] {
  const result: unknown[] = []
  const seen = new Set<unknown>()
  const maxDepth = options?.maxDepth ?? 32
  const visit = (value: unknown, depth: number): void => {
    if (depth > maxDepth || seen.has(value)) return
    seen.add(value)
    result.push(value)
    try {
      if (isAggregateErrorLike(value)) for (const item of value.errors) visit(item, depth + 1)
    } catch (cause) {
      visit(cause, depth + 1)
    }
    try {
      if (value && typeof value === 'object' && 'cause' in value)
        visit((value as { cause?: unknown }).cause, depth + 1)
    } catch (cause) {
      visit(cause, depth + 1)
    }
  }
  visit(error, 0)
  return result
}

/** Combines zero, one, or many errors while preserving iteration failures. */
export function combineErrors(errors: Iterable<unknown>, message: string): Error | undefined {
  const collected: Error[] = []
  try {
    for (const value of errors) collected.push(toError(value))
  } catch (error) {
    collected.push(toError(error))
    throw new AggregateError(collected, message)
  }
  if (collected.length === 0) return undefined
  if (collected.length === 1) return collected[0]
  return new AggregateError(collected, message)
}

export function isUtilsError(value: unknown): value is UtilsError {
  return isErrorLike(value) && (value as { source?: unknown }).source === '@migaia/utils'
}

export function isUtilsAbortError(value: unknown): value is UtilsAbortError {
  return isUtilsError(value) && (value as { code?: unknown }).code === UtilsErrorCode.aborted
}

export function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError {
  return (
    isUtilsError(value) && (value as { code?: unknown }).code === UtilsErrorCode.deadlineExceeded
  )
}

/** Reads AggregateError entries across realms while containing hostile errors accessors. */
function isAggregateErrorLike(value: unknown): value is AggregateError {
  if (!isErrorLike(value)) return false
  try {
    return Array.isArray((value as { readonly errors?: unknown }).errors)
  } catch {
    return false
  }
}

export { UtilsErrorCode }
export type { IUtilsErrorCode }
