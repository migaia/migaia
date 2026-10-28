/**
 * Normalize finite plain data into frozen snapshots with invocation-owned cycle and occurrence
 * budgets.
 */
import { tryReadProperty } from './error-primitives.ts'
import { ErrorChainViolation } from '../error-chain-constants.ts'
import type { IErrorChainData, IErrorChainLimits } from '../error-chain-types.ts'
import { createViolation } from './error-chain-violation.ts'
import { escapePointer } from './error-chain-text.ts'

/**
 * Snapshot plain finite JSON data into fresh frozen arrays and null-prototype records. Functions,
 * symbols, class instances, cycles, and exceeded tree limits are rejected rather than silently lost
 * by JSON. Getter failures retain their exact value as the coded violation cause.
 */
/** Snapshot one plain-data tree with explicit cycle and occurrence ownership. */
export class PlainDataNormalizer {
  /** Active ancestors reject cycles while repeated shared values count as distinct occurrences. */
  #active = new Set<object>()
  /** Every admitted scalar/container consumes the configured occurrence budget. */
  #nodes = 0
  /** The enclosing error projection supplies its original limits without another policy. */
  #limits: IErrorChainLimits
  /** Capture the existing projection policy before any input getter executes. */
  constructor(limits: IErrorChainLimits) {
    this.#limits = limits
  }
  /** Retain the original root pointer and nesting offset of this plain-data projection. */
  normalize(value: unknown, depth: number): IErrorChainData {
    return this.#visit(value, '', depth + 1)
  }
  /** Reject at the original pointer while retaining the offending value or getter failure. */
  #invalid(input: unknown, pointer: string, violation: ErrorChainViolation): never {
    throw createViolation({}, input, pointer, violation)
  }
  /** Read each admitted property once and retain its exact thrown cause. */
  #read(target: object, key: string | number, path: string): unknown {
    /** A fresh output retains the fixed property order and cannot inherit source object behavior. */
    const result = tryReadProperty(target as Record<string | number, unknown>, key)
    if (result.threw) this.#invalid(result.error, path, ErrorChainViolation.read)
    return result.value
  }
  /** Walk plain shapes in their original property order with one active-path owner. */
  #visit(input: unknown, pointer: string, nesting: number): IErrorChainData {
    if (++this.#nodes > this.#limits.maxNodes)
      this.#invalid(input, pointer, ErrorChainViolation.nodes)
    if (nesting > this.#limits.maxNesting - 1)
      this.#invalid(input, pointer, ErrorChainViolation.depth)
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) this.#invalid(input, pointer, ErrorChainViolation.type)
      return input
    }
    if (typeof input !== 'object') this.#invalid(input, pointer, ErrorChainViolation.type)
    if (this.#active.has(input)) this.#invalid(input, pointer, ErrorChainViolation.type)
    this.#active.add(input)
    /** Read failures occur before children and retain their original exception identity. */
    let array: boolean
    /** Hold the enumerated own keys so no property is rediscovered while getters execute. */
    let keys: string[]
    try {
      array = Array.isArray(input)
      keys = array ? [] : Object.keys(input)
    } catch (error) {
      this.#invalid(error, pointer, ErrorChainViolation.read)
    }
    /**
     * JSON admits only plain records and string-owned properties; no class serialization is
     * inferred.
     */
    if (
      !array &&
      Object.getPrototypeOf(input) !== null &&
      Object.getPrototypeOf(input) !== Object.prototype
    )
      this.#invalid(input, pointer, ErrorChainViolation.type)
    if (Object.getOwnPropertySymbols(input).length > 0)
      this.#invalid(input, pointer, ErrorChainViolation.type)
    /** Require a successful one-read snapshot before visiting a child. */

    if (array) {
      /** Array length is held before iteration so getter side effects cannot change traversal shape. */
      const length = this.#read(input, 'length', `${pointer}/length`) as number
      /**
       * Dense output rejects unsupported undefined and sparse entries instead of converting to
       * null.
       */
      const result: IErrorChainData[] = []
      for (let index = 0; index < length; index += 1) {
        /** Keep each dense data entry associated with its original pointer while reading it once. */
        const path = `${pointer}/${index}`
        result.push(this.#visit(this.#read(input, index, path), path, nesting + 1))
      }
      this.#active.delete(input)
      return Object.freeze(result)
    }
    /** Null prototypes keep received `__proto__` and `constructor` keys as inert data. */
    const result: Record<string, IErrorChainData> = Object.create(null) as Record<
      string,
      IErrorChainData
    >
    for (const key of keys) {
      /** Keys are escaped only for diagnostics; their stored bytes remain unchanged. */
      const path = `${pointer}/${escapePointer(key)}`
      result[key] = this.#visit(this.#read(input, key, path), path, nesting + 1)
    }
    this.#active.delete(input)
    return Object.freeze(result)
  }
}
