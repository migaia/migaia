/**
 * Own package factory construction and wrapped-call state; public errors retain their original
 * constructor.
 */
import type {
  IdentifyError,
  IIdentifyErrorIdentity,
  IIdentifyErrorFactory,
  IIdentifyErrorFactoryOptions
} from '../identify-error.ts'
import { identityError, isPlainRecord } from './identify-error-admission.ts'

/** Factory names that would shadow factory helpers. */
const reservedFactoryKeys = new Set<string>(['source', 'codes', 'is', 'find'])

/** One package factory owns its immutable source and copied code table. */
export class IdentifyErrorFactoryOwner<
  S extends string,
  M extends Readonly<Record<string, string>>
> {
  /** The source snapshot is shared by every constructor of this factory. */
  readonly #source: S
  /** A frozen shallow copy isolates later mutation of the caller's code table. */
  readonly #table: Readonly<M>
  /** The canonical public constructor provides branding and chain search. */
  readonly #errorConstructor: typeof IdentifyError

  /** Validate source and table before exposing any callable factory member. */
  constructor(source: S, codes: M, constructor: typeof IdentifyError) {
    if (typeof source !== 'string' || source.length === 0) throw identityError('source')
    if (!isPlainRecord(codes)) throw identityError('codes')
    this.#source = source
    this.#table = Object.freeze({ ...codes }) as Readonly<M>
    this.#errorConstructor = constructor
  }

  /** Build the original own-property shape and freeze it after all code keys pass admission. */
  create(): IIdentifyErrorFactory<S, M> {
    /** Factory members remain own closures, so destructuring never changes their receiver. */
    const factory: Record<string, unknown> = {
      source: this.#source,
      codes: this.#table,
      is: (value: unknown, key?: string) => this.#is(value, key),
      find: (error: unknown, key?: string) => this.#find(error, key)
    }
    for (const [key, code] of Object.entries(this.#table)) {
      if (reservedFactoryKeys.has(key)) throw identityError(`codes.${key}`)
      if (typeof code !== 'string' || code.length === 0) throw identityError(`codes.${key}`)
      factory[key] = this.#createCode(code)
    }
    return Object.freeze(factory) as IIdentifyErrorFactory<S, M>
  }

  /** Retain factory key admission before invoking the canonical brand predicate. */
  #is(value: unknown, key?: string): boolean {
    return (
      (key === undefined || Object.hasOwn(this.#table, key)) &&
      this.#errorConstructor.is(value, {
        source: this.#source,
        code: key === undefined ? undefined : this.#table[key]
      })
    )
  }

  /** Search only a valid code key while retaining the original narrowed source. */
  #find(error: unknown, key?: string): unknown {
    return key === undefined || Object.hasOwn(this.#table, key)
      ? this.#errorConstructor.find(error, {
          source: this.#source,
          code: key === undefined ? undefined : this.#table[key]
        })
      : undefined
  }

  /** Capture one immutable code; option reads remain in the original construction order. */
  #createCode(code: string): (options?: IIdentifyErrorFactoryOptions) => IdentifyError {
    return (options) =>
      new this.#errorConstructor(
        { source: this.#source, code, phase: options?.phase, detail: options?.detail },
        options && 'cause' in options
          ? { message: options.message, cause: options.cause }
          : { message: options?.message }
      )
  }
}

/** A wrapped function owns one admitted identity and a reusable rejection continuation. */
export class IdentifyErrorWrapper<F extends (...args: never[]) => unknown> {
  /** Call the original function without a receiver and preserve its parameter inference. */
  readonly #operation: F
  /** Identity is admitted once before the public wrapper is returned. */
  readonly #identity: IIdentifyErrorIdentity
  /** Preserve canonical wrapping, including its same-identity idempotency. */
  readonly #errorConstructor: typeof IdentifyError

  /** Capture the operation and admitted identity; no invocation happens during construction. */
  constructor(operation: F, identity: IIdentifyErrorIdentity, constructor: typeof IdentifyError) {
    this.#operation = operation
    this.#identity = identity
    this.#errorConstructor = constructor
  }

  /** Expose the original anonymous rest-argument function shape with an explicit state owner. */
  wrap(): F {
    return ((...args: Parameters<F>) => this.#invoke(args)) as F
  }

  /**
   * Convert only operation throws and observed rejections; then getter failures still escape
   * unchanged.
   */
  #invoke(args: Parameters<F>): unknown {
    /** Result may be synchronous or thenable, matching the original one-read dispatch behavior. */
    let result: unknown
    try {
      result = Reflect.apply(this.#operation, undefined, args)
    } catch (error) {
      throw this.#errorConstructor.from(error, this.#identity)
    }
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as { then?: unknown }).then === 'function'
    )
      return Promise.resolve(result as PromiseLike<unknown>).then(undefined, (error: unknown) =>
        this.#onRejected(error)
      )
    return result
  }

  /** Reject with the identified wrapper while retaining the exact original failure as cause. */
  #onRejected(error: unknown): never {
    throw this.#errorConstructor.from(error, this.#identity)
  }
}
