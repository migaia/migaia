/** Default portable and collection admission policies; traversal stays with PortableWalker. */
import { createSerializeTypeError, SerializeErrorCode } from './errors.ts'
import { CodecErrorText } from './codec-text.ts'
import type { IPortableWalkerStrategy } from './portable.ts'
import {
  PortableBytesField,
  PortableCollectionField,
  PortableViolation
} from './portable-contract.ts'

/** Capture marker presence once from already enumerated keys without repeating caller reflection. */
function hasPortableMarker(keys: readonly string[]): boolean {
  /** Process each captured own key once while preserving the existing enumeration order. */
  for (const key of keys) if (key === PortableBytesField.marker) return true
  return false
}

/** Legacy record keys read lazily so nested getters retain sorted or decoded traversal order. */
function* portableEntries(
  value: Record<string, unknown>,
  keys: readonly string[]
): Iterable<readonly [string, unknown]> {
  /** Process each captured own key once while preserving the existing enumeration order. */
  for (const key of keys) yield [key, value[key]]
}

/** Existing portable assertion recognizes only null/string/boolean/finite-number scalars. */
function portableScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

/** Preserve legacy public identity; raw projection/accessor failures stay with format wrappers. */
function raisePortableViolation(reason: string, cause?: unknown): never {
  if (reason === PortableViolation.access || reason === PortableViolation.ancestor) throw cause
  throw createSerializeTypeError(
    SerializeErrorCode.invalidOption,
    CodecErrorText.portableValueInvalid,
    cause === undefined ? undefined : { cause }
  )
}

/** Legacy bytes spelling intentionally validates only the alphabet, preserving decoded results. */
function invalidPortableTag(
  value: Record<string, unknown>,
  keys: readonly string[],
  hasMarker: boolean
): string | undefined {
  return hasMarker &&
    (keys.length !== 2 ||
      value[PortableBytesField.marker] !== PortableBytesField.kind ||
      typeof value[PortableBytesField.data] !== 'string' ||
      !/^[A-Za-z0-9_-]*$/u.test(value[PortableBytesField.data] as string))
    ? PortableViolation.tag
    : undefined
}

/** The legacy projection strategy remains private and contains no recursive traversal. */
export const projectionStrategy: IPortableWalkerStrategy = {
  scalar: (value) => ({ value }),
  binary: (value, context) => {
    /** Existing conversion reads the public tag before its intrinsic Uint8Array brand probe. */
    const tag = ArrayBuffer.isView(value)
      ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
      : undefined
    if (context.isUint8Array(value) || tag === 'Uint8Array')
      return context.bytesToBase64url(
        context.isUint8Array(value) ? value : new Uint8Array(value as never)
      )
    if (
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set ||
      ArrayBuffer.isView(value)
    )
      context.reject(PortableViolation.binary)
    return undefined
  },
  record: (value) => {
    if (!Object.hasOwn(value, PortableBytesField.marker) && Array.isArray(value)) return undefined
    /** Sorted keys are captured once and also identify an enumerable wire tag. */
    const keys = Object.keys(value).sort()
    return {
      entries: portableEntries(value as Record<string, unknown>, keys),
      output: {},
      hasBinary: hasPortableMarker(keys)
    }
  },
  violation: raisePortableViolation
}

