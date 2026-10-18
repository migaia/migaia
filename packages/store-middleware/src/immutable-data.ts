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
  if (IMMUTABLE_LEAF_PROTOTYPES.has(prototype)) return true
  if (prototype === DataView.prototype)
    return Reflect.apply(DATA_VIEW_BUFFER, value, []) instanceof ArrayBuffer
  if (ArrayBuffer.isView(value) && Object.getPrototypeOf(prototype) === TYPED_ARRAY_PROTOTYPE)
    return Reflect.apply(TYPED_ARRAY_BUFFER, value, []) instanceof ArrayBuffer
  // Inspect native collection payloads, not application-replaced iterator methods.
  if (prototype === Map.prototype) {
    for (const [key, entry] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      [unknown, unknown]
    >) {
      if (!isImmutableSnapshotData(key, seen) || !isImmutableSnapshotData(entry, seen)) return false
    }
    return true
  }
  if (prototype === Set.prototype) {
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
    if (!('value' in descriptor) || !isImmutableSnapshotData(descriptor.value, seen)) return false
  }
  return true
}
