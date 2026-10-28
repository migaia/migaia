/** Public error-chain entry: bounded send/receive construction and identity-limited reachability. */
import { ErrorChainSerializer } from './internal/error-chain-serialize.ts'
import { ErrorChainNormalizer } from './internal/error-chain-normalize.ts'
import { restore } from './internal/error-chain-restore.ts'
import { ErrorChainLimit, ErrorChainViolation } from './error-chain-constants.ts'
import {
  snapshotError,
  appendChildren,
  appendCleanupChildren
} from './internal/error-chain-snapshot.ts'
import { createViolation } from './internal/error-chain-violation.ts'
import type {
  IErrorChainStrategy,
  INormalizeErrorChainOptions,
  ISerializedErrorChain,
  ISerializeErrorChainOptions
} from './error-chain-types.ts'

export { sanitizeErrorText, countErrorDataText } from './internal/error-chain-text.ts'

/** Projects any thrown value into a bounded, frozen, language-neutral error tree. */
export function serializeErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: ISerializeErrorChainOptions = {}
): ISerializedErrorChain {
  return new ErrorChainSerializer(strategy, options).serialize(value)
}

/** One reachability invocation owns its reporting receiver and field-admission snapshot. */
class ErrorChainReachability {
  /** Boundary strategy is retained without creating package authority. */
  readonly #strategy: IErrorChainStrategy
  /** Caller owns every getter failure; absent reporting preserves the coded violation path. */
  readonly #options: ISerializeErrorChainOptions

  /** Capture one traversal's policies before any field is read. */
  constructor(strategy: IErrorChainStrategy, options: ISerializeErrorChainOptions) {
    this.#strategy = strategy
    this.#options = options
  }

  /** Retain the original error and location when reading a reachable node fails. */
  readonly #report = (pointer: string, field: string, error: unknown): void => {
    if (this.#options.report) this.#options.report({ pointer, field, error })
    else
      throw createViolation(this.#strategy, error, `${pointer}/${field}`, ErrorChainViolation.read)
  };

  /** Yield in the existing cause/aggregate/cleanup order with identity deduplication. */
  *walk(value: unknown): Generator<unknown> {
    /** Reachability has an identity budget independent from serialized tree depth and occurrences. */
    const maxObjects = this.#strategy.limits?.maxObjects ?? ErrorChainLimit.maxObjects
    /** LIFO work preserves cause, errors, then cleanup order. */
    const pending: { value: unknown; pointer: string }[] = [{ value, pointer: '' }]
    /** Object identities are yielded at most once; primitive occurrences are still observable. */
    const seen = new Set<object>()
    while (pending.length > 0) {
      /** LIFO work preserves cause-first order without recursion or the serialized depth limit. */
      const current = pending.pop()!
      if (
        (typeof current.value !== 'object' || current.value === null) &&
        typeof current.value !== 'function'
      ) {
        yield current.value
        continue
      }
      if (seen.has(current.value)) continue
      if (seen.size >= maxObjects) return
      seen.add(current.value)
      yield current.value
      /**
       * Arrays never supply named error fields; classification failures follow the caller report
       * policy.
       */
      let array = false
      try {
        array = Array.isArray(current.value)
      } catch (error) {
        this.#report(current.pointer, 'data', error)
      }
      if (array) continue
      /** Hold the one-read field snapshot while classifying and traversing this exact input object. */
      const source = snapshotError(
        current.value,
        current.pointer,
        this.#report,
        false,
        this.#strategy
      )
      /** Collect cause, aggregate entries, and cleanup failures in their observable order. */
      const children: unknown[] = []
      if (source.fields.cause !== undefined) children.push(source.fields.cause)
      appendChildren(
        source.fields.errors,
        current.pointer,
        'errors',
        children,
        this.#report,
        maxObjects
      )
      appendCleanupChildren(
        source.fields.cleanupErrors,
        current.pointer,
        children,
        this.#report,
        maxObjects
      )
      for (let index = children.length - 1; index >= 0; index -= 1)
        pending.push({ value: children[index], pointer: `${current.pointer}/errors/${index}` })
    }
  }
}

/** Walk the same graph edges without the wire depth limit, deduplicating object identities. */
export function* reachErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: ISerializeErrorChainOptions = {}
): Generator<unknown> {
  yield* new ErrorChainReachability(strategy, options).walk(value)
}

/** Validate and freeze a fresh wire error tree before any receiver uses its fields. */
export function normalizeSerializedErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: INormalizeErrorChainOptions = {}
): ISerializedErrorChain {
  return new ErrorChainNormalizer(value, strategy, options).normalize()
}

/** Rebuild a native error graph after validating the entire untrusted tree. */
export function deserializeErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: INormalizeErrorChainOptions = {}
): Error {
  /** Validate the entire received tree before allocating any restored error objects. */
  const normalized = normalizeSerializedErrorChain(value, strategy, options)
  return restore(normalized, strategy)
}
