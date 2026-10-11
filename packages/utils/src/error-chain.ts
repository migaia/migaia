import { attachErrorIdentity, tryReadProperty } from './error.js'
import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import {
  ErrorChainFallback,
  ErrorChainField,
  ErrorChainLimit,
  ErrorChainNativeName,
  ErrorChainReadField,
  ErrorChainUnknownFields,
  ErrorChainViolation
} from './error-chain-constants.js'
import type {
  IErrorChainData,
  IErrorChainLimits,
  IErrorChainStrategy,
  IErrorChainText,
  INormalizeErrorChainOptions,
  ISerializedErrorChain,
  ISerializeErrorChainOptions
} from './error-chain-types.js'

/** Fields read once from an object before deciding whether it is error-like. */
type IErrorSnapshot = Readonly<{
  fields: Readonly<Record<string, unknown>>
  failed: ReadonlySet<string>
  truncated: boolean
}>

/** Mutable output while allocating a bounded wire tree; frozen before return. */
type IWireNode = Record<string, unknown> & {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: ISerializedErrorChain
  errors?: readonly ISerializedErrorChain[]
  data?: IErrorChainData
  truncated?: true
}

/** Snapshot fixed error fields once for both wire projection and graph traversal. */
function snapshotError(
  input: object,
  pointer: string,
  report: (pointer: string, field: string, error: unknown) => void,
  summaryOnly = false,
  strategy: IErrorChainStrategy = {}
): IErrorSnapshot {
  /** The selected whitelist controls optional getter access as well as output admission. */
  const admitted = new Set<string>(strategy.fields ?? ErrorChainField)
  /** The null-prototype snapshot prevents source property names from changing record inheritance. */
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  const failed = new Set<string>()
  for (const key of summaryOnly
    ? ErrorChainField.slice(0, 5)
    : ErrorChainReadField.filter((field) =>
        field === 'cleanupErrors' ? admitted.has('errors') : admitted.has(field)
      )) {
    /** Keep each field's failure attached to its original pointer. */
    const read = tryReadProperty(input as Record<string, unknown>, key)
    if (read.threw) {
      failed.add(key)
      report(pointer, key, read.error)
    } else fields[key] = read.value
  }
  if (!summaryOnly)
    for (const extension of strategy.extensions ?? []) {
      if (!admitted.has(extension.field)) continue
      if (extension.read) fields[extension.field] = extension.read(input)
      else {
        /**
         * Read once with the original receiver; keep a thrown getter value reachable through
         * reporting.
         */
        const read = tryReadProperty(input as Record<string, unknown>, extension.field)
        if (read.threw) {
          failed.add(extension.field)
          report(pointer, extension.field, read.error)
        } else fields[extension.field] = read.value
      }
    }
  return { fields, failed, truncated: failed.size > 0 }
}

