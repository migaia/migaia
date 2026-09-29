import { attachErrorIdentity, tryReadProperty } from '@migaia/utils/error'
import { createContractError } from './contract-error.js'
import { RpcContractErrorCode } from './error-code.js'
import { normalizePortable } from './normalize.js'
import type {
  IRpcPortableValue,
  IRpcSerializedError,
  IRpcSerializeErrorOptions,
  IRpcWireErrorOptions
} from './types.js'
import {
  RpcErrorReachLimit,
  RpcWireErrorFallback,
  RpcWireErrorField,
  RpcWireErrorLimit,
  RpcWireErrorViolation
} from './wire-error-constants.js'

/** Fields read once from an object before deciding whether it is error-like. */
type IErrorSnapshot = Readonly<{
  fields: Readonly<Record<string, unknown>>
  failed: ReadonlySet<string>
  truncated: boolean
}>

/** Mutable output while allocating a bounded wire tree; frozen before return. */
type IWireNode = {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: IRpcSerializedError
  errors?: readonly IRpcSerializedError[]
  data?: IRpcPortableValue
  truncated?: true
}

/** Attach a stable violation location without replacing the native TypeError. */
export function createInvalidWireError(
  cause: unknown,
  pointer: string,
  violation: RpcWireErrorViolation
): Error {
  const error = createContractError(RpcContractErrorCode.invalidWireError, cause)
  Object.defineProperty(error, 'pointer', { value: pointer })
  Object.defineProperty(error, 'violation', { value: violation })
  return error
}

/** Snapshot fixed error fields once for both wire projection and graph traversal. */
function snapshotError(
  input: object,
  pointer: string,
  report: (pointer: string, field: string, error: unknown) => void
): IErrorSnapshot {
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  const failed = new Set<string>()
  for (const key of [
    'name',
    'message',
    'stack',
    'source',
    'code',
    'data',
    'truncated',
    'cause',
    'errors',
    'cleanupErrors'
  ]) {
    /** Keep each field's failure attached to its original pointer. */
    const read = tryReadProperty(input as Record<string, unknown>, key)
    if (read.threw) {
      failed.add(key)
      report(pointer, key, read.error)
    } else fields[key] = read.value
  }
  return { fields, failed, truncated: failed.size > 0 }
}