/** Decoded assertion strategy retains original inputs and historical getter/enumeration semantics. */
export const assertionStrategy: IPortableWalkerStrategy = {
  scalar: (value, context) => {
    if (!portableScalar(value)) context.reject(PortableViolation.scalar)
    return { value }
  },
  binary: (value, context) => {
    // Legacy validation rejects an ancestor before performing any binary/property probes.
    if (context.isAncestor(value)) context.reject(PortableViolation.cycle)
    /** Read the existing binary discriminator at its historical admission boundary. */
    const tag = ArrayBuffer.isView(value)
      ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
      : undefined
    if (
      context.isUint8Array(value) ||
      tag === 'Uint8Array' ||
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set
    )
      context.reject(PortableViolation.binary)
    return undefined
  },
  record: (value, context) => {
    if (Array.isArray(value)) return undefined
    /** Only prototype traps were historically wrapped by the standalone assertion API. */
    let prototype: object | null
    try {
      prototype = Object.getPrototypeOf(value)
    } catch (cause) {
      return context.reject(PortableViolation.prototype, cause)
    }
    if (prototype !== Object.prototype && prototype !== null)
      context.reject(PortableViolation.prototype)
    /** The captured key list is reused when validating a bytes tag, without another ownKeys trap. */
    const keys = Object.keys(value)
    /** Reuse enumerable marker presence without another caller reflection trap. */
    const hasMarker = hasPortableMarker(keys)
    /** Marker admission reuses the captured key snapshot without another reflection trap. */
    const invalid = invalidPortableTag(value as Record<string, unknown>, keys, hasMarker)
    if (invalid !== undefined) context.reject(invalid)
    return {
      entries: hasMarker ? [] : portableEntries(value as Record<string, unknown>, keys)
    }
  },
  array: (value, visit) => {
    /** Iterator visit count avoids any new caller length reads after legacy assertion. */
    let length = 0
    /** Validate each iterator-supplied child without probing the caller array length. */
    for (const child of value) {
      visit(child)
      length++
    }
    return { value, length }
  },
  violation: raisePortableViolation
}

/** One admitted record owns its key snapshot and final tag validation until traversal completes. */
class CodecPortableRecord {
  /** Original enumerable keys preserve admission counts independently from projected values. */
  readonly #keys: readonly string[]
  /** Lazy entries retain the original getter order while the walker visits each child. */
  readonly entries: Iterable<readonly [string, unknown]>
  /** Fresh projection receives only fields accepted by the shared traversal. */
  readonly output: Record<string, unknown> = {}
  /** Captured marker presence supplies constant-time tag admission and binary evidence. */
  readonly hasBinary: boolean
  /** A stable callback retains this record's snapshot without a callback nested in policy code. */
  readonly validate = (output: Record<string, unknown>): string | undefined =>
    this.#validate(output)

  /** Capture existing reflection results without observing the input again. */
  constructor(value: Record<string, unknown>, keys: readonly string[]) {
    this.#keys = keys
    this.entries = portableEntries(value, keys)
    this.hasBinary = hasPortableMarker(keys)
  }

  /** Validate after all children so later getter failures retain their original priority. */
  #validate(output: Record<string, unknown>): string | undefined {
    return invalidPortableTag(output, this.#keys, this.hasBinary)
  }
}

/** Fused default policy retains legacy format behavior without exposing a consumer preset. */
export const codecStrategy: IPortableWalkerStrategy = {
  ...projectionStrategy,
  scalar: (value) => ({
    value,
    violation: portableScalar(value) ? undefined : PortableViolation.scalar
  }),
  record: (value) => {
    if (!Object.hasOwn(value, PortableBytesField.marker) && Array.isArray(value)) return undefined
    /** Codec formats preserve enumeration order; public portable snapshots retain their sorting. */
    const keys = Object.keys(value)
    return new CodecPortableRecord(value as Record<string, unknown>, keys)
  },
  array: (value, visit) => {
    /** Projected value remains owned by the current node until admission finishes. */
    const output = value.map(visit)
    /** Read only the newly projected array's own length. */
    const length = output.length
    for (let index = 0; index < length; index++)
      if (!Object.hasOwn(output, index))
        return { value: output, length, violation: PortableViolation.sparse }
    return { value: output, length }
  }
}

/** Captured slot accessors admit genuine cross-realm collections even after prototype changes. */
const intrinsicMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
/** Captured Set slot accessor bypasses caller-controlled prototypes and tags. */
const intrinsicSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!
/** Captured iterators avoid caller replacements of Symbol.iterator or collection methods. */
const intrinsicMapEntries = Map.prototype.entries
/** Captured Set iteration retains insertion order without consulting user properties. */
const intrinsicSetValues = Set.prototype.values