/** Projects any thrown value into a bounded, frozen, language-neutral error tree. */
export function serializeErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: ISerializeErrorChainOptions = {}
): ISerializedErrorChain {
  /** Per-invocation resolved policy keeps all budgets isolated across reentrant getter calls. */
  const limits = { ...ErrorChainLimit, ...strategy.limits }
  /** Fallback is diagnostic presentation, never local package authority. */
  const fallback = { ...ErrorChainFallback, ...strategy.fallback }
  /** Optional fields excluded by the whitelist are never projected or traversed. */
  const admitted = new Set<string>(strategy.fields ?? ErrorChainField)
  /** Caller owns privacy transforms; the default preserves scalar-safe bounded UTF-8 text. */
  const sanitize = (text: string, truncate = true): IErrorChainText =>
    strategy.sanitizeText?.(text, truncate) ??
    sanitizeErrorText(text, limits.maxStringBytes, truncate)
  /** Boundary data conversion stays outside the generic graph algorithm. */
  const normalizeData = (input: unknown, depth: number): IErrorChainData =>
    strategy.normalizeData
      ? strategy.normalizeData(input, depth)
      : normalizePlainData(input, depth, limits)
  /** Each invocation owns its path and budget, including reentrant calls from getters. */
  const active = new Set<object>()
  /** Occurrence and text budgets belong to this invocation and are debited in output order. */
  const budget = { nodes: 0, bytes: 0 }

  /** Report a caught input failure exactly once, preserving the thrown value. */
  function report(
    pointer: string,
    field: string,
    error: unknown,
    violation: ErrorChainViolation = ErrorChainViolation.read
  ): void {
    if (options.report) options.report({ pointer, field, error })
    else throw createViolation(strategy, error, `${pointer}/${field}`, violation)
  }

  /** Try a portable data projection and its separate byte budget. */
  function projectData(raw: unknown, pointer: string, node: IWireNode, depth: number): void {
    if (raw === undefined) return
    /** The selected data codec snapshots input before any sanitization or text budgeting. */
    let portable: IErrorChainData
    try {
      portable = normalizeData(raw, depth)
    } catch (error) {
      node.truncated = true
      report(pointer, 'data', error, ErrorChainViolation.dataPortable)
      return
    }
    /** Sanitization also detects key collisions introduced by replacement. */
    const sanitized = sanitizeData(portable, sanitize, strategy)
    if (sanitized === undefined) {
      node.truncated = true
      return
    }
    if (sanitized.replaced) node.truncated = true
    if (
      sanitized.bytes > limits.maxStringBytes ||
      budget.bytes + sanitized.bytes > limits.maxBytes
    ) {
      node.truncated = true
      return
    }
    budget.bytes += sanitized.bytes
    node.data = sanitized.value
  }

  /** Admit a node only after its own five fields fit the remaining total budget. */
  function visit(
    input: unknown,
    pointer: string,
    depth: number
  ): ISerializedErrorChain | undefined {
    if (depth > limits.maxNesting - 1 || budget.nodes >= limits.maxNodes) return undefined
    if ((typeof input === 'object' && input !== null) || typeof input === 'function') {
      if (active.has(input)) return undefined
      active.add(input)
    }
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
        report(pointer, 'data', error)
      }
    }
    /** Exact held Error references select presentation; a wire property cannot supply this policy. */
    const localSummary = strategy.presentation?.(input)
    /** Opt-in applies to this exact local node; each descendant makes its own secrecy decision. */
    const summaryOnly = localSummary !== undefined && localSummary.preserveSerializedError !== true
    /** Hold the one-read field snapshot while classifying and traversing this exact input object. */
    const source =
      object && !array ? snapshotError(input, pointer, report, summaryOnly, strategy) : undefined
    /** Native errors remain error-like even when a diagnostic field getter is missing or malformed. */
    let nativeError = false
    if (source) {
      try {
        nativeError = input instanceof Error
      } catch (error) {
        classificationFailed = true
        report(pointer, 'name', error)
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
          : fallback.nonErrorMessage)
    /** Retain the incoming diagnostic name; unclassified values use the fallback native error name. */
    const name =
      errorLike && typeof source.fields.name === 'string' && source.fields.name.length > 0
        ? source.fields.name
        : fallback.name
    /** Property insertion order is stable: own diagnostic fields precede data and graph descendants. */
    const node: IWireNode = {
      source:
        errorLike && typeof source.fields.source === 'string' && source.fields.source.length > 0
          ? source.fields.source
          : fallback.source,
      code:
        localSummary?.code ??
        (errorLike && typeof source.fields.code === 'string' && source.fields.code.length > 0
          ? source.fields.code
          : fallback.code),
      name,
      message,
      stack:
        errorLike && typeof source.fields.stack === 'string' && source.fields.stack.length > 0
          ? source.fields.stack
          : `${name}: ${message}`
    }
    if (classificationFailed || source?.truncated || source?.fields.truncated === true)
      node.truncated = true
    /** Own text is accepted before data and descendants. */
    let ownBytes = 0
    for (const key of ['source', 'code', 'name', 'message', 'stack'] as const) {
      /**
       * The text strategy reports both replacement and UTF-8 size without modifying the original
       * input.
       */
      const text = sanitize(node[key])
      node[key] = text.value
      ownBytes += text.bytes
      if (text.changed) node.truncated = true
    }
    if (depth > 0 && budget.bytes + ownBytes > limits.maxBytes) {
      if (object) active.delete(input)
      return undefined
    }
    if (depth === 0 && ownBytes > limits.maxBytes)
      throw createViolation(strategy, input, pointer, ErrorChainViolation.totalBytes)
    budget.bytes += ownBytes
    budget.nodes += 1

    /** Exact-object presentation may hide all secret-bearing descendants of this node. */
    if (errorLike && !summaryOnly) {
      if (admitted.has('data')) projectData(source.fields.data, pointer, node, depth)
      for (const extension of strategy.extensions ?? []) {
        if (!admitted.has(extension.field)) continue
        if (source.fields[extension.field] === undefined) continue
        try {
          /** Extension grammars own their field shape and contribute to the shared text budget. */
          const projected = extension.normalize(
            source.fields[extension.field],
            `${pointer}/${extension.field}`
          )
          if (budget.bytes + projected.bytes > limits.maxBytes) node.truncated = true
          else {
            Object.defineProperty(node, extension.field, {
              value: projected.value,
              configurable: true,
              enumerable: true,
              writable: true
            })
            budget.bytes += projected.bytes
          }
        } catch (error) {
          node.truncated = true
          report(pointer, extension.field, error)
        }
      }
      if (admitted.has('cause') && source.fields.cause !== undefined) {
        /** Cause edges add one nesting level and are admitted before aggregate children. */
        const cause = visit(source.fields.cause, `${pointer}/cause`, depth + 1)
        if (cause) node.cause = cause
        else node.truncated = true
      }
      /** Errors keep a prefix when a child cannot be admitted. */
      const children: unknown[] = []
      if (
        admitted.has('errors') &&
        appendChildren(source.fields.errors, pointer, 'errors', children, report, limits.maxObjects)
      )
        node.truncated = true
      if (
        admitted.has('errors') &&
        appendCleanupChildren(
          source.fields.cleanupErrors,
          pointer,
          children,
          report,
          limits.maxObjects
        )
      )
        node.truncated = true
      /** Keep the admitted aggregate prefix when the first child exceeds the remaining tree budget. */
      const output: ISerializedErrorChain[] = []
      for (let index = 0; index < children.length; index += 1) {
        /** Each child occurrence is projected independently; only active ancestors count as cycles. */
        const child = visit(children[index], `${pointer}/errors/${index}`, depth + 2)
        if (!child) {
          node.truncated = true
          break
        }
        output.push(child)
      }
      if (output.length > 0) node.errors = Object.freeze(output)
    } else if (
      admitted.has('data') &&
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
          report(pointer, 'data', error)
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
              report(pointer, key, read.error)
            } else record[key] = read.value
          }
        }
        if (enumerated) projectData(record, pointer, node, depth)
      } else projectData(input, pointer, node, depth)
    }
    if (object) active.delete(input)
    if (!admitted.has('truncated')) delete node.truncated
    return Object.freeze(node)
  }
  return visit(value, '', 0)!
}