/** Projects any thrown value into a bounded, frozen, language-neutral error tree. */
export function serializeRpcError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): IRpcSerializedError {
  /** Each invocation owns its path and budget, including reentrant calls from getters. */
  const active = new Set<object>()
  const budget = { nodes: 0, bytes: 0 }

  /** Report a caught input failure exactly once, preserving the thrown value. */
  function report(pointer: string, field: string, error: unknown): void {
    options.report({ pointer, field, error })
  }

  /** Try a portable data projection and its separate byte budget. */
  function projectData(raw: unknown, pointer: string, node: IWireNode, depth: number): void {
    if (raw === undefined) return
    let portable: IRpcPortableValue
    try {
      portable = normalizePortable(raw, 16 + depth + 1)
    } catch (error) {
      node.truncated = true
      report(pointer, 'data', error)
      return
    }
    /** Sanitization also detects key collisions introduced by replacement. */
    const sanitized = sanitizeData(portable)
    if (sanitized === undefined) {
      node.truncated = true
      return
    }
    if (sanitized.replaced) node.truncated = true
    if (
      sanitized.bytes > RpcWireErrorLimit.maxStringBytes ||
      budget.bytes + sanitized.bytes > RpcWireErrorLimit.maxBytes
    ) {
      node.truncated = true
      return
    }
    budget.bytes += sanitized.bytes
    node.data = sanitized.value
  }

  /** Admit a node only after its own five fields fit the remaining total budget. */
  function visit(input: unknown, pointer: string, depth: number): IRpcSerializedError | undefined {
    if (depth > RpcWireErrorLimit.maxNesting - 1 || budget.nodes >= RpcWireErrorLimit.maxNodes)
      return undefined
    if ((typeof input === 'object' && input !== null) || typeof input === 'function') {
      if (active.has(input)) return undefined
      active.add(input)
    }
    /** Primitives and arrays do not expose named error fields. */
    const object = (typeof input === 'object' && input !== null) || typeof input === 'function'
    let array = false
    let classificationFailed = false
    if (object) {
      try {
        array = Array.isArray(input)
      } catch (error) {
        classificationFailed = true
        report(pointer, 'data', error)
      }
    }
    const source = object && !array ? snapshotError(input, pointer, report) : undefined
    let nativeError = false
    if (source) {
      try {
        nativeError = input instanceof Error
      } catch (error) {
        classificationFailed = true
        report(pointer, 'name', error)
      }
    }
    const errorLike =
      source !== undefined &&
      (nativeError ||
        (typeof source.fields.name === 'string' &&
          typeof source.fields.message === 'string' &&
          typeof source.fields.stack === 'string'))
    const message = errorLike
      ? typeof source.fields.message === 'string'
        ? source.fields.message
        : ''
      : typeof input === 'string'
        ? input
        : RpcWireErrorFallback.nonErrorMessage
    const name =
      errorLike && typeof source.fields.name === 'string' && source.fields.name.length > 0
        ? source.fields.name
        : RpcWireErrorFallback.name
    const node: IWireNode = {
      source:
        errorLike && typeof source.fields.source === 'string' && source.fields.source.length > 0
          ? source.fields.source
          : RpcWireErrorFallback.source,
      code:
        errorLike && typeof source.fields.code === 'string' && source.fields.code.length > 0
          ? source.fields.code
          : RpcWireErrorFallback.code,
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
      const text = sanitizeText(node[key])
      node[key] = text.value
      ownBytes += text.bytes
      if (text.changed) node.truncated = true
    }
    if (depth > 0 && budget.bytes + ownBytes > RpcWireErrorLimit.maxBytes) {
      if (object) active.delete(input)
      return undefined
    }
    budget.bytes += ownBytes
    budget.nodes += 1

    if (errorLike) {
      projectData(source.fields.data, pointer, node, depth)
      if (source.fields.cause !== undefined) {
        const cause = visit(source.fields.cause, `${pointer}/cause`, depth + 1)
        if (cause) node.cause = cause
        else node.truncated = true
      }
      /** Errors keep a prefix when a child cannot be admitted. */
      const children: unknown[] = []
      if (appendChildren(source.fields.errors, pointer, 'errors', children, report))
        node.truncated = true
      if (appendCleanupChildren(source.fields.cleanupErrors, pointer, children, report))
        node.truncated = true
      const output: IRpcSerializedError[] = []
      for (let index = 0; index < children.length; index += 1) {
        const child = visit(children[index], `${pointer}/errors/${index}`, depth + 2)
        if (!child) {
          node.truncated = true
          break
        }
        output.push(child)
      }
      if (output.length > 0) node.errors = Object.freeze(output)
    } else if (input !== undefined && typeof input !== 'string') {
      if (source) {
        let keys: string[]
        let enumerated = true
        try {
          keys = Object.keys(input as object)
        } catch (error) {
          enumerated = false
          node.truncated = true
          report(pointer, 'data', error)
          keys = []
        }
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
    return Object.freeze(node)
  }
  return visit(value, '', 0)!
}

/** Walk the same graph edges without the wire depth limit, deduplicating object identities. */
export function* reachRpcError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): Generator<unknown> {
  /** LIFO work preserves cause, errors, then cleanup order. */
  const pending: { value: unknown; pointer: string }[] = [{ value, pointer: '' }]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (
      (typeof current.value !== 'object' || current.value === null) &&
      typeof current.value !== 'function'
    ) {
      yield current.value
      continue
    }
    if (seen.has(current.value)) continue
    if (seen.size >= RpcErrorReachLimit.maxObjects) return
    seen.add(current.value)
    yield current.value
    let array = false
    try {
      array = Array.isArray(current.value)
    } catch (error) {
      options.report({ pointer: current.pointer, field: 'data', error })
    }
    if (array) continue
    const report = (pointer: string, field: string, error: unknown): void => {
      options.report({ pointer, field, error })
    }
    const source = snapshotError(current.value, current.pointer, report)
    const children: unknown[] = []
    if (source.fields.cause !== undefined) children.push(source.fields.cause)
    appendChildren(source.fields.errors, current.pointer, 'errors', children, report)
    appendCleanupChildren(source.fields.cleanupErrors, current.pointer, children, report)
    for (let index = children.length - 1; index >= 0; index -= 1)
      pending.push({ value: children[index], pointer: `${current.pointer}/errors/${index}` })
  }
}

