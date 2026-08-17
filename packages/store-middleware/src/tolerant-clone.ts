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
export type IClonePolicyMode = 'immutable' | 'opaque' | 'diagnostic';

import { createStoreMiddlewareError } from './errors.js';
import { StoreMiddlewareErrorCode } from './error-code.js';

/**
 * Real independent copy, or throw. Prefers `structuredClone`; the engine not having it at all is
 * itself a reason to refuse rather than guess.
 */
export function immutableSnapshotClone<T>(value: T): T {
  if (typeof structuredClone !== 'function') {
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.envUnsupported,
      '[store] ClonePolicy.immutable requires structuredClone support in this environment'
    );
  }
  try {
    return structuredClone(value);
  } catch (error) {
    throw createStoreMiddlewareError(
      StoreMiddlewareErrorCode.cloneUnsupported,
      '[store] value contains something structuredClone cannot copy independently (e.g. a function, DOM handle, or class instance); use ClonePolicy.diagnostic or ClonePolicy.opaque instead',
      { cause: error }
    );
  }
}

/** No copy. The returned value is the same reference — the caller has opted out of independence. */
export function opaqueReferenceClone<T>(value: T): T {
  return value;
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
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Something in the tree is not cloneable — fall through to the
      // recursive fallback, which isolates exactly that value by reference
      // instead of giving up on the whole tree.
    }
  }
  return fallbackClone(value, new WeakMap()) as T;
}

function fallbackClone(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const item of value) output.push(fallbackClone(item, seen));
    return output;
  }

  // Anything that isn't a plain object (Map, Set, Date, RegExp, a class
  // instance, a Proxy, a host object) is exactly the kind of value
  // structuredClone already tried and this codec cannot safely reconstruct.
  // Keep it by reference rather than inventing a lossy plain-object stand-in
  // that silently drops its prototype, accessors, and methods.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const output: Record<PropertyKey, unknown> = Object.create(prototype);
  seen.set(value, output);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    // An accessor descriptor has no `value` — structuredClone itself reads
    // (not preserves) an accessor's current value into a plain data
    // property on the clone. Matching that instead of skipping the key
    // outright keeps this fallback path from silently dropping the
    // property when the primary path would have kept its value.
    const raw =
      'value' in descriptor ? descriptor.value : (value as Record<PropertyKey, unknown>)[key];
    const cloned = fallbackClone(raw, seen);
    if (key === '__proto__') {
      Object.defineProperty(output, key, {
        value: cloned,
        enumerable: true,
        writable: true,
        configurable: true
      });
    } else {
      output[key] = cloned;
    }
  }
  return output;
}

export const ClonePolicy = {
  immutable: immutableSnapshotClone,
  opaque: opaqueReferenceClone,
  diagnostic: diagnosticClone
} as const;

/** @deprecated Use `ClonePolicy.diagnostic` (or `diagnosticClone`) — same behavior, explicit name. */
export const tolerantClone = diagnosticClone;
