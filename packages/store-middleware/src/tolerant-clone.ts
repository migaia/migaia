/**
 * ClonePolicy — three explicit, differently-guaranteed ways to hand a caller "a copy" of a value,
 * instead of one fuzzy `clone()` that quietly decides how hard to try. Each mode's name is its
 * contract:
 *
 * - `immutable`: a real independent deep copy, or an explicit throw. Never silently aliases a subtree
 *   it couldn't clone — a caller relying on independence (e.g. "this is the _old_ value, it must
 *   never change again") is entitled to find out when that guarantee cannot be met, rather than get
 *   a live reference back with a straight face.
 * - `opaque`: no copy at all. For callers who already know part of their state is not cloneable and
 *   have decided aliasing is fine (or who just want the cheapest possible "snapshot" and accept the
 *   tradeoff explicitly, by choosing this mode).
 * - `diagnostic`: best-effort, never throws. Used by middleware/devtools event recording, where
 *   availability beats strictness — a debugging tool that crashes on an unusual value in the tree
 *   is worse than one that reports a value it could not fully isolate. Cloneable parts of the tree
 *   still get real, independent copies; only the non-cloneable subtree itself is kept by
 *   reference.
 */
export type IClonePolicyMode = 'immutable' | 'opaque' | 'diagnostic'

import { createStoreMiddlewareError } from './errors.js'
import { StoreMiddlewareErrorCode } from './error-code.js'
import { StoreMiddlewareErrorText } from './error-text.js'
import {
  identitySnapshot,
  immutableSnapshot,
  structuredDiagnosticSnapshot
} from '@migaia/utils/object'
import { UtilsErrorCode } from '@migaia/utils/error'

/**
 * Real independent copy, or throw. Prefers `structuredClone`; the engine not having it at all is
 * itself a reason to refuse rather than guess.
 */
export function immutableSnapshotClone<T>(value: T): T {
  try {
    return immutableSnapshot(value)
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined
    if (errorCode === UtilsErrorCode.envUnsupported)
      throw createStoreMiddlewareError(
        StoreMiddlewareErrorCode.envUnsupported,
        StoreMiddlewareErrorText.immutableClone
      )
    const cause =
      errorCode === UtilsErrorCode.cloneUnsupported &&
      typeof error === 'object' &&
      error !== null &&
      'cause' in error
        ? (error as { readonly cause?: unknown }).cause
        : error
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.cloneUnsupported,
      StoreMiddlewareErrorText.cloneUnsupported,
      { cause }
    )
  }
}

/** No copy. The returned value is the same reference — the caller has opted out of independence. */
export function opaqueReferenceClone<T>(value: T): T {
  return identitySnapshot(value)
}

/**
 * Best-effort snapshot used by diagnostics and middleware. Structured cloning is preferred, but a
 * non-cloneable raw value (a function, a DOM handle, a host object embedded somewhere in the tree)
 * must never break the binding.
 *
 * The fallback used to copy only the _top_ level: `output[key] = descriptor.value` for a nested
 * object just copies the reference. A "previous" snapshot captured for a middleware event, or a
 * devtools time-travel entry, would then share its nested objects with the live store — the next
 * business mutation of `state.a.b` silently rewrites the "snapshot" you already reported as the
 * _old_ value too, which defeats the entire point of taking one. The fallback recurses through
 * plain objects/arrays and only stops at the actual non-cloneable value, so everything cloneable
 * around it still gets a real, independent copy.
 */
export function diagnosticClone<T>(value: T): T {
  return structuredDiagnosticSnapshot(value).value
}

export const ClonePolicy = {
  immutable: immutableSnapshotClone,
  opaque: opaqueReferenceClone,
  diagnostic: diagnosticClone
} as const

/** @deprecated Use `ClonePolicy.diagnostic` (or `diagnosticClone`) — same behavior, explicit name. */
export const tolerantClone = diagnosticClone
