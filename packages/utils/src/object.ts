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
  const diagnostics: ISnapshotDiagnostic[] = []
  const seen = new WeakMap<object, unknown>()
  const clone = (current: unknown, path: readonly PropertyKey[]): unknown => {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function'))
      return current
    if (seen.has(current as object)) return seen.get(current as object)
    let plain = false
    try {
      if (Array.isArray(current)) plain = true
      else {
        const prototype = Object.getPrototypeOf(current)
        plain = prototype === null || Object.getPrototypeOf(prototype) === null
      }
    } catch (error) {
      diagnostics.push({ path, reason: 'read-failed', cause: error })
      return current
    }
    if (typeof current === 'function' || !plain) {
      diagnostics.push({ path, reason: 'unsupported', cause: current })
      return current
    }
    const target = Array.isArray(current) ? [] : Object.create(Object.getPrototypeOf(current))
    seen.set(current as object, target)
    for (const key of Reflect.ownKeys(current as object)) {
      if (Array.isArray(current) && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(current as object, key)
      if (!descriptor) continue
      if (!('value' in descriptor)) {
        try {
          const accessed = Reflect.get(current as object, key, current)
          diagnostics.push({ path: [...path, key], reason: 'accessor', cause: accessed })
          Object.defineProperty(target, key, {
            value: clone(accessed, [...path, key]),
            enumerable: descriptor.enumerable,
            configurable: true,
            writable: true
          })
        } catch (error) {
          diagnostics.push({ path: [...path, key], reason: 'read-failed', cause: error })
        }
        continue
      }
      try {
        Object.defineProperty(target, key, {
          ...descriptor,
          value: clone(descriptor.value, [...path, key])
        })
      } catch (error) {
        diagnostics.push({ path: [...path, key], reason: 'read-failed', cause: error })
        Object.defineProperty(target, key, { ...descriptor, value: descriptor.value })
      }
    }
    return target
  }
  return { value: clone(value, []) as T, diagnostics }
}

/** Returns the original value while making identity preservation explicit. */
export function identitySnapshot<T>(value: T): T {
  return value
}
