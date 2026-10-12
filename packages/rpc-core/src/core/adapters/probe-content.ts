import { isArrayBuffer } from '@migaia/utils/bytes'

/** Native view constructors recreate internal slots without reading a payload's constructor getter. */
const NativeViewConstructor = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array
}
/** Intrinsic typed-array access reads internal slots rather than caller-defined payload getters. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)

/** Read byte payload length without serializing structured-clone values or allocating a buffer. */
export function carrierSizeBytes(message: unknown): number {
  if (message instanceof ArrayBuffer)
    return Reflect.get(ArrayBuffer.prototype, 'byteLength', message)
  if (ArrayBuffer.isView(message)) {
    /** DataView lacks a typed-array tag but shares the native view byte-length contract. */
    const prototype =
      Reflect.get(typedArrayPrototype, Symbol.toStringTag, message) === undefined
        ? DataView.prototype
        : typedArrayPrototype
    return Reflect.get(prototype, 'byteLength', message)
  }
  return -1
}

/** Link actual own-data or native-container membership without executing a payload accessor. */
function linkTransferredOwner(
  child: unknown,
  owner: object,
  parents: Map<object, object[]>,
  pending: object[]
): void {
  if (child === null || typeof child !== 'object') return
  /** Reverse edges restrict reconstruction to containers that actually own a transferred leaf. */
  const owners = parents.get(child)
  if (owners === undefined) parents.set(child, [owner])
  else owners.push(owner)
  pending.push(child)
}

/** Copy a backing only when discovery reaches it and this send actually transfers it. */
function transferredBacking(
  value: ArrayBuffer,
  transferred: ReadonlySet<object>,
  replacements: Map<object, unknown>
): ArrayBuffer | undefined {
  if (!transferred.has(value)) return undefined
  /** Aliased buffers and views share one captured backing rather than copying bytes again. */
  let copied = replacements.get(value) as ArrayBuffer | undefined
  if (copied === undefined) {
    // SC9(a): discovery reached this exact transfer-list backing, so its observed bytes would be lost.
    copied = new Uint8Array(value).slice().buffer
    replacements.set(value, copied)
  }
  return copied
}

/**
 * Preserve a native view's offset/type over the copied exact transfer backing, without user
 * getters.
 */
function transferredView(
  value: ArrayBufferView,
  transferred: ReadonlySet<object>,
  replacements: Map<object, unknown>
): unknown {
  /** Native tags identify the constructor without reading caller-visible constructor or tag fields. */
  const tag = Reflect.get(typedArrayPrototype, Symbol.toStringTag, value) as
    | keyof typeof NativeViewConstructor
    | undefined
  /** DataView internal-slot access uses its own intrinsic prototype. */
  const prototype = tag === undefined ? DataView.prototype : typedArrayPrototype
  /** Only this reached backing can be copied; unrelated transfer-list backings remain untouched. */
  const backing = transferredBacking(
    Reflect.get(prototype, 'buffer', value),
    transferred,
    replacements
  )
  if (backing === undefined) return value
  /** Native offset is retained independently of any caller-defined public property. */
  const offset = Reflect.get(prototype, 'byteOffset', value) as number
  // SC9(a): this view would lose its bytes when its exact transferred backing detaches.
  return tag === undefined
    ? new DataView(backing, offset, Reflect.get(prototype, 'byteLength', value))
    : new NativeViewConstructor[tag](backing, offset, Reflect.get(prototype, 'length', value))
}

/**
 * SC9(a): copy exact transfer-list backings and only their owning native containers. Discovery
 * records reverse ownership; changed shells exist before wiring so cycles and aliases survive.
 * Accessors are retained, never invoked here; accessor-only backing ownership cannot be captured
 * without adding a getter invocation to native send, so that path remains explicitly limited.
 */
