/** Clone one owned graph with shared alias identity and resource budgets; no ownership publication. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { ConfigProfile, type IConfigLimits, type IConfigProfile } from './config-contract.ts'
import { configError, dangerous, hasBuiltinBrand, intrinsicPrototypes } from './config-state.ts'
import type { ConfigArrayMerge } from './config-array-merge.ts'

/** Native construction probe preserves the original failure policy without a local callback. */
export function isConfigConstructable(value: Function): boolean {
  try {
    Reflect.construct(Object, [], value)
    return true
  } catch {
    return false
  }
}

/**
 * Create a dynamic-receiver callable; only its original source is retained by the returned
 * callback.
 */
function createConfigCallable(
  source: (...args: unknown[]) => unknown,
  constructable: boolean
): (...args: unknown[]) => unknown {
  if (constructable)
    return function (this: unknown, ...args: unknown[]): unknown {
      if (new.target) return Reflect.construct(source, args, new.target)
      return Reflect.apply(source, this, args)
    }
  return function (this: unknown, ...args: unknown[]): unknown {
    return Reflect.apply(source, this, args)
  }
}

/** Copies custom data properties from built-ins after their internal slots are recreated. */
function copyOwnDataDescriptors(
  source: object,
  target: object,
  limits: IConfigLimits,
  profile: IConfigProfile,
  seen: WeakMap<object, object>,
  depth: number,
  state: { nodes: number; keys: number },
  arrays?: ConfigArrayMerge
): void {
  for (const key of Reflect.ownKeys(source)) {
    state.keys++
    if (state.keys > limits.maxKeys)
      throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', ConfigReason.graphKeys)
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor))
      throw configError(
        UtilsErrorCode.configUnsupported,
        String(key),
        ConfigReason.accessorUnsupported
      )
    Object.defineProperty(target, key, {
      ...descriptor,
      value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state, false, arrays)
    })
  }
}

/** Clone callable own data and prototype while preserving call/construct receiver semantics. */
function cloneCallable(
  value: (...args: unknown[]) => unknown,
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen: WeakMap<object, object>,
  depth: number,
  state: { nodes: number; keys: number },
  arrays?: ConfigArrayMerge
): (...args: unknown[]) => unknown {
  if (profile === ConfigProfile.data)
    throw configError(
      UtilsErrorCode.configUnsupported,
      'value',
      ConfigReason.functionRequiresRichRuntime
    )
  /** The original callable or pattern stays available without changing dynamic receiver semantics. */
  const source = value
  /** Construction admission reads the original prototype data descriptor once. */
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(source, 'prototype')
  /** The native construction probe determines whether the wrapper must preserve new.target. */
  const constructable = isConfigConstructable(source)
  if (constructable && (!prototypeDescriptor || !('value' in prototypeDescriptor)))
    throw configError(
      UtilsErrorCode.configUnsupported,
      'prototype',
      ConfigReason.callablePrototypeRequired
    )
  /** Register the callable clone before copying its graph so recursive aliases resolve to it. */
  const wrapper = createConfigCallable(source, constructable)
  seen.set(value, wrapper)
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor) || descriptor.configurable === false)
      throw configError(
        UtilsErrorCode.configUnsupported,
        String(key),
        ConfigReason.callablePropertyUnsupported
      )
    Object.defineProperty(wrapper, key, {
      ...descriptor,
      value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state, false, arrays)
    })
  }
  if (constructable && prototypeDescriptor && 'value' in prototypeDescriptor) {
    /** The callable prototype participates in the same clone memo as its other graph edges. */
    const clonedPrototype = cloneGraph(
      prototypeDescriptor.value,
      profile,
      limits,
      seen,
      depth + 1,
      state,
      true,
      arrays
    )
    Object.defineProperty(wrapper, 'prototype', {
      ...prototypeDescriptor,
      value: clonedPrototype
    })
  }
  return wrapper
}