/** Walk the same graph edges without the wire depth limit, deduplicating object identities. */
export function* reachErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: ISerializeErrorChainOptions = {}
): Generator<unknown> {
  /** Reachability has an identity budget independent from serialized tree depth and occurrences. */
  const maxObjects = strategy.limits?.maxObjects ?? ErrorChainLimit.maxObjects
  /** Getter failures are reported by the caller or retained as a coded violation cause. */
  const report = (pointer: string, field: string, error: unknown): void => {
    if (options.report) options.report({ pointer, field, error })
    else throw createViolation(strategy, error, `${pointer}/${field}`, ErrorChainViolation.read)
  }
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
      report(current.pointer, 'data', error)
    }
    if (array) continue
    /** Hold the one-read field snapshot while classifying and traversing this exact input object. */
    const source = snapshotError(current.value, current.pointer, report, false, strategy)
    /** Collect cause, aggregate entries, and cleanup failures in their observable order. */
    const children: unknown[] = []
    if (source.fields.cause !== undefined) children.push(source.fields.cause)
    appendChildren(source.fields.errors, current.pointer, 'errors', children, report, maxObjects)
    appendCleanupChildren(
      source.fields.cleanupErrors,
      current.pointer,
      children,
      report,
      maxObjects
    )
    for (let index = children.length - 1; index >= 0; index -= 1)
      pending.push({ value: children[index], pointer: `${current.pointer}/errors/${index}` })
  }
}

