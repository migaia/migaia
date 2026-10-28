/**
 * Own identified-error construction and immutable public methods; admission and call wrappers are
 * separate owners.
 */
import {
  admitIdentity,
  identityError,
  isPlainRecord,
  readString,
  matchesIdentity,
  sameDetail
} from './internal/identify-error-admission.ts'
import { IdentifyErrorFactoryOwner, IdentifyErrorWrapper } from './internal/identify-error-call.ts'
import { UtilsErrorText } from './error-text.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  combineErrors,
  isNativeErrorValue,
  safeErrorReason,
  toError,
  walkErrorCauses,
  type IErrorIdentity
} from './internal/error-primitives.ts'
import { deserializeErrorChain, serializeErrorChain } from './error-chain.ts'
import type { IErrorChainStrategy, ISerializedErrorChain } from './error-chain-types.ts'

/** Identity accepted by `IdentifyError`; literal `source`/`code` types flow into the instance. */
export type IIdentifyErrorIdentity<S extends string = string, C extends string = string> = {
  readonly source: S
  readonly code: C
  readonly phase?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Optional construction inputs; `cause` is the original failure kept reachable on the chain. */
export type IIdentifyErrorOptions = {
  readonly message?: string
  readonly cause?: unknown
}

/** Partial identity used to search or narrow an error chain; omitted fields match anything. */
export type IErrorIdentityMatch = {
  readonly source?: string
  readonly code?: string
  readonly phase?: string
}

/** Any error-like value that carries a readable semantic identity. */
export type IIdentifiedError<S extends string = string, C extends string = string> = Error & {
  readonly source: S
  readonly code: C
  readonly phase?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Editable identity draft returned by `mutable()`; rebuild an error with `IdentifyError.from()`. */
export type IMutableErrorIdentity<S extends string = string, C extends string = string> = {
  source: S
  code: C
  phase?: string
  detail?: Record<string, unknown>
}

/** Per-field equality returned by `compare()`; `detail` compares own keys shallowly. */
export type IErrorIdentityComparison = {
  readonly source: boolean
  readonly code: boolean
  readonly phase: boolean
  readonly detail: boolean
}

/** Options for one factory call produced by `IdentifyError.define()`. */
export type IIdentifyErrorFactoryOptions = IIdentifyErrorOptions & {
  readonly phase?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Reserved member names of a factory; code keys may not reuse them. */
type IIdentifyErrorFactoryReserved = 'source' | 'codes' | 'is' | 'find'

/**
 * Package-scoped error factory created by `IdentifyError.define()`: one constructor per code key,
 * plus `is`/`find` helpers narrowed to this source.
 */
export type IIdentifyErrorFactory<S extends string, M extends Readonly<Record<string, string>>> = {
  readonly source: S
  readonly codes: Readonly<M>
  /** Narrows to this source, optionally to one code key. */
  is<K extends keyof M & string>(value: unknown, key?: K): value is IdentifyError<S, M[K]>
  /** Finds the first chain link carrying this source (and code key when given). */
  find<K extends keyof M & string>(error: unknown, key?: K): IIdentifiedError<S, M[K]> | undefined
} & {
  readonly [K in Exclude<keyof M, IIdentifyErrorFactoryReserved>]: (
    options?: IIdentifyErrorFactoryOptions
  ) => IdentifyError<S, M[K]>
}

/** Handler table for `IdentifyError.match()`, keyed by semantic code; `_` is the fallback. */
export type IIdentifyErrorCases<R> = {
  readonly [code: string]: ((error: IIdentifiedError) => R) | undefined
} & { readonly _?: (error: unknown) => R }

/**
 * Error with a stable semantic identity (`source`, `code`, optional `phase`/`detail`) and an
 * immutable API for comparing, deriving and serializing it.
 *
 * Identity fields are attached through `attachErrorIdentity()` as non-writable, non-configurable
 * own properties, so existing `error.source` / `error.code` readers work unchanged. The original
 * failure stays on `cause` and is returned by `native()`; `stack` is never rewritten. The prototype
 * is frozen, so instance methods cannot be overridden by assignment.
 *
 * @example
 *   ;```ts
 *   try {
 *     await load()
 *   } catch (cause) {
 *     throw IdentifyError.from(cause, { source: 'app.orders', code: 'LOAD_FAILED' })
 *   }
 *   ```
 */
class IdentifyErrorConstructor<S extends string = string, C extends string = string> extends Error {
  /** Package or module that owns the code. Attached as a readonly own property. */
  declare readonly source: S
  /** Semantic code, unique within `source`. Attached as a readonly own property. */
  declare readonly code: C
  /** Optional lifecycle phase in which the failure happened. */
  declare readonly phase?: string
  /** Optional frozen diagnostic detail. */
  declare readonly detail?: Readonly<Record<string, unknown>>

  /** Frozen identity snapshot; the brand checked by `IdentifyError.is()`. */
  readonly #identity: IIdentifyErrorIdentity<S, C>
  /** Original cause exactly as supplied; kept privately so `clone()` survives `cause` edits. */
  readonly #cause: unknown
  /** Whether a cause was supplied at all, distinguishing `undefined` causes from none. */
  readonly #hasCause: boolean
  /** Native root error returned by `native()`; `this` when no cause was supplied. */
  readonly #native: Error

  /**
   * Creates an identified error. Throws a coded `TypeError` (`INVALID_ARGUMENT`) when `source` or
   * `code` is not a non-empty string, `phase` is not a string, or `detail` is not a plain record.
   *
   * @example
   *   ;```ts
   *   new IdentifyError({ source: '@app/x', code: 'BAD_INPUT', detail: { field: 'id' } })
   *   ```
   */
  constructor(identity: IIdentifyErrorIdentity<S, C>, options?: IIdentifyErrorOptions) {
    /** Validated identity, admitted before `super` so invalid input allocates no error. */
    const admitted = admitIdentity(identity)
    /** Whether the caller passed a `cause` key, even with an `undefined` value. */
    const hasCause = options !== undefined && 'cause' in options
    /** Original cause value; read once. */
    const cause = hasCause ? options?.cause : undefined
    super(
      options?.message ??
        (hasCause && cause !== undefined
          ? safeErrorReason(
              cause,
              UtilsErrorText.identifyErrorDefault(admitted.source, admitted.code)
            )
          : UtilsErrorText.identifyErrorDefault(admitted.source, admitted.code)),
      hasCause ? { cause } : undefined
    )
    this.#identity = admitted
    this.#cause = cause
    this.#hasCause = hasCause
    this.#native = !hasCause
      ? this
      : cause instanceof IdentifyError
        ? cause.native()
        : isNativeErrorValue(cause)
          ? cause
          : toError(cause)
    attachErrorIdentity(this, admitted)
  }

  /**
   * Wraps any thrown value. An `IdentifyError` that already has the same identity is returned as
   * is, so repeated boundary wrapping stays idempotent. Message defaults to the cause's message.
   *
   * @example
   *   ;```ts
   *   const error = IdentifyError.from(cause, { source: '@app/db', code: 'QUERY_FAILED' } as const)
   *   error.code // 'QUERY_FAILED'
   *   ```
   */
  static from<const S extends string, const C extends string>(
    error: unknown,
    identity: IIdentifyErrorIdentity<S, C>,
    options?: { readonly message?: string }
  ): IdentifyError<S, C> {
    if (
      IdentifyError.is(error) &&
      options?.message === undefined &&
      error.equal(identity) &&
      sameDetail(error.detail, identity.detail)
    )
      return error as IdentifyError<S, C>
    return new IdentifyError(identity, { message: options?.message, cause: error })
  }

  /**
   * Declares a package-scoped factory: one constructor per code key, plus `is`/`find` narrowed to
   * the source. Code keys `source`, `codes`, `is` and `find` are reserved.
   *
   * @example
   *   ;```ts
   *   const OrderError = IdentifyError.define('app.orders', { notFound: 'NOT_FOUND' })
   *   throw OrderError.notFound({ detail: { id } })
   *   if (OrderError.is(error, 'notFound')) retry()
   *   ```
   */
  static define<const S extends string, const M extends Readonly<Record<string, string>>>(
    source: S,
    codes: M
  ): IIdentifyErrorFactory<S, M> {
    return new IdentifyErrorFactoryOwner(source, codes, IdentifyError).create()
  }

  /**
   * Throws an `IdentifyError` when `condition` is falsy; narrows `condition` otherwise.
   *
   * @example
   *   ;```ts
   *   IdentifyError.assert(user, { source: '@app/auth', code: 'NO_USER' })
   *   user.id // narrowed
   *   ```
   */
  static assert(
    condition: unknown,
    identity: IIdentifyErrorIdentity,
    message?: string
  ): asserts condition {
    if (!condition) throw new IdentifyError(identity, { message })
  }

  /**
   * Returns a function with the same signature that converts synchronous throws and asynchronous
   * rejections into `IdentifyError.from(error, identity)`.
   *
   * @example
   *   ;```ts
   *   const load = IdentifyError.wrap(fetchUser, { source: '@app/users', code: 'LOAD_FAILED' })
   *   ```
   */
  static wrap<F extends (...args: never[]) => unknown>(fn: F, identity: IIdentifyErrorIdentity): F {
    if (typeof fn !== 'function') throw identityError('fn')
    return new IdentifyErrorWrapper(fn, admitIdentity(identity), IdentifyError).wrap()
  }

  /**
   * Brand check: `true` only for real `IdentifyError` instances (spoofed shapes fail). With a
   * match, also requires the identity fields to match.
   *
   * @example
   *   ;```ts
   *   if (IdentifyError.is(error, { code: 'NOT_FOUND' })) error.code
   *   ```
   */
  static is(value: unknown): value is IdentifyError
  static is<const S extends string = string, const C extends string = string>(
    value: unknown,
    match: { readonly source?: S; readonly code?: C; readonly phase?: string }
  ): value is IdentifyError<S, C>
  static is(value: unknown, match?: IErrorIdentityMatch): boolean {
    if (value === null || typeof value !== 'object' || !(#identity in value)) return false
    return match === undefined || matchesIdentity(value.#identity, match)
  }

  /**
   * Finds the first link of the cause / `AggregateError.errors` chain whose identity matches. Works
   * with any coded error, not only `IdentifyError` instances. The shared walk limits each path to
   * 32 edges by default and deduplicates visited identities; aggregate width is caller-sized, so
   * this search is O(reached identities + edges), never a constant-size-chain assumption.
   *
   * @example
   *   ;```ts
   *   const timeout = IdentifyError.find(error, {
   *     source: ERROR_SOURCE,
   *     code: 'DEADLINE_EXCEEDED'
   *   })
   *   ```
   */
  static find<const S extends string = string, const C extends string = string>(
    error: unknown,
    match: { readonly source?: S; readonly code?: C; readonly phase?: string }
  ): IIdentifiedError<S, C> | undefined {
    for (const link of walkErrorCauses(error))
      if (isNativeErrorValue(link) && matchesIdentity(IdentifyError.identityOf(link), match))
        return link as IIdentifiedError<S, C>
    return undefined
  }

  /**
   * Dispatches on the first chain link whose `code` has a handler. Falls back to `_`; without a
   * fallback the original value is rethrown unchanged.
   *
   * @example
   *   ;```ts
   *   const status = IdentifyError.match(error, { NOT_FOUND: () => 404, _: () => 500 })
   *   ```
   */
  static match<R>(
    error: unknown,
    cases: IIdentifyErrorCases<R>,
    options?: { readonly source?: string }
  ): R {
    for (const link of walkErrorCauses(error)) {
      /** Identity of the current link, or undefined for uncoded values. */
      const identity = IdentifyError.identityOf(link)
      if (!identity || (options?.source !== undefined && identity.source !== options.source))
        continue
      /** Handler registered for this code; own keys only, so `toString` etc. never match. */
      const handler = Object.hasOwn(cases, identity.code) ? cases[identity.code] : undefined
      if (typeof handler === 'function') return handler(link as IIdentifiedError)
    }
    if (typeof cases._ === 'function') return cases._(error)
    throw error
  }

  /**
   * Reads an identity from any value without throwing; returns `undefined` when `source` or `code`
   * is not a non-empty string.
   */
  static identityOf(value: unknown): IErrorIdentity | undefined {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
      return undefined
    if (IdentifyError.is(value)) return value.#identity
    /** Required identity fields, read through guarded property access. */
    const source = readString(value, 'source')
    /** Code follows the source read once, retaining the original hostile-getter order. */
    const code = readString(value, 'code')
    if (!source || !code) return undefined
    /** Optional phase, only kept when it is a string. */
    const phase = readString(value, 'phase')
    return Object.freeze({ source, code, ...(phase === undefined ? {} : { phase }) })
  }

  /** Combines zero, one or many failures; delegates to `combineErrors()`. */
  static combine(errors: Iterable<unknown>, message: string): Error | undefined {
    return combineErrors(errors, message)
  }

  /** Walks the cause / `AggregateError.errors` chain; delegates to `walkErrorCauses()`. */
  static walk(error: unknown, options?: { readonly maxDepth?: number }): readonly unknown[] {
    return walkErrorCauses(error, options)
  }

  /** Reads a diagnostic message safely; delegates to `safeErrorReason()`. */
  static reason(error: unknown, fallback: string): string {
    return safeErrorReason(error, fallback)
  }

  /** Serializes a whole error chain for a worker/RPC boundary; delegates to `serializeErrorChain()`. */
  static serialize(error: unknown, strategy?: IErrorChainStrategy): ISerializedErrorChain {
    return serializeErrorChain(error, strategy)
  }

  /** Restores a serialized chain; delegates to `deserializeErrorChain()`. */
  static deserialize(value: unknown, strategy?: IErrorChainStrategy): Error {
    return deserializeErrorChain(value, strategy)
  }

  /** Frozen identity snapshot of this error. */
  identity(): IIdentifyErrorIdentity<S, C> {
    return this.#identity
  }

  /**
   * Original native error: the root native error of the wrapped cause, a `NON_ERROR_VALUE` wrapper
   * when the cause was not an error, or `this` when no cause was supplied.
   */
  native(): Error {
    return this.#native
  }

  /** Every reachable link, starting with `this`; delegates to `walkErrorCauses()`. */
  causes(): readonly unknown[] {
    return walkErrorCauses(this)
  }

  /**
   * Whether any link matches, after the shared 32-edge-depth walk has snapshotted every reached
   * identity. Aggregate width is not bounded by depth; the scan remains O(reached identities).
   */
  has(match: IErrorIdentityMatch): boolean {
    for (const link of walkErrorCauses(this))
      if (matchesIdentity(IdentifyError.identityOf(link), match)) return true
    return false
  }

  /** Whether `other` carries the same `source`, `code` and `phase`. Never throws. */
  equal(other: unknown): boolean {
    /** Identity read from the other value, which may be any coded error or identity record. */
    const identity = IdentifyError.identityOf(other)
    return (
      identity !== undefined &&
      identity.source === this.#identity.source &&
      identity.code === this.#identity.code &&
      identity.phase === this.#identity.phase
    )
  }

  /** Field-by-field comparison with `other`; `detail` uses shallow own-key equality. */
  compare(other: unknown): IErrorIdentityComparison {
    /** Identity read from the other value; absent identity compares unequal on every field. */
    const identity = IdentifyError.identityOf(other)
    /** Other detail; only `IdentifyError` and plain identity records carry a readable detail. */
    const detail = IdentifyError.is(other)
      ? other.#identity.detail
      : isPlainRecord(other) && isPlainRecord(other.detail)
        ? other.detail
        : undefined
    return Object.freeze({
      source: identity?.source === this.#identity.source,
      code: identity?.code === this.#identity.code,
      phase: identity !== undefined && identity.phase === this.#identity.phase,
      detail: identity !== undefined && sameDetail(detail, this.#identity.detail)
    })
  }

  /** New instance with the same identity, message and cause (so `native()` is identical). */
  clone(): IdentifyError<S, C> {
    return this.#derive(this.#identity)
  }

  /**
   * Plain editable identity draft (fields widened to `string` so they can change); pass it back to
   * `IdentifyError.from(error.native(), draft)`.
   */
  mutable(): IMutableErrorIdentity {
    /** Fresh draft so caller edits never reach this instance. */
    const draft: IMutableErrorIdentity = {
      source: this.#identity.source,
      code: this.#identity.code
    }
    if (this.#identity.phase !== undefined) draft.phase = this.#identity.phase
    if (this.#identity.detail !== undefined) draft.detail = { ...this.#identity.detail }
    return draft
  }

  /** New instance with a different `phase`. */
  withPhase(phase: string): IdentifyError<S, C> {
    return this.#derive({ ...this.#identity, phase })
  }

  /** New instance whose `detail` is this detail shallow-merged with `detail`. */
  withDetail(detail: Readonly<Record<string, unknown>>): IdentifyError<S, C> {
    if (!isPlainRecord(detail)) throw identityError('detail')
    return this.#derive({ ...this.#identity, detail: { ...this.#identity.detail, ...detail } })
  }

  /**
   * New instance with the same identity whose `errors` is `[this, ...others]` (frozen) and whose
   * `cause` is `this`, so chain walkers reach every failure in order.
   */
  combine(...others: unknown[]): IdentifyError<S, C> {
    /** Combined error; native root stays the original native error through `cause = this`. */
    const combined = new IdentifyError(this.#identity, { message: this.message, cause: this })
    Object.defineProperty(combined, 'errors', {
      configurable: true,
      enumerable: false,
      value: Object.freeze([this, ...others]),
      writable: false
    })
    return combined
  }

  /**
   * Appends secondary failures (rollback, cleanup) to `errors` without changing identity. If this
   * instance was frozen by a caller, the identity-preserving `AggregateError` fallback is thrown
   * instead of being dropped.
   */
  attachSecondary(...errors: unknown[]): this {
    /** Result of the shared helper; anything but `this` means the instance rejected the write. */
    const result = attachSecondaryErrors(this, errors)
    if (result !== this) throw result
    return this
  }

  /** Serialized chain, so `JSON.stringify(error)` crosses realms without losing identity. */
  toJSON(): ISerializedErrorChain {
    return serializeErrorChain(this)
  }

  /** `[source:code] message`. */
  override toString(): string {
    return `[${this.#identity.source}:${this.#identity.code}] ${this.message}`
  }

  /** Builds a sibling instance with a new identity but the same message and original cause. */
  #derive(identity: IIdentifyErrorIdentity<S, C>): IdentifyError<S, C> {
    return new IdentifyError(
      identity,
      this.#hasCause ? { message: this.message, cause: this.#cause } : { message: this.message }
    )
  }
}

/** Construct the exported class without retaining its setup in applications that never use it. */
function initializeIdentifyError(): typeof IdentifyErrorConstructor {
  /** Runtime class and error names remain stable after the implementation binding is hidden. */
  const name = 'IdentifyError'
  Object.defineProperty(IdentifyErrorConstructor, 'name', { configurable: true, value: name })
  Object.defineProperty(IdentifyErrorConstructor.prototype, 'name', {
    configurable: false,
    enumerable: false,
    value: name,
    writable: false
  })
  Object.freeze(IdentifyErrorConstructor.prototype)
  Object.freeze(IdentifyErrorConstructor)
  return IdentifyErrorConstructor
}

/** Public constructor retains the original generic class and its immutable prototype contract. */
export const IdentifyError = /* @__PURE__ */ initializeIdentifyError()
/** Instance type shares the public constructor's exact private-state identity. */
export type IdentifyError<
  S extends string = string,
  C extends string = string
> = IdentifyErrorConstructor<S, C>
