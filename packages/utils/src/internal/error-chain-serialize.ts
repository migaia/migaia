/**
 * Own one bounded error serialization: field snapshots, text budgets, graph occurrence order and
 * frozen output.
 */
import { tryReadProperty } from './error-primitives.ts'
import {
  ErrorChainFallback,
  ErrorChainField,
  ErrorChainRequiredField,
  ErrorChainLimit,
  ErrorChainViolation
} from '../error-chain-constants.ts'
import type {
  IErrorChainData,
  IErrorChainLimits,
  IErrorChainStrategy,
  IErrorChainText,
  ISerializedErrorChain,
  ISerializeErrorChainOptions
} from '../error-chain-types.ts'
import type { IErrorNodeProjection, IWireNode } from './error-chain-state.ts'
import { snapshotError, appendChildren, appendCleanupChildren } from './error-chain-snapshot.ts'
import { PlainDataNormalizer } from './error-chain-data.ts'
import { sanitizeData, sanitizeErrorText } from './error-chain-text.ts'
import { createViolation } from './error-chain-violation.ts'

/** One serialization owns its budgets and active ancestors, including reentrant getter calls. */
export class ErrorChainSerializer {
  /** Caller policy is retained for presentation, normalization and error classification. */
  #strategy: IErrorChainStrategy
  /** Reporting remains local to this invocation. */
  #options: ISerializeErrorChainOptions
  /** Resolved limits isolate this serialization from concurrent invocations. */
  #limits: IErrorChainLimits
  /** Presentation fallback never supplies local package authority. */
  #fallback: { [K in keyof typeof ErrorChainFallback]: string }
  /** Excluded optional fields are never traversed. */
  #admitted: Set<string>
  /** Active ancestors reject cycles while allowing shared descendant occurrences. */
  #active = new Set<object>()
  /** Occurrence and text budgets are debited in output order. */
  #budget = { nodes: 0, bytes: 0 }

  /** Resolve per-invocation policy before touching input fields. */
  constructor(strategy: IErrorChainStrategy, options: ISerializeErrorChainOptions) {
    this.#limits = { ...ErrorChainLimit, ...strategy.limits }
    this.#fallback = { ...ErrorChainFallback, ...strategy.fallback }
    this.#admitted = new Set<string>(strategy.fields ?? ErrorChainField)
    this.#strategy = strategy
    this.#options = options
  }