/** Replace lone surrogates and retain the longest allowed UTF-8 scalar prefix. */
export function sanitizeText(
  value: string,
  truncate = true
): { value: string; bytes: number; changed: boolean } {
  let output = ''
  let bytes = 0
  let changed = false
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index)
    let scalar: string
    if (first >= 0xd800 && first <= 0xdbff) {
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
    const size = utf8Bytes(scalar)
    if (truncate && bytes + size > RpcWireErrorLimit.maxStringBytes) {
      changed = true
      break
    }
    output += scalar
    bytes += size
  }
  return { value: output, bytes, changed }
}

/** Sanitize portable data and count its wire text without counting field names. */
function sanitizeData(
  value: IRpcPortableValue
): { value: IRpcPortableValue; bytes: number; replaced: boolean } | undefined {
  if (typeof value === 'string') {
    const text = sanitizeText(value, false)
    return { value: text.value, bytes: text.bytes, replaced: text.changed }
  }
  if (Array.isArray(value)) {
    const items: IRpcPortableValue[] = []
    let bytes = 0
    let replaced = false
    for (const item of value) {
      const next = sanitizeData(item)
      if (!next) return undefined
      items.push(next.value)
      bytes += next.bytes
      replaced ||= next.replaced
    }
    return { value: Object.freeze(items), bytes, replaced }
  }
  if (value !== null && typeof value === 'object') {
    if (
      '$rpc' in value &&
      value.$rpc === 'bytes' &&
      'base64url' in value &&
      typeof value.base64url === 'string'
    ) {
      return { value, bytes: utf8Bytes(value.base64url), replaced: false }
    }
    const record: Record<string, IRpcPortableValue> = Object.create(null) as Record<
      string,
      IRpcPortableValue
    >
    let bytes = 0
    let replaced = false
    for (const [key, item] of Object.entries(value)) {
      const text = sanitizeText(key, false)
      if (Object.hasOwn(record, text.value)) return undefined
      const next = sanitizeData(item)
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
  report: (pointer: string, field: string, error: unknown) => void
): boolean {
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
  const length = lengthRead.value
  let failed = false
  for (let index = 0; index < Math.min(length, RpcErrorReachLimit.maxObjects); index += 1) {
    /** An index trap reports its original thrown value and skips only that child. */
    const read = tryReadProperty(input as unknown[], index)
    if (read.threw) {
      failed = true
      report(pointer, String(index), read.error)
    } else output.push(read.value)
  }
  return failed || length > RpcErrorReachLimit.maxObjects
}

/** Append cleanup error entries after ordinary AggregateError children. */
function appendCleanupChildren(
  input: unknown,
  pointer: string,
  output: unknown[],
  report: (pointer: string, field: string, error: unknown) => void
): boolean {
  const entries: unknown[] = []
  let failed = appendChildren(input, pointer, 'cleanupErrors', entries, report)
  for (let index = 0; index < entries.length; index += 1) {
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
export function normalizeRpcSerializedError(
  value: unknown,
  options: IRpcWireErrorOptions = {}
): IRpcSerializedError {
  /** Node and text budgets count occurrences in the incoming tree. */
  const budget = { nodes: 0, bytes: 0 }
  /** Current ancestors reject cyclic input without rejecting shared subtrees. */
  const active = new Set<object>()
  const mode = options.unknownFields ?? 'reject'

  /** Raise the first wire violation with a reachable original input. */
  function invalid(
    pointer: string,
    violation: RpcWireErrorViolation,
    cause: unknown = value
  ): never {
    throw createInvalidWireError(cause, pointer, violation)
  }

  /** Keep all mandatory property reads on the same wire-error path. */
  function readOrInvalid<T extends object, K extends keyof T>(
    target: T,
    key: K,
    pointer: string
  ): T[K] {
    const read = tryReadProperty(target, key)
    if (read.threw) invalid(pointer, RpcWireErrorViolation.read, read.error)
    return read.value
  }

  /** Check one well-formed UTF-8 text unit and optionally debit the payload budget. */
  function countText(unit: string, pointer: string, debit = true): number {
    if (!isWellFormed(unit)) invalid(pointer, RpcWireErrorViolation.surrogate)
    const size = utf8Bytes(unit)
    if (size > RpcWireErrorLimit.maxStringBytes) invalid(pointer, RpcWireErrorViolation.stringBytes)
    if (debit) budget.bytes += size
    if (debit && budget.bytes > RpcWireErrorLimit.maxBytes)
      invalid(pointer, RpcWireErrorViolation.totalBytes)
    return size
  }

  /** Count only the language-neutral text units of a normalized portable value. */
  function countData(data: IRpcPortableValue, pointer: string): void {
    let size = 0
    /** Visit portable data without treating the bytes representation as a nested record. */
    function visit(child: IRpcPortableValue, path: string): void {
      if (typeof child === 'string') {
        size += countText(child, path, false)
      } else if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, `${path}/${index}`))
      } else if (child !== null && typeof child === 'object') {
        if (
          '$rpc' in child &&
          child.$rpc === 'bytes' &&
          'base64url' in child &&
          typeof child.base64url === 'string'
        ) {
          size += countText(child.base64url, `${path}/base64url`, false)
        } else {
          for (const [key, item] of Object.entries(child)) {
            size += countText(key, `${path}/${escapePointer(key)}`, false)
            visit(item, `${path}/${escapePointer(key)}`)
          }
        }
      }
      if (size > RpcWireErrorLimit.maxStringBytes) invalid(pointer, RpcWireErrorViolation.dataBytes)
    }
    visit(data, pointer)
    budget.bytes += size
    if (budget.bytes > RpcWireErrorLimit.maxBytes)
      invalid(pointer, RpcWireErrorViolation.totalBytes)
  }

  /** Snapshot one node in the documented first-error order. */
  function visit(input: unknown, pointer: string, depth: number): IRpcSerializedError {
    budget.nodes += 1
    if (budget.nodes > RpcWireErrorLimit.maxNodes) invalid(pointer, RpcWireErrorViolation.nodes)
    if (depth > RpcWireErrorLimit.maxNesting - 1) invalid(pointer, RpcWireErrorViolation.depth)
    let array = false
    try {
      array = Array.isArray(input)
    } catch (error) {
      invalid(pointer, RpcWireErrorViolation.read, error)
    }
    if (typeof input !== 'object' || input === null || array)
      invalid(pointer, RpcWireErrorViolation.type)
    if (active.has(input)) invalid(pointer, RpcWireErrorViolation.type)
    active.add(input)
    /** Own fields are enumerated once, then read once in canonical field order. */
    let keys: string[]
    try {
      keys = Object.keys(input)
    } catch (error) {
      invalid(pointer, RpcWireErrorViolation.read, error)
    }
    const known = new Set<string>(RpcWireErrorField)
    for (const key of keys.filter((entry) => !known.has(entry)).sort(compareCodePoints)) {
      if (mode === 'reject') invalid(pointer, RpcWireErrorViolation.unknownField)
      options.onUnknownField?.(pointer, key)
    }
    /** Read each present property once, including optional properties. */
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [index, key] of RpcWireErrorField.entries()) {
      if (!keys.includes(key)) {
        if (index < 5) invalid(`${pointer}/${key}`, RpcWireErrorViolation.required)
        continue
      }
      fields[key] = readOrInvalid(input as Record<string, unknown>, key, `${pointer}/${key}`)
      if (['source', 'code', 'name', 'message', 'stack'].includes(key)) {
        const field = fields[key]
        if (typeof field !== 'string' || (key !== 'message' && field.length === 0))
          invalid(`${pointer}/${key}`, RpcWireErrorViolation.type)
        countText(field, `${pointer}/${key}`)
      }
    }
    const result: {
      source: string
      code: string
      name: string
      message: string
      stack: string
      cause?: IRpcSerializedError
      errors?: readonly IRpcSerializedError[]
      data?: IRpcPortableValue
      truncated?: true
    } = {
      source: fields.source as string,
      code: fields.code as string,
      name: fields.name as string,
      message: fields.message as string,
      stack: fields.stack as string
    }
    if (keys.includes('cause')) {
      let causeArray = false
      try {
        causeArray = Array.isArray(fields.cause)
      } catch (error) {
        invalid(`${pointer}/cause`, RpcWireErrorViolation.read, error)
      }
      if (typeof fields.cause !== 'object' || fields.cause === null || causeArray)
        invalid(`${pointer}/cause`, RpcWireErrorViolation.type)
    }
    let errorsLength = 0
    if (keys.includes('errors')) {
      let errorsArray = false
      try {
        errorsArray = Array.isArray(fields.errors)
      } catch (error) {
        invalid(`${pointer}/errors`, RpcWireErrorViolation.read, error)
      }
      if (!errorsArray) invalid(`${pointer}/errors`, RpcWireErrorViolation.type)
      errorsLength = readOrInvalid(fields.errors as unknown[], 'length', `${pointer}/errors/length`)
      if (errorsLength === 0) invalid(`${pointer}/errors`, RpcWireErrorViolation.emptyErrors)
    }
    if (keys.includes('data')) {
      try {
        result.data = normalizePortable(fields.data, 16 + depth + 1)
      } catch (error) {
        invalid(`${pointer}/data`, RpcWireErrorViolation.dataPortable, error)
      }
      countData(result.data, `${pointer}/data`)
    }
    if (keys.includes('truncated')) {
      if (fields.truncated !== true)
        invalid(`${pointer}/truncated`, RpcWireErrorViolation.truncatedValue)
      result.truncated = true
    }
    if (keys.includes('cause')) result.cause = visit(fields.cause, `${pointer}/cause`, depth + 1)
    if (keys.includes('errors')) {
      /** An errors edge adds both the array and entry depth. */
      const children = fields.errors as unknown[]
      const normalized: IRpcSerializedError[] = []
      for (let index = 0; index < errorsLength; index += 1) {
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
export function deserializeRpcError(value: unknown, options?: IRpcWireErrorOptions): Error {
  const normalized = normalizeRpcSerializedError(value, options)
  return restore(normalized)
}

/** Restore the native type and property descriptors without changing the remote stack. */
function restore(value: IRpcSerializedError): Error {
  const children = value.errors?.map((child) => restore(child)) ?? []
  const DomException = (
    globalThis as unknown as {
      DOMException?: new (message?: string, name?: string) => Error
    }
  ).DOMException
  const error =
    value.name === 'AggregateError'
      ? new AggregateError(children, value.message)
      : value.name === 'AbortError' && typeof DomException === 'function'
        ? new DomException(value.message, 'AbortError')
        : value.name === 'TypeError'
          ? new TypeError(value.message)
          : value.name === 'RangeError'
            ? new RangeError(value.message)
            : value.name === 'SyntaxError'
              ? new SyntaxError(value.message)
              : value.name === 'ReferenceError'
                ? new ReferenceError(value.message)
                : value.name === 'URIError'
                  ? new URIError(value.message)
                  : value.name === 'EvalError'
                    ? new EvalError(value.message)
                    : new Error(value.message)
  if (error.name !== value.name)
    Object.defineProperty(error, 'name', { value: value.name, configurable: true })
  Object.defineProperty(error, 'stack', {
    value: value.stack,
    configurable: true,
    writable: true
  })
  attachErrorIdentity(error, { source: value.source, code: value.code })
  if (value.cause)
    Object.defineProperty(error, 'cause', {
      value: restore(value.cause),
      configurable: true,
      writable: true
    })
  if (value.errors && value.name !== 'AggregateError')
    Object.defineProperty(error, 'errors', {
      value: Object.freeze(children),
      configurable: true
    })
  if (value.data !== undefined)
    Object.defineProperty(error, 'data', { value: value.data, enumerable: true })
  if (value.truncated === true) Object.defineProperty(error, 'truncated', { value: true })
  return error
}

/** Escape an RFC 6901 pointer segment without interpreting the source key. */
function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** Sort unknown keys by Unicode code point, independent of locale. */
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index]!.codePointAt(0)!
    const y = b[index]!.codePointAt(0)!
    if (x !== y) return x - y
  }
  return a.length - b.length
}

/** Reject lone UTF-16 surrogate halves instead of silently replacing them on receive. */
function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

/** Count UTF-8 bytes from Unicode scalar values without a host-specific encoder. */
function utf8Bytes(value: string): number {
  let bytes = 0
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}