export function captureTransferredContent(
  message: unknown,
  transfer: readonly unknown[] | undefined
): unknown {
  if (message === null || typeof message !== 'object' || transfer === undefined) return message
  /** Transfer candidates alone never cause copies; discovery must also reach their bytes. */
  let transferred: Set<object> | undefined
  for (const value of transfer) {
    if (!isArrayBuffer(value)) continue
    transferred ??= new Set<object>()
    transferred.add(value)
  }
  if (transferred === undefined) return message
  /** Replacements are seeded lazily only by reachable transferred backings or their views. */
  const replacements = new Map<object, unknown>()
  /** Reverse membership identifies affected ancestors without copying any unrelated branch. */
  const parents = new Map<object, object[]>()
  /** Each native container is inspected once even when several paths or cycles reach it. */
  const visited = new Set<object>()
  /** Data descriptors retain getter identity while avoiding extra getter calls during send. */
  const properties = new Map<object, Record<PropertyKey, PropertyDescriptor>>()
  /** An explicit stack handles capture discovery and later ancestor propagation without closures. */
  const pending: object[] = [message]
  while (pending.length !== 0) {
    /** This exact original identity supplies native membership and own data fields. */
    const value = pending.pop()!
    if (visited.has(value)) continue
    visited.add(value)
    if (ArrayBuffer.isView(value)) {
      /** Changed views become replacement leaves, sharing their copied transferred backing. */
      const copied = transferredView(value, transferred, replacements)
      if (copied !== value) replacements.set(value, copied)
      continue
    }
    if (isArrayBuffer(value)) {
      transferredBacking(value, transferred, replacements)
      continue
    }
    if (value instanceof Map) {
      for (const [key, child] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
        [unknown, unknown]
      >) {
        linkTransferredOwner(key, value, parents, pending)
        linkTransferredOwner(child, value, parents, pending)
      }
    } else if (value instanceof Set) {
      for (const child of Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>)
        linkTransferredOwner(child, value, parents, pending)
    }
    /** Snapshot each own descriptor once; only its data value contributes an ownership edge. */
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >
    properties.set(value, descriptors)
    for (const key of Reflect.ownKeys(descriptors)) {
      /** An accessor remains an accessor rather than being evaluated by observation. */
      const descriptor = descriptors[key]!
      if ('value' in descriptor) linkTransferredOwner(descriptor.value, value, parents, pending)
    }
  }
  /** Detached leaves seed the exact transitive set of containers whose content needs preservation. */
  const changed = new Set(replacements.keys())
  for (const value of changed) pending.push(value)
  while (pending.length !== 0) {
    /** Every affected identity is expanded once, so cyclic ownership converges. */
    const value = pending.pop()!
    /** Backings not reachable through this message need no ancestor reconstruction. */
    const owners = parents.get(value)
    if (owners === undefined) continue
    for (const owner of owners)
      if (!changed.has(owner)) {
        changed.add(owner)
        pending.push(owner)
      }
  }
  for (const value of changed) {
    if (replacements.has(value)) continue
    // SC9(a): only an ancestor of a detached backing receives a new native container shell.
    replacements.set(
      value,
      value instanceof Map
        ? new Map()
        : value instanceof Set
          ? new Set()
          : Array.isArray(value)
            ? []
            : Object.create(Object.getPrototypeOf(value))
    )
  }
  for (const value of changed) {
    /** Only discovered containers need wiring; backings and views already have complete copies. */
    const descriptors = properties.get(value)
    if (descriptors === undefined) continue
    /** Every affected shell already exists, allowing exact cycle and shared-reference replacement. */
    const copied = replacements.get(value)
    if (value instanceof Map) {
      for (const [key, child] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
        [unknown, unknown]
      >)
        (copied as Map<unknown, unknown>).set(
          replacements.get(key as object) ?? key,
          replacements.get(child as object) ?? child
        )
    } else if (value instanceof Set) {
      for (const child of Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>)
        (copied as Set<unknown>).add(replacements.get(child as object) ?? child)
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      /**
       * Keep unchanged data references and accessor definitions exactly as captured during
       * discovery.
       */
      const descriptor = descriptors[key]!
      if ('value' in descriptor)
        descriptor.value = replacements.get(descriptor.value) ?? descriptor.value
    }
    // SC9(a): restore own descriptors only on a shell whose transferred descendant required copying.
    Object.defineProperties(copied, descriptors)
  }
  return replacements.get(message) ?? message
}