  /** The caller's privacy transform retains its original call timing and receiver. */
  #sanitize = (text: string, truncate = true): IErrorChainText =>
    this.#strategy.sanitizeText?.(text, truncate) ??
    sanitizeErrorText(text, this.#limits.maxStringBytes, truncate)

  /** Boundary conversion remains outside the generic error graph grammar. */
  #normalizeData(input: unknown, depth: number): IErrorChainData {
    return this.#strategy.normalizeData
      ? this.#strategy.normalizeData(input, depth)
      : new PlainDataNormalizer(this.#limits).normalize(input, depth)
  }

  /** Project one root after construction has isolated all policy and budget state. */
  serialize(value: unknown): ISerializedErrorChain {
    return this.#visit(value, '', 0)!
  }

  /** Report a caught input failure exactly once, preserving the thrown value. */
  #report = (
    pointer: string,
    field: string,
    error: unknown,
    violation: ErrorChainViolation = ErrorChainViolation.read
  ): void => {
    if (this.#options.report) this.#options.report({ pointer, field, error })
    else throw createViolation(this.#strategy, error, `${pointer}/${field}`, violation)
  }

  /** Try a portable data projection and its separate byte budget. */
  #projectData(raw: unknown, pointer: string, node: IWireNode, depth: number): void {
    if (raw === undefined) return
    /** The selected data codec snapshots input before any sanitization or text budgeting. */
    let portable: IErrorChainData
    try {
      portable = this.#normalizeData(raw, depth)
    } catch (error) {
      node.truncated = true
      this.#report(pointer, 'data', error, ErrorChainViolation.dataPortable)
      return
    }
    /** Sanitization also detects key collisions introduced by replacement. */
    const sanitized = sanitizeData(portable, this.#sanitize, this.#strategy)
    if (sanitized === undefined) {
      node.truncated = true
      return
    }
    if (sanitized.replaced) node.truncated = true
    if (
      sanitized.bytes > this.#limits.maxStringBytes ||
      this.#budget.bytes + sanitized.bytes > this.#limits.maxBytes
    ) {
      node.truncated = true
      return
    }
    this.#budget.bytes += sanitized.bytes
    node.data = sanitized.value
  }

  /** Snapshot one input and select diagnostic presentation without traversing graph descendants. */
  #snapshot(input: unknown, pointer: string): IErrorNodeProjection {
    /** Primitives and arrays do not expose named error fields. */
    const object = (typeof input === 'object' && input !== null) || typeof input === 'function'
    /**
     * Arrays never supply named error fields; classification failures follow the caller report
     * policy.
     */
    let array = false
    /** A trapped brand check marks output incomplete without changing the original exception. */
    let classificationFailed = false
    if (object) {
      try {
        array = Array.isArray(input)
      } catch (error) {
        classificationFailed = true
        this.#report(pointer, 'data', error)
      }
    }
    /** Exact held Error references select presentation; a wire property cannot supply this policy. */
    const localSummary = this.#strategy.presentation?.(input)
    /** Opt-in applies to this exact local node; each descendant makes its own secrecy decision. */
    const summaryOnly = localSummary !== undefined && localSummary.preserveSerializedError !== true
    /** Hold the one-read field snapshot while classifying and traversing this exact input object. */
    const source =
      object && !array
        ? snapshotError(input, pointer, this.#report, summaryOnly, this.#strategy)
        : undefined
    /** Native errors remain error-like even when a diagnostic field getter is missing or malformed. */
    let nativeError = false
    if (source) {
      try {
        nativeError = input instanceof Error
      } catch (error) {
        classificationFailed = true
        this.#report(pointer, 'name', error)
      }
    }
    /**
     * Only native errors or complete cross-realm diagnostic shapes expose graph edges as error
     * chains.
     */
    const errorLike =
      source !== undefined &&
      (nativeError ||
        (typeof source.fields.name === 'string' &&
          typeof source.fields.message === 'string' &&
          typeof source.fields.stack === 'string'))
    /** An exact-object presentation overrides message text before scalar sanitization. */
    const message =
      localSummary?.message ??
      (errorLike
        ? typeof source.fields.message === 'string'
          ? source.fields.message
          : ''
        : typeof input === 'string'
          ? input
          : this.#fallback.nonErrorMessage)
    /** Retain the incoming diagnostic name; unclassified values use the fallback native error name. */
    const name =
      errorLike && typeof source.fields.name === 'string' && source.fields.name.length > 0
        ? source.fields.name
        : this.#fallback.name
    /** Property insertion order is stable: own diagnostic fields precede data and graph descendants. */
    const node: IWireNode = {
      source:
        errorLike && typeof source.fields.source === 'string' && source.fields.source.length > 0
          ? source.fields.source
          : this.#fallback.source,
      code:
        localSummary?.code ??
        (errorLike && typeof source.fields.code === 'string' && source.fields.code.length > 0
          ? source.fields.code
          : this.#fallback.code),
      name,
      message,
      stack:
        errorLike && typeof source.fields.stack === 'string' && source.fields.stack.length > 0
          ? source.fields.stack
          : `${name}: ${message}`
    }
    if (classificationFailed || source?.truncated || source?.fields.truncated === true)
      node.truncated = true
    return { node, source, errorLike, summaryOnly }
  }

  /** Admit a node only after its own five fields fit the remaining total budget. */
  #visit(input: unknown, pointer: string, depth: number): ISerializedErrorChain | undefined {
    if (depth > this.#limits.maxNesting - 1 || this.#budget.nodes >= this.#limits.maxNodes)
      return undefined
    if ((typeof input === 'object' && input !== null) || typeof input === 'function') {
      if (this.#active.has(input)) return undefined
      this.#active.add(input)
    }
    /** Classification snapshots fields once before debiting text or following descendants. */
    const { node, source, errorLike, summaryOnly } = this.#snapshot(input, pointer)
    /** Active object identities are released after their complete output occurrence. */
    const object = (typeof input === 'object' && input !== null) || typeof input === 'function'
    /** Own text is accepted before data and descendants. */
    let ownBytes = 0
    // Only the five fixed diagnostic fields in ErrorChainRequiredField are charged here.
    for (const key of ErrorChainRequiredField) {
      /**
       * The text strategy reports both replacement and UTF-8 size without modifying the original
       * input.
       */
      const text = this.#sanitize(node[key] as string)
      node[key] = text.value
      ownBytes += text.bytes
      if (text.changed) node.truncated = true
    }
    if (depth > 0 && this.#budget.bytes + ownBytes > this.#limits.maxBytes) {
      if (object) this.#active.delete(input)
      return undefined
    }
    if (depth === 0 && ownBytes > this.#limits.maxBytes)
      throw createViolation(this.#strategy, input, pointer, ErrorChainViolation.totalBytes)
    this.#budget.bytes += ownBytes
    this.#budget.nodes += 1

    /** Exact-object presentation may hide all secret-bearing descendants of this node. */
    if (errorLike && !summaryOnly) {
      if (this.#admitted.has('data')) this.#projectData(source!.fields.data, pointer, node, depth)
      for (const extension of this.#strategy.extensions ?? []) {
        if (!this.#admitted.has(extension.field)) continue
        if (source!.fields[extension.field] === undefined) continue
        try {
          /** Extension grammars own their field shape and contribute to the shared text budget. */
          const projected = extension.normalize(
            source!.fields[extension.field],
            `${pointer}/${extension.field}`
          )
          if (this.#budget.bytes + projected.bytes > this.#limits.maxBytes) node.truncated = true
          else {
            Object.defineProperty(node, extension.field, {
              value: projected.value,
              configurable: true,
              enumerable: true,
              writable: true
            })
            this.#budget.bytes += projected.bytes
          }
        } catch (error) {
          node.truncated = true
          this.#report(pointer, extension.field, error)
        }
      }
      if (this.#admitted.has('cause') && source!.fields.cause !== undefined) {
        /** Cause edges add one nesting level and are admitted before aggregate children. */
        const cause = this.#visit(source!.fields.cause, `${pointer}/cause`, depth + 1)
        if (cause) node.cause = cause
        else node.truncated = true
      }
      /** Errors keep a prefix when a child cannot be admitted. */
      const children: unknown[] = []
      if (
        this.#admitted.has('errors') &&
        appendChildren(
          source!.fields.errors,
          pointer,
          'errors',
          children,
          this.#report,
          this.#limits.maxObjects
        )
      )
        node.truncated = true
      if (
        this.#admitted.has('errors') &&
        appendCleanupChildren(
          source!.fields.cleanupErrors,
          pointer,
          children,
          this.#report,
          this.#limits.maxObjects
        )
      )
        node.truncated = true
      /** Keep the admitted aggregate prefix when the first child exceeds the remaining tree budget. */
      const output: ISerializedErrorChain[] = []
      for (let index = 0; index < children.length; index += 1) {
        /** Each child occurrence is projected independently; only active ancestors count as cycles. */
        const child = this.#visit(children[index], `${pointer}/errors/${index}`, depth + 2)
        if (!child) {
          node.truncated = true
          break
        }
        output.push(child)
      }
      if (output.length > 0) node.errors = Object.freeze(output)
    } else if (
      this.#admitted.has('data') &&
      !summaryOnly &&
      input !== undefined &&
      typeof input !== 'string'
    ) {
      if (source) {
        /** Hold the enumerated own keys so no property is rediscovered while getters execute. */
        let keys: string[]
        /** An enumeration failure prevents projecting a misleading partial arbitrary-value record. */
        let enumerated = true
        try {
          keys = Object.keys(input as object)
        } catch (error) {
          enumerated = false
          node.truncated = true
          this.#report(pointer, 'data', error)
          keys = []
        }
        /** Fresh null-prototype data records keep source keys inert and preserve insertion order. */
        const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>
        for (const key of keys) {
          if (source.failed.has(key)) continue
          if (Object.hasOwn(source.fields, key)) record[key] = source.fields[key]
          else {
            /** Keep data-field reporting at the existing serialization boundary. */
            const read = tryReadProperty(input as Record<string, unknown>, key)
            if (read.threw) {
              node.truncated = true
              this.#report(pointer, key, read.error)
            } else record[key] = read.value
          }
        }
        if (enumerated) this.#projectData(record, pointer, node, depth)
      } else this.#projectData(input, pointer, node, depth)
    }
    if (object) this.#active.delete(input)
    if (!this.#admitted.has('truncated')) delete node.truncated
    return Object.freeze(node)
  }
}
