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

/** Attaches stable error identity without replacing the original error object. */
export function attachErrorIdentity<T extends Error>(
  error: T,
  identity: {
    readonly source: string
    readonly code: string
    readonly phase?: string
    readonly detail?: Readonly<Record<string, unknown>>
  }
): T {
  for (const [key, value] of Object.entries(identity)) {
    const existing = Object.getOwnPropertyDescriptor(error, key)
    if (existing && existing.value !== value)
      throw new TypeError(UtilsErrorText.errorIdentityConflict(key), { cause: error })
    if (!existing)
      Object.defineProperty(error, key, {
        configurable: false,
        enumerable: true,
        value,
        writable: false
      })
  }
  return error
}

/** Converts arbitrary thrown values while preserving the original as cause. */
export function toError(value: unknown, options?: { readonly message?: string }): Error {
  if (value instanceof Error) return value
  let message = options?.message ?? UtilsErrorText.nonErrorValue
  try {
    if (options?.message === undefined && typeof value === 'string') message = value
  } catch {
    message = UtilsErrorText.nonErrorValue
  }
  return new UtilsErrorValue(message, value)
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
      if (value instanceof AggregateError) for (const item of value.errors) visit(item, depth + 1)
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
  return value instanceof UtilsError
}

export function isUtilsAbortError(value: unknown): value is UtilsAbortError {
  return value instanceof UtilsAbortError
}

export function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError {
  return value instanceof UtilsTimeoutError
}

export { UtilsErrorCode }
export type { IUtilsErrorCode }
