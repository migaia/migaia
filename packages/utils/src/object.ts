import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

export * from './object-path.js'

export type IProbePropertyResult<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown }
export type ISnapshotDiagnostic = {
  readonly path: readonly PropertyKey[]
  readonly reason: 'accessor' | 'read-failed' | 'unsupported'
  readonly cause: unknown
}
export type IDiagnosticSnapshot<T> = {
  readonly value: T
  readonly diagnostics: readonly ISnapshotDiagnostic[]
}

type ISnapshotTraversal = {
  readonly diagnostics: ISnapshotDiagnostic[]
  readonly seen: WeakMap<object, unknown>
}

/** Accepts only ordinary record objects or null-prototype records, never arrays. */
export function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === null || Object.getPrototypeOf(prototype) === null
  } catch {
    return false
  }
}

/** Reads one property exactly once and exposes getter failures explicitly. */
export function probeProperty<T>(value: object, key: PropertyKey): IProbePropertyResult<T> {
  if (!Reflect.has(value, key)) return { kind: 'missing' }
  try {
    return { kind: 'value', value: Reflect.get(value, key, value) as T }
  } catch (error) {
    return { kind: 'failed', error }
  }
}

/** Produces an independent immutable data snapshot for supported plain values. */
export function immutableSnapshot<T>(value: T): T {
  if (typeof globalThis.structuredClone !== 'function') {
    const unavailable = new TypeError(UtilsErrorText.envUnsupported('structuredClone'))
    attachErrorIdentity(unavailable, {
      source: '@migaia/utils',
      code: UtilsErrorCode.envUnsupported
    })
    throw unavailable
  }
  try {
    return structuredClone(value)
  } catch (error) {
    const tagged = new TypeError(UtilsErrorText.cloneUnsupported, { cause: error })
    attachErrorIdentity(tagged, { source: '@migaia/utils', code: UtilsErrorCode.cloneUnsupported })
    throw tagged
  }
}

/** Produces a best-effort value snapshot plus explicit diagnostics. */
export function diagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T> {
  return fallbackSnapshot(value)
}

/** Produces one structuredClone-first diagnostic projection for tolerant consumers. */
export function structuredDiagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T> {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return { value: globalThis.structuredClone(value), diagnostics: [] }
    } catch (error) {
      const snapshot = fallbackSnapshot(value)
      return {
        value: snapshot.value,
        diagnostics: [{ path: [], reason: 'read-failed', cause: error }, ...snapshot.diagnostics]
      }
    }
  }
  const snapshot = fallbackSnapshot(value)
  return {
    value: snapshot.value,
    diagnostics: [{ path: [], reason: 'unsupported', cause: undefined }, ...snapshot.diagnostics]
  }
}

/** Recursively projects plain values while containing every reflective host failure. */
function fallbackSnapshot<T>(value: T): IDiagnosticSnapshot<T> {
  const traversal: ISnapshotTraversal = { diagnostics: [], seen: new WeakMap<object, unknown>() }
  return {
    value: projectSnapshotValue(value, [], traversal) as T,
    diagnostics: traversal.diagnostics
  }
}

/** Projects one value and aliases only the subtree that cannot be inspected safely. */
function projectSnapshotValue(
  current: unknown,
  path: readonly PropertyKey[],
  traversal: ISnapshotTraversal
): unknown {
  if (current === null || (typeof current !== 'object' && typeof current !== 'function'))
    return current
  if (traversal.seen.has(current as object)) return traversal.seen.get(current as object)

  // structuredClone can isolate standard built-ins even when an unrelated sibling (such as a
  // function) makes cloning the complete root impossible.  Clone this subtree independently so
  // only the actually unsupported leaf is retained by reference.
  let cloneableBuiltin = false
  try {
    cloneableBuiltin =
      typeof globalThis.structuredClone === 'function' &&
      (current instanceof Date ||
        current instanceof RegExp ||
        current instanceof Map ||
        current instanceof Set ||
        current instanceof ArrayBuffer ||
        ArrayBuffer.isView(current))
  } catch {
    cloneableBuiltin = false
  }
  if (cloneableBuiltin) {
    try {
      const cloned = globalThis.structuredClone(current)
      traversal.seen.set(current as object, cloned)
      return cloned
    } catch (error) {
      traversal.diagnostics.push({ path, reason: 'unsupported', cause: error })
      return current
    }
  }

  let isArray = false
  let prototype: object | null = null
  try {
    isArray = Array.isArray(current)
    prototype = Object.getPrototypeOf(current)
    const parentPrototype = prototype === null ? null : Object.getPrototypeOf(prototype)
    if (
      typeof current === 'function' ||
      (!isArray && prototype !== null && parentPrototype !== null)
    ) {
      traversal.diagnostics.push({ path, reason: 'unsupported', cause: current })
      return current
    }
  } catch (error) {
    traversal.diagnostics.push({ path, reason: 'read-failed', cause: error })
    return current
  }

  let target: object
  try {
    target = isArray ? [] : Object.create(prototype)
    traversal.seen.set(current as object, target)
  } catch (error) {
    traversal.diagnostics.push({ path, reason: 'read-failed', cause: error })
    return current
  }

  let keys: PropertyKey[]
  try {
    keys = Reflect.ownKeys(current as object)
  } catch (error) {
    traversal.diagnostics.push({ path, reason: 'read-failed', cause: error })
    return current
  }
  for (const key of keys) {
    if (isArray && key === 'length') continue
    const propertyPath = [...path, key]
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(current as object, key)
    } catch (error) {
      traversal.diagnostics.push({ path: propertyPath, reason: 'read-failed', cause: error })
      continue
    }
    if (!descriptor) continue
    if (!descriptor.enumerable) continue
    let projectedDescriptor: PropertyDescriptor
    if ('value' in descriptor) {
      projectedDescriptor = {
        ...descriptor,
        value: projectSnapshotValue(descriptor.value, propertyPath, traversal)
      }
    } else {
      let accessed: unknown
      try {
        accessed = Reflect.get(current as object, key, current)
      } catch (error) {
        traversal.diagnostics.push({ path: propertyPath, reason: 'read-failed', cause: error })
        continue
      }
      traversal.diagnostics.push({ path: propertyPath, reason: 'accessor', cause: accessed })
      projectedDescriptor = {
        value: projectSnapshotValue(accessed, propertyPath, traversal),
        enumerable: descriptor.enumerable,
        configurable: true,
        writable: true
      }
    }
    try {
      Object.defineProperty(target, key, projectedDescriptor)
    } catch (error) {
      traversal.diagnostics.push({ path: propertyPath, reason: 'read-failed', cause: error })
      try {
        Object.defineProperty(target, key, {
          ...projectedDescriptor,
          value: 'value' in descriptor ? descriptor.value : undefined
        })
      } catch (fallbackError) {
        traversal.diagnostics.push({
          path: propertyPath,
          reason: 'read-failed',
          cause: fallbackError
        })
      }
    }
  }
  return target
}

/** Returns the original value while making identity preservation explicit. */
export function identitySnapshot<T>(value: T): T {
  return value
}
