import { isImmutableSnapshotData } from './immutable-data.js'
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
 * Return an independent native structured clone of admitted data without freezing the result. Plain
 * records/arrays, current-realm native Map/Set/Date/RegExp and non-shared buffer/view storage are
 * supported, including cycles and shared graph identity. Custom classes/accessors are rejected
 * before cloning. Unsupported input throws CLONE_UNSUPPORTED; missing structuredClone throws
 * ENV_UNSUPPORTED. Caught admission/clone failures remain reachable as cause.
 */
export function immutableSnapshotClone<T>(value: T): T {
  /** Admission is policy-owned here; Utils remains the single graph-cloning owner. */
  let admitted: boolean
  try {
    admitted = isImmutableSnapshotData(value)
  } catch (error) {
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.cloneUnsupported,
      StoreMiddlewareErrorText.cloneUnsupported,
      { cause: error }
    )
  }
  if (!admitted)
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.cloneUnsupported,
      StoreMiddlewareErrorText.cloneUnsupported
    )
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
        StoreMiddlewareErrorText.immutableClone,
        { cause: error }
      )
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.cloneUnsupported,
      StoreMiddlewareErrorText.cloneUnsupported,
      { cause: error }
    )
  }
}

/** No copy. The returned value is the same reference — the caller has opted out of independence. */
export function opaqueReferenceClone<T>(value: T): T {
  return identitySnapshot(value)
}

/**
 * Return a best-effort, unfrozen diagnostic copy through the shared structured-clone-first owner.
 * Fallback copies inspectable plain objects/arrays recursively and retains unsupported or unsafe
 * subtrees by reference. It favors a usable diagnostic over strict independence; no deep-history
 * guarantee follows for aliased subtrees. The companion diagnostic details are not returned here.
 */
export function diagnosticClone<T>(value: T): T {
  return structuredDiagnosticSnapshot(value).value
}

/** Explicit clone functions from this subentry; no mode is selected implicitly by this object. */
export const ClonePolicy = {
  /** Independent admitted data copy or a classified failure; does not freeze the result. */
  immutable: immutableSnapshotClone,
  /** Exact input identity, with no copying or freezing. */
  opaque: opaqueReferenceClone,
  /** Best-effort diagnostic copy that may retain unsupported subtrees by reference. */
  diagnostic: diagnosticClone
} as const