/** Brand mismatch is expected during slot admission, so native TypeError means a different kind. */
function collectionKind(value: object): 'map' | 'set' | undefined {
  try {
    Reflect.apply(intrinsicMapSize, value, [])
    return PortableCollectionField.map
  } catch {
    // A non-Map has no Map internal slot; probe the other supported collection.
  }
  try {
    Reflect.apply(intrinsicSetSize, value, [])
    return PortableCollectionField.set
  } catch {
    return undefined
  }
}

/** Reject malformed reserved records after recursively validating every admitted child. */
function invalidCollectionTag(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  if (!hasPortableMarker(keys)) return undefined
  if (value[PortableBytesField.marker] === PortableBytesField.kind)
    return invalidPortableTag(value, keys, true)
  if (keys.length !== 2) return PortableViolation.tag
  if (value[PortableBytesField.marker] === PortableCollectionField.map) {
    /** Validate the already projected collection entries without changing order. */
    const entries = value[PortableCollectionField.entries]
    if (
      !Array.isArray(entries) ||
      !entries.every((entry) => Array.isArray(entry) && entry.length === 2)
    )
      return PortableViolation.tag
    return undefined
  }
  if (
    value[PortableBytesField.marker] === PortableCollectionField.set &&
    Array.isArray(value[PortableCollectionField.values])
  )
    return undefined
  return PortableViolation.tag
}

/** Collection admission shares scalar, array, own-field, and bytes rules with the format profile. */
export const collectionsStrategy: IPortableWalkerStrategy = {
  ...codecStrategy,
  binary: (value, context) =>
    collectionKind(value) === undefined ? codecStrategy.binary(value, context) : undefined,
  record: (value, context) => {
    /** Intrinsic collection slots select the existing map or set projection. */
    const kind = collectionKind(value)
    if (kind !== undefined) {
      /** Select the canonical child field for the admitted collection kind. */
      const field =
        kind === PortableCollectionField.map
          ? PortableCollectionField.entries
          : PortableCollectionField.values
      /** Snapshot the intrinsic iterator in its original insertion order. */
      const children =
        kind === PortableCollectionField.map
          ? Array.from(Reflect.apply(intrinsicMapEntries, value, []))
          : Array.from(Reflect.apply(intrinsicSetValues, value, []))
      return {
        entries: [
          [PortableBytesField.marker, kind],
          [field, children]
        ],
        output: {}
      }
    }
    /** Captured policy admission determines projection without rereading strategy getters. */
    const admitted = codecStrategy.record(value, context)
    if (admitted === undefined) return undefined
    return {
      ...admitted,
      validate: validateCollectionRecord
    }
  }
}

/** Final collection admission reads only the ordinary projected record, never the caller again. */
function validateCollectionRecord(output: Record<string, unknown>): string | undefined {
  return invalidCollectionTag(output, Object.keys(output))
}

/** Decoding restores collections only after their recursively projected records pass admission. */
export const restoreCollectionsStrategy: IPortableWalkerStrategy = {
  ...collectionsStrategy,
  finish: (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    /** The projected record alone participates in collection restoration. */
    const record = value as Record<string, unknown>
    /** Defer or reject the existing policy violation without reconstructing errors. */
    const invalid = invalidCollectionTag(record, Object.keys(record))
    if (invalid !== undefined) raisePortableViolation(invalid)
    if (record[PortableBytesField.marker] === PortableCollectionField.map)
      return new Map(record[PortableCollectionField.entries] as [unknown, unknown][])
    if (record[PortableBytesField.marker] === PortableCollectionField.set)
      return new Set(record[PortableCollectionField.values] as unknown[])
    return value
  }
}
