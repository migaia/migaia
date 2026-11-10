import { isPlainObject } from '@migaia/utils/object'

/** Current-realm native leaves preserve their data behavior under the canonical clone. */
const IMMUTABLE_LEAF_PROTOTYPES = new Set([Date.prototype, RegExp.prototype, ArrayBuffer.prototype])
/** Standard typed arrays share this intrinsic parent; custom subclasses are not data-only values. */
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype)
/** Native getters inspect the actual backing buffer without evaluating an application shadow getter. */
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'buffer')!.get!
/**
 * DataView has its own native buffer getter and is also restricted to independent ArrayBuffer
 * storage.
 */
const DATA_VIEW_BUFFER = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')!.get!

/**
 * Admits data-only snapshots without evaluating accessors or cloning a second graph.
 * Ordinary/null-prototype records, ordinary arrays, native Map/Set and the listed native leaves are
 * supported. Functions/symbols still reach Utils' canonical native rejection and cause chain.
 */
export function isImmutableSnapshotData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  seen.add(value)
  /** Prototype checks reject custom classes before their behavior can be flattened. */
  const prototype = Object.getPrototypeOf(value)
  // structuredClone keeps no own properties of native leaves; any custom property would be lost.
  if (IMMUTABLE_LEAF_PROTOTYPES.has(prototype)) return hasNoCustomKeys(value, prototype)
  if (prototype === DataView.prototype)
    return (
      Reflect.ownKeys(value).length === 0 &&
      Reflect.apply(DATA_VIEW_BUFFER, value, []) instanceof ArrayBuffer
    )
  if (ArrayBuffer.isView(value) && Object.getPrototypeOf(prototype) === TYPED_ARRAY_PROTOTYPE)
    return (
      hasOnlyIndexKeys(value as unknown as ArrayLike<unknown>) &&
      Reflect.apply(TYPED_ARRAY_BUFFER, value, []) instanceof ArrayBuffer
    )
  // Inspect native collection payloads, not application-replaced iterator methods.
  if (prototype === Map.prototype) {
    if (Reflect.ownKeys(value).length !== 0) return false
    for (const [key, entry] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      [unknown, unknown]
    >) {
      if (!isImmutableSnapshotData(key, seen) || !isImmutableSnapshotData(entry, seen)) return false
    }
    return true
  }
  if (prototype === Set.prototype) {
    if (Reflect.ownKeys(value).length !== 0) return false
    for (const entry of Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>)
      if (!isImmutableSnapshotData(entry, seen)) return false
    return true
  }
  if (!(Array.isArray(value) && prototype === Array.prototype) && !isPlainObject(value))
    return false
  /** Inspect data descriptors rather than invoke getters during admission. */
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >
  for (const key of Reflect.ownKeys(descriptors)) {
    /** Each property is admitted as data without executing an accessor. */
    const descriptor = descriptors[key]
    // structuredClone drops symbol keys and non-enumerable properties (array length is native).
    if (typeof key === 'symbol') return false
    if (!descriptor.enumerable && !(key === 'length' && Array.isArray(value))) return false
    if (!('value' in descriptor) || !isImmutableSnapshotData(descriptor.value, seen)) return false
  }
  return true
}

/**
 * True when a native leaf has no own properties beyond its built-in ones. RegExp's own `lastIndex`
 * is built in; structuredClone resets it to 0, so only a regex already at 0 copies without loss.
 */
function hasNoCustomKeys(value: object, prototype: unknown): boolean {
  /** Own keys of the leaf, read once. */
  const keys = Reflect.ownKeys(value)
  if (keys.length === 0) return true
  return (
    prototype === RegExp.prototype &&
    keys.length === 1 &&
    keys[0] === 'lastIndex' &&
    (value as RegExp).lastIndex === 0
  )
}

/** True when a typed array's own keys are exactly its element indices (no custom properties). */
function hasOnlyIndexKeys(value: ArrayLike<unknown>): boolean {
  /** Own keys of the typed array, read once. */
  const keys = Reflect.ownKeys(value)
  return keys.length === value.length && keys.every((key) => typeof key === 'string')
}