/** Replace lone surrogates and retain the longest allowed UTF-8 scalar prefix. */
export function sanitizeErrorText(
  value: string,
  maxBytes: number = ErrorChainLimit.maxStringBytes,
  truncate = true
): IErrorChainText {
  /** Build the longest scalar prefix whose UTF-8 bytes fit the caller-selected limit. */
  let output = ''
  /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
  let bytes = 0
  /** Any replacement or truncation must surface through the returned diagnostic flag. */
  let changed = false
  for (let index = 0; index < value.length; index += 1) {
    /** Inspect UTF-16 units so lone surrogates are replaced without splitting valid scalar pairs. */
    const first = value.charCodeAt(index)
    /** One complete Unicode scalar is appended only if its whole UTF-8 encoding fits. */
    let scalar: string
    if (first >= 0xd800 && first <= 0xdbff) {
      /** A following low surrogate completes this scalar; otherwise retain an explicit replacement. */
      const second = value.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        scalar = value.slice(index, index + 2)
        index += 1
      } else {
        scalar = '\ufffd'
        changed = true
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      scalar = '\ufffd'
      changed = true
    } else scalar = value[index]!
    /** The scalar-safe UTF-8 width is checked before debiting the relevant text budget. */
    const size = utf8Bytes(scalar)
    if (truncate && bytes + size > maxBytes) {
      changed = true
      break
    }
    output += scalar
    bytes += size
  }
  return { value: output, bytes, changed }
}

/** Sanitize portable data and count only its text units, excluding error-node field names. */
function sanitizeData(
  value: IErrorChainData,
  sanitize: (value: string, truncate: boolean) => IErrorChainText,
  strategy: IErrorChainStrategy
): { value: IErrorChainData; bytes: number; replaced: boolean } | undefined {
  if (typeof value === 'string') {
    /**
     * The text strategy reports both replacement and UTF-8 size without modifying the original
     * input.
     */
    const text = sanitize(value, false)
    return { value: text.value, bytes: text.bytes, replaced: text.changed }
  }
  if (Array.isArray(value)) {
    /** Sanitized arrays are copied and frozen so callers cannot mutate admitted portable data. */
    const items: IErrorChainData[] = []
    /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
    let bytes = 0
    /** Propagate nested text replacement to the enclosing error truncation flag. */
    let replaced = false
    for (const item of value) {
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = sanitizeData(item, sanitize, strategy)
      if (!next) return undefined
      items.push(next.value)
      bytes += next.bytes
      replaced ||= next.replaced
    }
    return { value: Object.freeze(items), bytes, replaced }
  }
  if (value !== null && typeof value === 'object') {
    /** A boundary may own an atomic text-bearing representation inside otherwise plain data. */
    const leaf = strategy.dataTextLeaf?.(value as Readonly<Record<string, IErrorChainData>>)
    if (leaf) return { value, bytes: utf8Bytes(leaf.text), replaced: false }
    /** Fresh null-prototype data records keep source keys inert and preserve insertion order. */
    const record: Record<string, IErrorChainData> = Object.create(null) as Record<
      string,
      IErrorChainData
    >
    /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
    let bytes = 0
    /** Propagate nested text replacement to the enclosing error truncation flag. */
    let replaced = false
    for (const [key, item] of Object.entries(value)) {
      /**
       * The text strategy reports both replacement and UTF-8 size without modifying the original
       * input.
       */
      const text = sanitize(key, false)
      if (Object.hasOwn(record, text.value)) return undefined
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = sanitizeData(item, sanitize, strategy)
      if (!next) return undefined
      record[text.value] = next.value
      bytes += text.bytes + next.bytes
      replaced ||= text.changed || next.replaced
    }
    return { value: Object.freeze(record), bytes, replaced }
  }
  return { value, bytes: 0, replaced: false }
}

/** Read array length and entries once while reporting trapped reads at their owner. */
function appendChildren(
  input: unknown,
  pointer: string,
  field: string,
  output: unknown[],
  report: (pointer: string, field: string, error: unknown) => void,
  maxObjects: number
): boolean {
  /**
   * Arrays never supply named error fields; classification failures follow the caller report
   * policy.
   */
  let array = false
  try {
    array = Array.isArray(input)
  } catch (error) {
    report(pointer, field, error)
    return true
  }
  if (!array) return false
  /** Array metadata is read once before admitting any children. */
  const lengthRead = tryReadProperty(input as unknown[], 'length')
  if (lengthRead.threw) {
    report(pointer, 'length', lengthRead.error)
    return true
  }
  /** Hold the original array length before entry reads so traps cannot change traversal shape. */
  const length = lengthRead.value
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  let failed = false
  for (let index = 0; index < Math.min(length, maxObjects); index += 1) {
    /** An index trap reports its original thrown value and skips only that child. */
    const read = tryReadProperty(input as unknown[], index)
    if (read.threw) {
      failed = true
      report(pointer, String(index), read.error)
    } else output.push(read.value)
  }
  return failed || length > maxObjects
}