/** Clone one graph node using explicit identity and budget context; no component state is captured. */
export function cloneGraph<T>(
  value: T,
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen = new WeakMap<object, object>(),
  depth = 0,
  state: { nodes: number; keys: number } = { nodes: 0, keys: 0 },
  allowConstructorKey = false,
  arrays?: ConfigArrayMerge
): T {
  if (Array.isArray(value) && arrays?.has(value)) return value
  if (depth > limits.maxDepth)
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxDepth', ConfigReason.graphDepth)
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    /** Reuse the exact prior ownership or graph identity before descending into the value again. */
    const existing = seen.get(value as object)
    if (existing) return existing as T
  }
  if (typeof value === 'function')
    return cloneCallable(
      value as (...args: unknown[]) => unknown,
      profile,
      limits,
      seen,
      depth,
      state,
      arrays
    ) as T
  if (value === null || typeof value !== 'object') return value
  state.nodes++
  if (state.nodes > limits.maxNodes)
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxNodes', ConfigReason.graphNodes)
  if (hasBuiltinBrand(value, 'date')) {
    /** Preserve the source subclass constructor when recreating native internal slots. */
    const constructor = Object.getPrototypeOf(value)?.constructor
    /** Capture the original native Date time before creating its independent slot owner. */
    const time = Reflect.apply(Date.prototype.getTime, value, [])
    /** Publish this native-slot clone into the memo before visiting its custom graph properties. */
    const copy =
      typeof constructor === 'function' && constructor !== Date
        ? Reflect.construct(Date, [time], constructor)
        : new Date(time)
    seen.set(value as object, copy)
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    return copy as T
  }
  if (hasBuiltinBrand(value, 'regexp')) {
    /** Preserve the source subclass constructor when recreating native internal slots. */
    const constructor = Object.getPrototypeOf(value)?.constructor
    /** Read the intrinsic RegExp source accessor with its required native receiver. */
    const sourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
    /** Read the intrinsic RegExp flags accessor only at the original observation point. */
    const flagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get
    /** The original callable or pattern stays available without changing dynamic receiver semantics. */
    const source = sourceGetter ? Reflect.apply(sourceGetter, value, []) : ''
    /** Capture native RegExp flags without replacing its pattern or observable matching behavior. */
    const flags = flagsGetter ? Reflect.apply(flagsGetter, value, []) : ''
    /** Publish this native-slot clone into the memo before visiting its custom graph properties. */
    const copy =
      typeof constructor === 'function' && constructor !== RegExp
        ? Reflect.construct(RegExp, [source, flags], constructor)
        : new RegExp(source, flags)
    seen.set(value as object, copy)
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    return copy as T
  }
  if (hasBuiltinBrand(value, 'map')) {
    /** Preserve the source subclass constructor when recreating native internal slots. */
    const constructor = Object.getPrototypeOf(value)?.constructor
    /** Native iteration preserves this collection edge order while retaining exact node identities. */
    const entries = Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      readonly [unknown, unknown]
    >
    /** Publish this native-slot clone into the memo before visiting its custom graph properties. */
    const copy =
      typeof constructor === 'function' && constructor !== Map
        ? Reflect.construct(Map, [], constructor)
        : new Map()
    seen.set(value as object, copy)
    for (const [key, entry] of entries)
      if (++state.keys > limits.maxKeys)
        throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', ConfigReason.graphEntries)
      else
        copy.set(
          cloneGraph(key, profile, limits, seen, depth + 1, state, false, arrays),
          cloneGraph(entry, profile, limits, seen, depth + 1, state, false, arrays)
        )
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    /** The existing prototype determines native subclass preservation and graph aliasing. */
    const sourcePrototype = Object.getPrototypeOf(value)
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true, arrays)
      )
    return copy as T
  }
  if (hasBuiltinBrand(value, 'set')) {
    /** Preserve the source subclass constructor when recreating native internal slots. */
    const constructor = Object.getPrototypeOf(value)?.constructor
    /** Publish this native-slot clone into the memo before visiting its custom graph properties. */
    const copy =
      typeof constructor === 'function' && constructor !== Set
        ? Reflect.construct(Set, [], constructor)
        : new Set()
    seen.set(value as object, copy)
    /** Native iteration preserves this collection edge order while retaining exact node identities. */
    const entries = Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>
    for (const entry of entries) {
      if (++state.keys > limits.maxKeys)
        throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', ConfigReason.graphEntries)
      copy.add(cloneGraph(entry, profile, limits, seen, depth + 1, state, false, arrays))
    }
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    /** The existing prototype determines native subclass preservation and graph aliasing. */
    const sourcePrototype = Object.getPrototypeOf(value)
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true, arrays)
      )
    return copy as T
  }
  /** The existing prototype determines native subclass preservation and graph aliasing. */
  const sourcePrototype = Object.getPrototypeOf(value)
  /** Register the empty container before copying prototypes and own descriptors with back edges. */
  const target = Array.isArray(value) ? [] : Object.create(null)
  seen.set(value as object, target)
  if (Array.isArray(target)) arrays?.track(target)
  if (sourcePrototype === null || intrinsicPrototypes.has(sourcePrototype))
    Object.setPrototypeOf(target, sourcePrototype)
  else
    Object.setPrototypeOf(
      target,
      cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true, arrays)
    )
  for (const key of Reflect.ownKeys(value as object)) {
    state.keys++
    if (state.keys > limits.maxKeys)
      throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', ConfigReason.graphKeys)
    if (
      typeof key === 'string' &&
      dangerous.has(key) &&
      !(allowConstructorKey && key === 'constructor')
    )
      throw configError(UtilsErrorCode.configUnsupported, key, ConfigReason.dangerousKey)
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key)!
    if (!('value' in descriptor))
      throw configError(
        UtilsErrorCode.configUnsupported,
        String(key),
        ConfigReason.accessorUnsupported
      )
    /** Graph admission stays shared; only this call's array descriptor flags are provisional. */
    const clonedDescriptor = {
      ...descriptor,
      value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state, false, arrays)
    }
    if (arrays && Array.isArray(target)) arrays.define(target, key, clonedDescriptor)
    else Object.defineProperty(target, key, clonedDescriptor)
  }
  return target as T
}
