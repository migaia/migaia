/**
 * Own strict receive grammar validation, first-error order, budgets and immutable wire-tree
 * normalization.
 */
import { tryReadProperty } from './error-primitives.ts'
import {
  ErrorChainField,
  ErrorChainFieldSet,
  ErrorChainRequiredFieldSet,
  ErrorChainLimit,
  ErrorChainUnknownFields,
  ErrorChainViolation
} from '../error-chain-constants.ts'
import type {
  IErrorChainData,
  IErrorChainLimits,
  IErrorChainStrategy,
  INormalizeErrorChainOptions,
  ISerializedErrorChain
} from '../error-chain-types.ts'
import type { IWireNode } from './error-chain-state.ts'
import { orderCodePointKeys } from './string-order.ts'
import { PlainDataNormalizer } from './error-chain-data.ts'
import { countErrorDataText, isWellFormed, utf8Bytes } from './error-chain-text.ts'
import { createViolation } from './error-chain-violation.ts'

/** One receive validation owns its canonical grammar, first-error order and occurrence budgets. */
export class ErrorChainNormalizer {
  /** The original input remains the default reachable cause for grammar failures. */
  #value: unknown
  /** Caller-selected boundary codecs retain their original receiver. */
  #strategy: IErrorChainStrategy
  /** Receive reporting options remain attached to this invocation. */
  #options: INormalizeErrorChainOptions
  /** Resolved receive limits are isolated from reentrant normalizations. */
  #limits: IErrorChainLimits
  /** Whitelist order determines which input field fails first. */
  #fieldOrder: readonly string[]
  /** Occurrences and portable text debit this one tree budget. */
  #budget = { nodes: 0, bytes: 0 }
  /** Active ancestors distinguish cycles from shared subtrees. */
  #active = new Set<object>()
  /** Unknown-field handling is captured before input traversal. */
  #unknownFields: (typeof ErrorChainUnknownFields)[keyof typeof ErrorChainUnknownFields]

  /** Resolve receive policy before any untrusted field is read. */
  constructor(value: unknown, strategy: IErrorChainStrategy, options: INormalizeErrorChainOptions) {
    this.#value = value
    this.#limits = { ...ErrorChainLimit, ...strategy.limits }
    this.#fieldOrder = strategy.fields ?? ErrorChainField
    this.#strategy = strategy
    this.#options = options
    this.#unknownFields = options.unknownFields ?? ErrorChainUnknownFields.reject
  }

  /** Decode portable boundary data independently of the error-tree grammar. */
  #normalizeData(input: unknown, depth: number): IErrorChainData {
    return this.#strategy.normalizeData
      ? this.#strategy.normalizeData(input, depth)
      : new PlainDataNormalizer(this.#limits).normalize(input, depth)
  }

  /** Normalize the original root after policy has been captured. */
  normalize(): ISerializedErrorChain {
    return this.#visit(this.#value, '', 0)
  }

  /** Raise the first wire violation with a reachable original input. */
  #invalid(pointer: string, violation: ErrorChainViolation, cause: unknown = this.#value): never {
    throw createViolation(this.#strategy, cause, pointer, violation)
  }