/** Append cleanup error entries after ordinary AggregateError children. */
function appendCleanupChildren(
  input: unknown,
  pointer: string,
  output: unknown[],
  report: (pointer: string, field: string, error: unknown) => void,
  maxObjects: number
): boolean {
  /** Cleanup entries are snapshotted before reading their error properties. */
  const entries: unknown[] = []
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  let failed = appendChildren(input, pointer, 'cleanupErrors', entries, report, maxObjects)
  for (let index = 0; index < entries.length; index += 1) {
    /** A cleanup record contributes only its error property, never its resource metadata. */
    const entry = entries[index]
    if ((typeof entry !== 'object' || entry === null) && typeof entry !== 'function') continue
    /** Cleanup entry reads use the same original-error reporting policy. */
    const read = tryReadProperty(entry as Record<string, unknown>, 'error')
    if (read.threw) {
      failed = true
      report(`${pointer}/cleanupErrors/${index}`, 'error', read.error)
    } else if (read.value !== undefined) output.push(read.value)
  }
  return failed
}

/** Validate and freeze a fresh wire error tree before any receiver uses its fields. */
export function normalizeSerializedErrorChain(
  value: unknown,
  strategy: IErrorChainStrategy = {},
  options: INormalizeErrorChainOptions = {}
): ISerializedErrorChain {
  /** Receive validation counts the consumer's canonical tree grammar and byte bounds. */
  const limits = { ...ErrorChainLimit, ...strategy.limits }
  /** Whitelist order is consumer-owned so the first invalid field remains deterministic. */
  const fieldOrder = strategy.fields ?? ErrorChainField
  /** Plain-data defaults are used only when the boundary has not selected its own portable codec. */
  const normalizeData = (input: unknown, depth: number): IErrorChainData =>
    strategy.normalizeData
      ? strategy.normalizeData(input, depth)
      : normalizePlainData(input, depth, limits)
  /** Node and text budgets count occurrences in the incoming tree. */
  const budget = { nodes: 0, bytes: 0 }
  /** Current ancestors reject cyclic input without rejecting shared subtrees. */
  const active = new Set<object>()
  /** The receive default rejects extensions that the caller has not explicitly admitted. */
  const unknownFields = options.unknownFields ?? ErrorChainUnknownFields.reject

  /** Raise the first wire violation with a reachable original input. */
  function invalid(pointer: string, violation: ErrorChainViolation, cause: unknown = value): never {
    throw createViolation(strategy, cause, pointer, violation)
  }

  /** Keep all mandatory property reads on the same wire-error path. */
  function readOrInvalid<T extends object, K extends keyof T>(
    target: T,
    key: K,
    pointer: string
  ): T[K] {
    /** Read once with the original receiver; keep a thrown getter value reachable through reporting. */
    const read = tryReadProperty(target, key)
    if (read.threw) invalid(pointer, ErrorChainViolation.read, read.error)
    return read.value
  }

  /** Check one well-formed UTF-8 text unit and optionally debit the payload budget. */
  function countText(unit: string, pointer: string, debit = true): number {
    if (!isWellFormed(unit)) invalid(pointer, ErrorChainViolation.surrogate)
    /** The scalar-safe UTF-8 width is checked before debiting the relevant text budget. */
    const size = utf8Bytes(unit)
    if (size > limits.maxStringBytes) invalid(pointer, ErrorChainViolation.stringBytes)
    if (debit) budget.bytes += size
    if (debit && budget.bytes > limits.maxBytes) invalid(pointer, ErrorChainViolation.totalBytes)
    return size
  }

  /** Count only the language-neutral text units of a normalized portable value. */
  function countData(data: IErrorChainData, pointer: string): void {
    /** The scalar-safe UTF-8 width is checked before debiting the relevant text budget. */
    let size = 0
    /** Visit plain data, with atomic text representations selected only by the boundary strategy. */
    function visit(child: IErrorChainData, path: string): void {
      if (typeof child === 'string') {
        size += countText(child, path, false)
      } else if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, `${path}/${index}`))
      } else if (child !== null && typeof child === 'object') {
        /** Protocol-owned atomic representations contribute only their selected text unit. */
        const leaf = strategy.dataTextLeaf?.(child as Readonly<Record<string, IErrorChainData>>)
        if (leaf) {
          size += countText(leaf.text, `${path}/${escapePointer(leaf.key)}`, false)
        } else {
          for (const [key, item] of Object.entries(child)) {
            size += countText(key, `${path}/${escapePointer(key)}`, false)
            visit(item, `${path}/${escapePointer(key)}`)
          }
        }
      }
      if (size > limits.maxStringBytes) invalid(pointer, ErrorChainViolation.dataBytes)
    }
    visit(data, pointer)
    budget.bytes += size
    if (budget.bytes > limits.maxBytes) invalid(pointer, ErrorChainViolation.totalBytes)
  }

  /** Snapshot one node in the documented first-error order. */
  function visit(input: unknown, pointer: string, depth: number): ISerializedErrorChain {
    budget.nodes += 1
    if (budget.nodes > limits.maxNodes) invalid(pointer, ErrorChainViolation.nodes)
    if (depth > limits.maxNesting - 1) invalid(pointer, ErrorChainViolation.depth)
    /**
     * Arrays never supply named error fields; classification failures follow the caller report
     * policy.
     */
    let array = false
    try {
      array = Array.isArray(input)
    } catch (error) {
      invalid(pointer, ErrorChainViolation.read, error)
    }
    if (typeof input !== 'object' || input === null || array)
      invalid(pointer, ErrorChainViolation.type)
    if (active.has(input)) invalid(pointer, ErrorChainViolation.type)
    active.add(input)
    /** Own fields are enumerated once, then read once in canonical field order. */
    let keys: string[]
    try {
      keys = Object.keys(input)
    } catch (error) {
      invalid(pointer, ErrorChainViolation.read, error)
    }
    /** The strategy whitelist defines accepted own fields before any receiver getter is read. */
    const known = new Set<string>(fieldOrder)
    for (const key of keys.filter((entry) => !known.has(entry)).sort(compareCodePoints)) {
      if (unknownFields === ErrorChainUnknownFields.reject)
        invalid(pointer, ErrorChainViolation.unknownField)
      options.onUnknownField?.(pointer, key)
    }
    /** Read each present property once, including optional properties. */
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [index, key] of fieldOrder.entries()) {
      if (!keys.includes(key)) {
        if (index < 5) invalid(`${pointer}/${key}`, ErrorChainViolation.required)
        continue
      }
      fields[key] = readOrInvalid(input as Record<string, unknown>, key, `${pointer}/${key}`)
      if (['source', 'code', 'name', 'message', 'stack'].includes(key)) {
        /**
         * Validate this held field once, preserving first-error order and mandatory text
         * requirements.
         */
        const field = fields[key]
        if (typeof field !== 'string' || (key !== 'message' && field.length === 0))
          invalid(`${pointer}/${key}`, ErrorChainViolation.type)
        countText(field, `${pointer}/${key}`)
      }
    }
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
        invalid(`${pointer}/cause`, ErrorChainViolation.read, error)
      }
      if (typeof fields.cause !== 'object' || fields.cause === null || causeArray)
        invalid(`${pointer}/cause`, ErrorChainViolation.type)
    }
    /** Snapshot aggregate length once before validating any entries. */
    let errorsLength = 0
    if (Object.hasOwn(fields, 'errors')) {
      /** Only an actual array supplies aggregate children across the receiving boundary. */
      let errorsArray = false
      try {
        errorsArray = Array.isArray(fields.errors)
      } catch (error) {
        invalid(`${pointer}/errors`, ErrorChainViolation.read, error)
      }
      if (!errorsArray) invalid(`${pointer}/errors`, ErrorChainViolation.type)
      errorsLength = readOrInvalid(fields.errors as unknown[], 'length', `${pointer}/errors/length`)
      if (errorsLength === 0) invalid(`${pointer}/errors`, ErrorChainViolation.emptyErrors)
    }
    if (Object.hasOwn(fields, 'data')) {
      try {
        result.data = normalizeData(fields.data, depth)
      } catch (error) {
        invalid(`${pointer}/data`, ErrorChainViolation.dataPortable, error)
      }
      countData(result.data, `${pointer}/data`)
    }
    if (Object.hasOwn(fields, 'truncated')) {
      if (fields.truncated !== true)
        invalid(`${pointer}/truncated`, ErrorChainViolation.truncatedValue)
      result.truncated = true
    }
    for (const extension of strategy.extensions ?? []) {
      if (!Object.hasOwn(fields, extension.field)) continue
      /** Boundary extension normalization keeps its own public failure semantics. */
      const projected = extension.normalize(
        fields[extension.field],
        `${pointer}/${extension.field}`
      )
      budget.bytes += projected.bytes
      if (budget.bytes > limits.maxBytes)
        invalid(`${pointer}/${extension.field}`, ErrorChainViolation.totalBytes)
      Object.defineProperty(result, extension.field, {
        value: projected.value,
        configurable: true,
        enumerable: true,
        writable: true
      })
    }
    if (Object.hasOwn(fields, 'cause'))
      result.cause = visit(fields.cause, `${pointer}/cause`, depth + 1)
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
          visit(readOrInvalid(children, index, childPointer), childPointer, depth + 2)
        )
      }
      result.errors = Object.freeze(normalized)
    }
    active.delete(input)
    return Object.freeze(result)
  }
  return visit(value, '', 0)
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

