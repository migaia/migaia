/**
 * Own native error identity, guarded property reads, conversion and cause traversal without
 * importing public barrels.
 */

import { ERROR_SOURCE, UtilsErrorCode, type IUtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'

/** Public utils error domain; callers compare this stable identity across package moves. */
export const UTILS_SOURCE = ERROR_SOURCE

/** Result of one property read; failures retain the exact value thrown by the getter. */
export type IPropertyRead<T> =
  | { readonly threw: false; readonly value: T }
  | { readonly threw: true; readonly error: unknown }

/**
 * Reads one property with the original receiver and returns a throwing getter's value as data. The
 * caller owns fallback, reporting, and rethrow policy.
 */
export function tryReadProperty<T extends object, K extends keyof T>(
  target: T,
  key: K
): IPropertyRead<T[K]> {
  try {
    return { threw: false, value: target[key] }
  } catch (error) {
    return { threw: true, error }
  }
}

/**
 * Recognizes Error-family prototype chains across realms for native identity preservation. This is
 * a diagnostic shape check, not proof of trust or native internal slots. It never invokes caller
 * methods and returns false when a revoked proxy or hostile prototype cannot be inspected.
 */
export function isNativeErrorValue(value: unknown): value is Error {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  try {
    if (value instanceof Error) return true
    /** Bound prototype traversal so malformed chains cannot hold error handling indefinitely. */
    let prototype: object | null = Object.getPrototypeOf(value)
    for (let depth = 0; prototype !== null && depth < 32; depth += 1) {
      /** Descriptor inspection avoids invoking a caller-defined constructor getter. */
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
      /** A matching constructor/prototype pair identifies the Error-family prototype shape. */
      const constructorPrototype =
        typeof constructor === 'function'
          ? Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value
          : undefined
      /** Native Error.prototype owns its name and toString as data properties. */
      const name = Object.getOwnPropertyDescriptor(prototype, 'name')?.value
      /** Only inspect the method descriptor; invoking it would execute caller-owned code. */
      const toString = Object.getOwnPropertyDescriptor(prototype, 'toString')?.value
      if (constructorPrototype === prototype && name === 'Error' && typeof toString === 'function')
        return true
      prototype = Object.getPrototypeOf(prototype)
    }
  } catch {
    return false
  }
  return false
}

/** Base error retaining the utils source and stable semantic code. */
export abstract class UtilsError extends Error {
  /** The package domain stays stable when the implementation moves between files. */
  readonly source = ERROR_SOURCE
  /** The semantic failure code is selected by the concrete native error owner. */
  readonly code: IUtilsErrorCode

  /** Preserve native Error allocation and its original cause while assigning utils identity. */
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

  /** Keep the exact cancellation reason reachable as this error's cause. */
  constructor(reason?: unknown) {
    super(UtilsErrorCode.aborted, UtilsErrorText.aborted, { cause: reason })
  }
}

/** Stable deadline labels shared by Promise owners and the public timeout error. */
export const UtilsTimeoutScope = {
  /** A direct withTimeout call owns this operation deadline. */
  operation: 'operation',
  /** One retry attempt owns this deadline independently of the complete run. */
  attempt: 'attempt',
  /** The complete retry run owns this deadline across attempts and waits. */
  total: 'total'
} as const

/** Scope keys match their unchanged public error values. */
export type UtilsTimeoutScope = keyof typeof UtilsTimeoutScope

/** Error representing an operation, attempt, or total deadline. */
export class UtilsTimeoutError extends UtilsError {
  readonly name = 'TimeoutError' as const

  /** Capture the deadline scope and duration without altering the native timeout identity. */
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
 * Adds stable `source` / `code` (and optional `phase` / `detail`) fields to an existing error
 * without replacing it, so `instanceof` and the stack stay intact. A field that already holds a
 * different value throws `TypeError` unless `onConflict` picks a target; optional hooks let a
 * package keep its own fallback for conflicts and non-extensible targets.
 */
export function attachErrorIdentity<T extends object>(
  error: T,
  identity: IErrorIdentity,
  hooks?: IErrorIdentityHooks<T>
): T {
  /** Target may change only when caller-selected recovery returns a replacement object. */
  let target = error
  for (const [key, value] of Object.entries(identity)) {
    /** Descriptor reads detect identity conflicts without executing an existing accessor. */
    const existing = Object.getOwnPropertyDescriptor(target, key)
    if (existing && existing.value !== value) {
      if (hooks?.onConflict) {
        target = hooks.onConflict({ target, key, existing: existing.value, incoming: value })
        continue
      }
      throw attachErrorIdentity(
        new TypeError(UtilsErrorText.errorIdentityConflict(key), { cause: target }),
        { source: ERROR_SOURCE, code: UtilsErrorCode.errorIdentityConflict }
      )
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
      /** Reuse an existing error list only when its descriptor admits an actual array. */
      const existingDescriptor = Object.getOwnPropertyDescriptor(primary, 'errors')
      /** Accessors keep their original receiver and execute only once before fallback selection. */
      const existing = existingDescriptor
        ? 'value' in existingDescriptor
          ? existingDescriptor.value
          : Reflect.get(primary, 'errors', primary)
        : undefined
      if (existingDescriptor !== undefined && !Array.isArray(existing))
        return new AggregateError([primary, ...secondaryErrors])
      /** Append in observed order without mutating a list already exposed to another caller. */
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
        /** Hold the diagnostic getter result so conversion never re-reads a hostile accessor. */
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
  /** Caller presentation wins; otherwise retain string throws and the stable non-error fallback. */
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
    /** Preserve the existing cross-realm diagnostic shape read order. */
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

/** Coded native wrapper for arbitrary thrown values that do not already supply an error shape. */
class UtilsErrorValue extends UtilsError {
  /** The unmodified thrown value stays on cause for boundary traceability. */
  constructor(message: string, cause: unknown) {
    super(UtilsErrorCode.nonErrorValue, message, { cause })
  }
}

/**
 * Lists an error and everything reachable through `cause` and `AggregateError.errors`, starting
 * with the error itself. Identical values appear once, so cycles end; `maxDepth` (default 32)
 * bounds the walk. An explicit `cause: undefined` contributes an `undefined` entry, so read fields
 * with `?.`.
 */
export function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly unknown[] {
  /** Each call owns its result, seen identities and existing caller-selected depth budget. */
  const context: IErrorCauseWalk = {
    result: [],
    seen: new Set(),
    maxDepth: options?.maxDepth ?? 32
  }
  visitErrorCause(error, 0, context)
  return context.result
}

/** Explicit state for the depth-bounded cause walk, never shared between error operations. */
type IErrorCauseWalk = {
  readonly result: unknown[]
  readonly seen: Set<unknown>
  readonly maxDepth: number
}

/** Visit one identity in the original aggregate-before-cause order, retaining hostile read failures. */
function visitErrorCause(value: unknown, depth: number, context: IErrorCauseWalk): void {
  if (depth > context.maxDepth || context.seen.has(value)) return
  context.seen.add(value)
  context.result.push(value)
  try {
    if (isAggregateErrorLike(value))
      for (const item of value.errors) visitErrorCause(item, depth + 1, context)
  } catch (cause) {
    visitErrorCause(cause, depth + 1, context)
  }
  try {
    if (value && typeof value === 'object' && 'cause' in value)
      visitErrorCause((value as { cause?: unknown }).cause, depth + 1, context)
  } catch (cause) {
    visitErrorCause(cause, depth + 1, context)
  }
}

/** Combines zero, one, or many errors while preserving iteration failures. */
export function combineErrors(errors: Iterable<unknown>, message: string): Error | undefined {
  /** The one input iteration owns an ordered list, including an iteration failure when present. */
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

/** Recognizes diagnostic error shapes only when both utils identity fields are valid. */
export function isUtilsError(value: unknown): value is UtilsError {
  if (!isErrorLike(value)) return false
  try {
    /** Code admission must prove the union promised by this type guard. */
    const code = (value as { code?: unknown }).code
    return (value as { source?: unknown }).source === ERROR_SOURCE && Object.values(UtilsErrorCode).some((registered) => registered === code)
  } catch {
    return false
  }
}

/**
 * True for a utils error shape with code `ABORTED` (cooperative cancellation); no `instanceof`
 * needed.
 */
export function isUtilsAbortError(value: unknown): value is UtilsAbortError {
  return isUtilsError(value) && (value as { code?: unknown }).code === UtilsErrorCode.aborted
}

/**
 * True for a utils error shape with code `DEADLINE_EXCEEDED`; read `scope` and `timeoutMs` to tell
 * an operation, attempt or total deadline apart. No `instanceof` needed.
 */
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