  /** Keep all mandatory property reads on the same wire-error path. */
  #readOrInvalid<T extends object, K extends keyof T>(target: T, key: K, pointer: string): T[K] {
    /** Read once with the original receiver; keep a thrown getter value reachable through reporting. */
    const read = tryReadProperty(target, key)
    if (read.threw) this.#invalid(pointer, ErrorChainViolation.read, read.error)
    return read.value
  }

  /** Check one well-formed UTF-8 text unit and optionally debit the payload budget. */
  #countText(unit: string, pointer: string, debit = true): number {
    if (!isWellFormed(unit)) this.#invalid(pointer, ErrorChainViolation.surrogate)
    /** The scalar-safe UTF-8 width is checked before debiting the relevant text budget. */
    const size = utf8Bytes(unit)
    if (size > this.#limits.maxStringBytes) this.#invalid(pointer, ErrorChainViolation.stringBytes)
    if (debit) this.#budget.bytes += size
    if (debit && this.#budget.bytes > this.#limits.maxBytes)
      this.#invalid(pointer, ErrorChainViolation.totalBytes)
    return size
  }

  /** Count normalized portable text with one explicit subtotal for this data field. */
  #countData(data: IErrorChainData, pointer: string): void {
    this.#budget.bytes += countErrorDataText(
      data,
      pointer,
      (text, path) => this.#countText(text, path, false),
      this.#limits.maxStringBytes,
      (path) => this.#invalid(path, ErrorChainViolation.dataBytes),
      this.#strategy.dataTextLeaf
    )
    if (this.#budget.bytes > this.#limits.maxBytes)
      this.#invalid(pointer, ErrorChainViolation.totalBytes)
  }

  /** Read and validate one node's own fields once before decoding any descendants. */
  #readFields(input: object, pointer: string): Record<string, unknown> {
    /** Own fields are enumerated once, then read once in canonical field order. */
    let keys: string[]
    try {
      keys = Object.keys(input)
    } catch (error) {
      this.#invalid(pointer, ErrorChainViolation.read, error)
    }
    /** The strategy whitelist defines accepted own fields before any receiver getter is read. */
    const known =
      this.#fieldOrder === ErrorChainField ? ErrorChainFieldSet : new Set(this.#fieldOrder)
    /** Collect unknown keys once before the existing code-point order and reporting policy. */
    const unknown: string[] = []
    for (const key of keys) if (!known.has(key)) unknown.push(key)
    for (const key of unknown.length > 1 ? orderCodePointKeys(unknown) : unknown) {
      if (this.#unknownFields === ErrorChainUnknownFields.reject)
        this.#invalid(pointer, ErrorChainViolation.unknownField)
      this.#options.onUnknownField?.(pointer, key)
    }
    /** Membership borrows the same original enumeration without rescanning it per strategy field. */
    const present = new Set(keys)
    /** Read each present property once, including optional properties. */
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [index, key] of this.#fieldOrder.entries()) {
      if (!present.has(key)) {
        if (index < 5) this.#invalid(`${pointer}/${key}`, ErrorChainViolation.required)
        continue
      }
      fields[key] = this.#readOrInvalid(input as Record<string, unknown>, key, `${pointer}/${key}`)
      if (ErrorChainRequiredFieldSet.has(key)) {
        /**
         * Validate this held field once, preserving first-error order and mandatory text
         * requirements.
         */
        const field = fields[key]
        if (typeof field !== 'string' || (key !== 'message' && field.length === 0))
          this.#invalid(`${pointer}/${key}`, ErrorChainViolation.type)
        this.#countText(field, `${pointer}/${key}`)
      }
    }
    return fields
  }

  /** Snapshot one node in the documented first-error order. */
  #visit(input: unknown, pointer: string, depth: number): ISerializedErrorChain {
    this.#budget.nodes += 1
    if (this.#budget.nodes > this.#limits.maxNodes)
      this.#invalid(pointer, ErrorChainViolation.nodes)
    if (depth > this.#limits.maxNesting - 1) this.#invalid(pointer, ErrorChainViolation.depth)
    /**
     * Arrays never supply named error fields; classification failures follow the caller report
     * policy.
     */
    let array = false
    try {
      array = Array.isArray(input)
    } catch (error) {
      this.#invalid(pointer, ErrorChainViolation.read, error)
    }
    if (typeof input !== 'object' || input === null || array)
      this.#invalid(pointer, ErrorChainViolation.type)
    if (this.#active.has(input)) this.#invalid(pointer, ErrorChainViolation.type)
    this.#active.add(input)
    /** Field enumeration and validation retain the original deterministic first-error order. */
    const fields = this.#readFields(input, pointer)
    /** A fresh output retains the fixed property order and cannot inherit source object behavior. */
    const result: IWireNode = {
      source: fields.source as string,
      code: fields.code as string,
      name: fields.name as string,
      message: fields.message as string,
      stack: fields.stack as string
    }
    if (Object.hasOwn(fields, 'cause')) {
      /** Cause must be an error node, never an array even when it has named error fields. */
      let causeArray = false
      try {
        causeArray = Array.isArray(fields.cause)
      } catch (error) {
        this.#invalid(`${pointer}/cause`, ErrorChainViolation.read, error)
      }
      if (typeof fields.cause !== 'object' || fields.cause === null || causeArray)
        this.#invalid(`${pointer}/cause`, ErrorChainViolation.type)
    }
    /** Snapshot aggregate length once before validating any entries. */
    let errorsLength = 0
    if (Object.hasOwn(fields, 'errors')) {
      /** Only an actual array supplies aggregate children across the receiving boundary. */
      let errorsArray = false
      try {
        errorsArray = Array.isArray(fields.errors)
      } catch (error) {
        this.#invalid(`${pointer}/errors`, ErrorChainViolation.read, error)
      }
      if (!errorsArray) this.#invalid(`${pointer}/errors`, ErrorChainViolation.type)
      errorsLength = this.#readOrInvalid(
        fields.errors as unknown[],
        'length',
        `${pointer}/errors/length`
      )
      if (errorsLength === 0) this.#invalid(`${pointer}/errors`, ErrorChainViolation.emptyErrors)
    }
    if (Object.hasOwn(fields, 'data')) {
      try {
        result.data = this.#normalizeData(fields.data, depth)
      } catch (error) {
        this.#invalid(`${pointer}/data`, ErrorChainViolation.dataPortable, error)
      }
      this.#countData(result.data, `${pointer}/data`)
    }
    if (Object.hasOwn(fields, 'truncated')) {
      if (fields.truncated !== true)
        this.#invalid(`${pointer}/truncated`, ErrorChainViolation.truncatedValue)
      result.truncated = true
    }
    for (const extension of this.#strategy.extensions ?? []) {
      if (!Object.hasOwn(fields, extension.field)) continue
      /** Boundary extension normalization keeps its own public failure semantics. */
      const projected = extension.normalize(
        fields[extension.field],
        `${pointer}/${extension.field}`
      )
      this.#budget.bytes += projected.bytes
      if (this.#budget.bytes > this.#limits.maxBytes)
        this.#invalid(`${pointer}/${extension.field}`, ErrorChainViolation.totalBytes)
      Object.defineProperty(result, extension.field, {
        value: projected.value,
        configurable: true,
        enumerable: true,
        writable: true
      })
    }
    if (Object.hasOwn(fields, 'cause'))
      result.cause = this.#visit(fields.cause, `${pointer}/cause`, depth + 1)
    if (Object.hasOwn(fields, 'errors')) {
      /** An errors edge adds both the array and entry depth. */
      const children = fields.errors as unknown[]
      /** Freeze the admitted receiver children after every entry passes the same tree grammar. */
      const normalized: ISerializedErrorChain[] = []
      for (let index = 0; index < errorsLength; index += 1) {
        /**
         * Errors edges account for array and entry nesting while retaining the exact entry
         * location.
         */
        const childPointer = `${pointer}/errors/${index}`
        normalized.push(
          this.#visit(this.#readOrInvalid(children, index, childPointer), childPointer, depth + 2)
        )
      }
      result.errors = Object.freeze(normalized)
    }
    this.#active.delete(input)
    return Object.freeze(result)
  }
}
