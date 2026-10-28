/** ConfigOwner path admission, descriptor reads and copy-on-write environment/path rebuilding. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { isPlainObject } from '../object.ts'
import { CONFIG_DELETE } from './config-contract.ts'
import { parseConfigPath } from './config-path.ts'
import { ownerError } from './config-owner-error.ts'

/** Marker returned by the path rebuild when a delete targets a missing path (no change). */
export const UNCHANGED: unique symbol = Symbol('UNCHANGED')

/** Only records created for the current unpublished environment draft may be updated in place. */
export type IEnvConstructionContext = {
  /** Borrowed coerce values remain outside this set and retain the original per-edge copy policy. */
  readonly owned: WeakSet<object>
}

/** Turns an owner path into validated segments through the canonical config path parser. */
export function toSegments(path: unknown): readonly string[] {
  if (typeof path === 'string') return parseConfigPath(path)
  if (!Array.isArray(path) || path.length === 0)
    throw ownerError(
      TypeError,
      UtilsErrorCode.configPathInvalid,
      UtilsErrorText.configPathInvalid(String(path), ConfigReason.pathListRequired)
    )
  for (const segment of path)
    if (typeof segment !== 'string' || segment.length === 0 || segment.includes('.'))
      throw ownerError(
        TypeError,
        UtilsErrorCode.configPathInvalid,
        UtilsErrorText.configPathInvalid(String(segment), ConfigReason.invalidSegment)
      )
  // Re-parse the joined form so dangerous keys and limits use the one canonical policy.
  parseConfigPath(path.join('.'))
  return Object.freeze([...path])
}

/** Reads one own data property without invoking accessors. */
export function ownValue(
  node: unknown,
  key: string
): { readonly found: boolean; readonly value: unknown } {
  if (node === null || typeof node !== 'object') return { found: false, value: undefined }
  /** Descriptor read avoids running getters on owned graphs. */
  const descriptor = Object.getOwnPropertyDescriptor(node, key)
  return descriptor && 'value' in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false, value: undefined }
}

/** Walks raw owned data along segments; never wraps or copies. */
export function rawAt(
  root: unknown,
  segments: readonly string[]
): { found: boolean; value: unknown } {
  /** Current node during the walk. */
  let node = root
  for (const segment of segments) {
    /** Own data value of the current segment. */
    const next = ownValue(node, segment)
    if (!next.found) return { found: false, value: undefined }
    node = next.value
  }
  return { found: true, value: node }
}

/** Array index segment check; config paths spell indexes as plain digit strings. */
function isIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment)
}

/** Shallow copy of a record that keeps its prototype and own data descriptors. */
function copyRecord(node: object): Record<string, unknown> {
  /** Copy with the same prototype (plain or null-prototype). */
  const copy = Object.create(Object.getPrototypeOf(node)) as Record<string, unknown>
  for (const key of Reflect.ownKeys(node)) {
    /** Source descriptor, copied as is so enumerability stays unchanged. */
    const descriptor = Object.getOwnPropertyDescriptor(node, key)
    if (descriptor) Object.defineProperty(copy, key, descriptor)
  }
  return copy
}

/**
 * Rebuilds one container along `segments` with copy-on-write. Missing intermediates become plain
 * records. A delete of a missing path returns `UNCHANGED`. Environment construction may reuse only
 * records already owned by its unpublished draft; ordinary writes retain copy-on-write.
 */
export function rebuild(
  node: unknown,
  segments: readonly string[],
  value: unknown,
  at: string,
  construction?: IEnvConstructionContext
): unknown {
  if (segments.length === 0) return value
  // All callers use toSegments and parseConfigPath's fixed default maxPathLength of 4096
  // (config.ts). Suffix and diagnostic-prefix copies have that fixed bound, independent of env width.
  /** Current segment and its remaining path. */
  const [segment, ...rest] = segments
  /** Owned child at this segment, if any. */
  const child = ownValue(node, segment)
  if (node === undefined) {
    if (value === CONFIG_DELETE) return UNCHANGED
    /** Missing records belong only to this construction, never to a supplied coerce value. */
    const record = {
      [segment]: rebuild(undefined, rest, value, `${at}.${segment}`, construction)
    }
    construction?.owned.add(record)
    return record
  }
  if (Array.isArray(node)) {
    if (!isIndex(segment))
      throw ownerError(
        TypeError,
        UtilsErrorCode.configPathInvalid,
        UtilsErrorText.configPathInvalid(`${at}.${segment}`, ConfigReason.arrayIndexRequired)
      )
    /** Numeric index into the copied array. */
    const index = Number(segment)
    if (value === CONFIG_DELETE && rest.length === 0) {
      if (index >= node.length) return UNCHANGED
      return [...node.slice(0, index), ...node.slice(index + 1)]
    }
    /** Rebuilt child; unchanged children keep the original array. */
    const next = rebuild(
      child.found ? child.value : undefined,
      rest,
      value,
      `${at}.${segment}`,
      construction
    )
    if (next === UNCHANGED) return UNCHANGED
    /** Copy-on-write array; the original stays untouched. */
    const copy = [...node]
    copy[index] = next
    return copy
  }
  if (!isPlainObject(node))
    throw ownerError(
      TypeError,
      UtilsErrorCode.configPathInvalid,
      UtilsErrorText.configPathInvalid(at, ConfigReason.recordOrArrayRequired)
    )
  if (value === CONFIG_DELETE && rest.length === 0) {
    if (!child.found) return UNCHANGED
    /** Copy without the deleted key. */
    const copy = copyRecord(node)
    delete copy[segment]
    return copy
  }
  /** Rebuilt child. */
  const next = rebuild(
    child.found ? child.value : undefined,
    rest,
    value,
    `${at}.${segment}`,
    construction
  )
  if (next === UNCHANGED) return UNCHANGED
  /** Only an unexposed private draft avoids copying its growing record; borrowed records detach. */
  const copy = construction?.owned.has(node) ? node : copyRecord(node)
  Object.defineProperty(copy, segment, {
    configurable: true,
    enumerable: true,
    value: next,
    writable: true
  })
  construction?.owned.add(copy)
  return copy
}
