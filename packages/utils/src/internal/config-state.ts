/** Shared config admission metadata, native brands, budgets and coded errors; no graph traversal. */
import { ConfigReason } from './config-text.ts'
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import type { IConfigLimits, IConfigProfile } from './config-contract.ts'

/** These five package ceilings bound supported graph and path admission. */
export const defaultLimits: IConfigLimits = {
  maxDepth: 256,
  maxNodes: 100_000,
  maxKeys: 1_000_000,
  maxPathLength: 4096,
  maxSegmentLength: 512
}
/** Five default budget keys are fixed at module initialization; per-source work is O(1). */
export const configLimitKeys = Object.keys(defaultLimits) as Array<keyof IConfigLimits>
/** Weak identity metadata brands owned roots without retaining discarded configurations. */
export const metadata = new WeakMap<
  object,
  { readonly profile: IConfigProfile; readonly limits: IConfigLimits }
>()
/** Prototype-polluting property names are fixed by config admission and path contracts. */
export const dangerous = new Set<PropertyKey>(['__proto__', 'prototype', 'constructor'])
/** Detects built-in internal slots without mistaking subclass prototype objects for instances. */
export const hasBuiltinBrand = (
  value: object,
  kind: 'date' | 'regexp' | 'map' | 'set'
): boolean => {
  try {
    if (kind === 'date') Reflect.apply(Date.prototype.getTime, value, [])
    else if (kind === 'regexp') {
      /** Use the intrinsic source accessor to distinguish RegExp slots from prototype lookalikes. */
      const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
      if (!getter) return false
      Reflect.apply(getter, value, [])
    } else if (kind === 'map') Reflect.apply(Map.prototype.has, value, [undefined])
    else Reflect.apply(Set.prototype.has, value, [undefined])
    return true
  } catch {
    return false
  }
}
/** These standard prototypes are shared native anchors rather than cloned graph nodes. */
export const intrinsicPrototypes = new Set<object>([
  Object.prototype,
  Array.prototype,
  Function.prototype,
  String.prototype,
  Number.prototype,
  Boolean.prototype,
  Symbol.prototype,
  BigInt.prototype,
  Date.prototype,
  RegExp.prototype,
  Map.prototype,
  Set.prototype,
  Error.prototype,
  TypeError.prototype,
  RangeError.prototype,
  SyntaxError.prototype,
  EvalError.prototype,
  URIError.prototype
])

/** Normalize and validate the five fixed admission ceilings before graph traversal begins. */
export function resolveLimits(overrides?: Partial<IConfigLimits>): IConfigLimits {
  /** Normalize supplied limits before rejecting any invalid or widened budget. */
  const result = { ...defaultLimits, ...overrides }
  for (const [key, value] of Object.entries(result))
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > defaultLimits[key as keyof IConfigLimits]
    )
      throw configError(UtilsErrorCode.configLimitExceeded, key, ConfigReason.invalidLimit)
  return result
}

/** Build the existing native config error and attach package identity without replacing its stack. */
export function configError(code: string, path: string, reason: string, cause?: unknown): Error {
  /** Select the existing stable config diagnostic text for this semantic error code. */
  const message =
    code === UtilsErrorCode.configLimitExceeded
      ? UtilsErrorText.configLimitExceeded(path, reason)
      : code === UtilsErrorCode.configReadonly
        ? UtilsErrorText.configReadonly(path)
        : code === UtilsErrorCode.configConflict
          ? UtilsErrorText.configConflict(path, reason)
          : code === UtilsErrorCode.configPathInvalid
            ? UtilsErrorText.configPathInvalid(path, reason)
            : UtilsErrorText.configUnsupported(path, reason)
  /** A supplied cause remains the exact original object reachable from the native error. */
  const options = cause === undefined ? undefined : { cause }
  /** Attach identity to the native error itself so type, stack and original cause remain intact. */
  const error =
    code === UtilsErrorCode.configLimitExceeded
      ? new RangeError(message, options)
      : new TypeError(message, options)
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}