/** Restore the native type and property descriptors without changing the remote stack. */
function restore(value: ISerializedErrorChain, strategy: IErrorChainStrategy): Error {
  /** Collect cause, aggregate entries, and cleanup failures in their observable order. */
  const children = value.errors?.map((child) => restore(child, strategy)) ?? []
  /** The default constructor policy retains all supported native classes. */
  const error = strategy.createError?.(value, children) ?? createNativeError(value, children)
  if (error.name !== value.name)
    Object.defineProperty(error, 'name', { value: value.name, configurable: true })
  Object.defineProperty(error, 'stack', {
    value: value.stack,
    configurable: true,
    writable: true
  })
  if (strategy.attachIdentity) strategy.attachIdentity(error, value)
  else attachErrorIdentity(error, { source: value.source, code: value.code })
  if (value.cause)
    Object.defineProperty(error, 'cause', {
      value: restore(value.cause, strategy),
      configurable: true,
      writable: true
    })
  if (value.errors && value.name !== ErrorChainNativeName.aggregate)
    Object.defineProperty(error, 'errors', {
      value: Object.freeze(children),
      configurable: true
    })
  if (value.data !== undefined)
    Object.defineProperty(error, 'data', { value: value.data, enumerable: true })
  for (const extension of strategy.extensions ?? []) {
    if (!Object.hasOwn(value, extension.field)) continue
    /** Restored extension metadata remains boundary-owned and never grants generic authority. */
    const extensionValue = (value as unknown as Record<string, unknown>)[extension.field]
    if (extensionValue === undefined) continue
    Object.defineProperty(error, extension.field, { value: extensionValue, enumerable: true })
    extension.restore?.(error, extensionValue as IErrorChainData)
  }
  if (value.truncated === true) Object.defineProperty(error, 'truncated', { value: true })
  return error
}

/** Escape an RFC 6901 pointer segment without interpreting the source key. */
function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** Sort unknown keys by Unicode code point, independent of locale. */
function compareCodePoints(left: string, right: string): number {
  /** Compare Unicode scalars rather than locale collation or UTF-16 surrogate ordering. */
  const a = Array.from(left)
  /** The second scalar sequence uses the same stable unknown-field ordering. */
  const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    /** Scalar values determine deterministic field precedence independent of host locale. */
    const x = a[index]!.codePointAt(0)!
    /** The right scalar is compared at the same ordinal position. */
    const y = b[index]!.codePointAt(0)!
    if (x !== y) return x - y
  }
  return a.length - b.length
}

/** Reject lone UTF-16 surrogate halves instead of silently replacing them on receive. */
function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    /** Inspect the scalar encoding without a host-specific TextEncoder dependency. */
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      /** Reject data-key collisions or malformed descendants rather than returning a lossy record. */
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

/** Count UTF-8 bytes from Unicode scalar values without a host-specific encoder. */
function utf8Bytes(value: string): number {
  /** Count UTF-8 text units only; structural field names do not consume the error text budget. */
  let bytes = 0
  for (const scalar of value) {
    /** Inspect the scalar encoding without a host-specific TextEncoder dependency. */
    const code = scalar.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

/** Restore supported built-in classes without interpreting received constructor names as code. */
function createNativeError(value: ISerializedErrorChain, children: readonly Error[]): Error {
  /** Use the host native abort class when available without introducing a platform dependency. */
  const DomException = (
    globalThis as unknown as {
      DOMException?: new (message?: string, name?: string) => Error
    }
  ).DOMException
  return value.name === ErrorChainNativeName.aggregate
    ? new AggregateError(children, value.message)
    : value.name === ErrorChainNativeName.abort && typeof DomException === 'function'
      ? new DomException(value.message, ErrorChainNativeName.abort)
      : value.name === ErrorChainNativeName.type
        ? new TypeError(value.message)
        : value.name === ErrorChainNativeName.range
          ? new RangeError(value.message)
          : value.name === ErrorChainNativeName.syntax
            ? new SyntaxError(value.message)
            : value.name === ErrorChainNativeName.reference
              ? new ReferenceError(value.message)
              : value.name === ErrorChainNativeName.uri
                ? new URIError(value.message)
                : value.name === ErrorChainNativeName.eval
                  ? new EvalError(value.message)
                  : new Error(value.message)
}

/** Attach the caller's violation identity, or the default utils identity, retaining the input cause. */
function createViolation(
  strategy: IErrorChainStrategy,
  cause: unknown,
  pointer: string,
  violation: ErrorChainViolation
): Error {
  if (strategy.createViolation) return strategy.createViolation(cause, pointer, violation)
  /** A native TypeError identifies malformed cross-realm input without replacing the original cause. */
  const error = new TypeError(UtilsErrorText.errorChainInvalid(pointer, violation), { cause })
  attachErrorIdentity(error, { source: '@migaia/utils', code: UtilsErrorCode.errorChainInvalid })
  Object.defineProperty(error, 'pointer', { value: pointer })
  Object.defineProperty(error, 'violation', { value: violation })
  return error
}

/**
 * Snapshot plain finite JSON data into fresh frozen arrays and null-prototype records. Functions,
 * symbols, class instances, cycles, and exceeded tree limits are rejected rather than silently lost
 * by JSON. Getter failures retain their exact value as the coded violation cause.
 */
function normalizePlainData(
  value: unknown,
  depth: number,
  limits: IErrorChainLimits
): IErrorChainData {
  /** Each projection owns its active path and occurrence budget, including repeated shared objects. */
  const active = new Set<object>()
  /** Plain data uses the same configured occurrence bound as the enclosing error tree. */
  let nodes = 0

  /**
   * Reject at the exact data location while keeping the offending input or getter failure
   * reachable.
   */
  function invalid(input: unknown, pointer: string, violation: ErrorChainViolation): never {
    throw createViolation({}, input, pointer, violation)
  }

  /** Walk only plain JSON shapes, reading each admitted key or array position once. */
  function visit(input: unknown, pointer: string, nesting: number): IErrorChainData {
    if (++nodes > limits.maxNodes) invalid(input, pointer, ErrorChainViolation.nodes)
    if (nesting > limits.maxNesting - 1) invalid(input, pointer, ErrorChainViolation.depth)
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) invalid(input, pointer, ErrorChainViolation.type)
      return input
    }
    if (typeof input !== 'object') invalid(input, pointer, ErrorChainViolation.type)
    if (active.has(input)) invalid(input, pointer, ErrorChainViolation.type)
    active.add(input)
    /** Read failures occur before children and retain their original exception identity. */
    let array: boolean
    /** Hold the enumerated own keys so no property is rediscovered while getters execute. */
    let keys: string[]
    try {
      array = Array.isArray(input)
      keys = array ? [] : Object.keys(input)
    } catch (error) {
      invalid(error, pointer, ErrorChainViolation.read)
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
      invalid(input, pointer, ErrorChainViolation.type)
    if (Object.getOwnPropertySymbols(input).length > 0)
      invalid(input, pointer, ErrorChainViolation.type)
    /** Require a successful one-read snapshot before visiting a child. */
    function read(target: object, key: string | number, path: string): unknown {
      /** A fresh output retains the fixed property order and cannot inherit source object behavior. */
      const result = tryReadProperty(target as Record<string | number, unknown>, key)
      if (result.threw) invalid(result.error, path, ErrorChainViolation.read)
      return result.value
    }
    if (array) {
      /** Array length is held before iteration so getter side effects cannot change traversal shape. */
      const length = read(input, 'length', `${pointer}/length`) as number
      /**
       * Dense output rejects unsupported undefined and sparse entries instead of converting to
       * null.
       */
      const result: IErrorChainData[] = []
      for (let index = 0; index < length; index += 1) {
        /** Keep each dense data entry associated with its original pointer while reading it once. */
        const path = `${pointer}/${index}`
        result.push(visit(read(input, index, path), path, nesting + 1))
      }
      active.delete(input)
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
      result[key] = visit(read(input, key, path), path, nesting + 1)
    }
    active.delete(input)
    return Object.freeze(result)
  }
  return visit(value, '', depth + 1)
}
