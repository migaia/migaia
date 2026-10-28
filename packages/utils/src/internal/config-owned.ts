/** Own, patch and combine configuration roots through one graph engine and metadata owner. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { ConfigArrayMerge } from './config-array-merge.ts'
import {
  CONFIG_DELETE,
  ConfigProfile,
  type IConfigCombineOptions,
  type IConfigLimits,
  type IConfigPatch,
  type IConfigPatchOptions,
  type IConfigRecord,
  type IOwnConfigOptions,
  type IOwnedConfig
} from './config-contract.ts'
import { cloneGraph } from './config-clone.ts'
import { indexConfigPathRules, mergeRecord } from './config-merge.ts'
import {
  ConfigRootReachability,
  primeSharedNodes,
  rebaseCallablePrototypeRoots
} from './config-reachability.ts'
import {
  configError,
  configLimitKeys,
  dangerous,
  defaultLimits,
  metadata,
  resolveLimits
} from './config-state.ts'

/**
 * Deep-copies `value` into an independent config the library owns, so later edits to the caller's
 * object never reach it. Calling it again on an owned config with the same options returns it as
 * is. Throws `CONFIG_UNSUPPORTED` for a non-record root or unsupported values,
 * `CONFIG_LIMIT_EXCEEDED` past the limits and `CONFIG_CONFLICT` for an owned config with different
 * options.
 */
export function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: IOwnConfigOptions
): IOwnedConfig<T> {
  const { profile: requestedProfile, limits: requestedLimits } = options ?? {}
  /** Capture the requested input domain before cloning or checking existing metadata. */
  const profile = requestedProfile ?? ConfigProfile.data
  /** This call retains its normalized resource budgets throughout graph admission. */
  const limits = resolveLimits(requestedLimits)
  /** Reuse the exact prior ownership or graph identity before descending into the value again. */
  const existing = metadata.get(value as object)
  if (existing) {
    if (existing.profile !== profile)
      throw configError(
        UtilsErrorCode.configConflict,
        'config',
        ConfigReason.ownershipMetadataDiffers
      )
    /** Compare every normalized own key in declaration order without allocating a key array. */
    for (const key in limits) {
      if (!Object.hasOwn(limits, key)) continue
      if (existing.limits[key as keyof IConfigLimits] !== limits[key as keyof IConfigLimits])
        throw configError(
          UtilsErrorCode.configConflict,
          'config',
          ConfigReason.ownershipMetadataDiffers
        )
    }
    return value as IOwnedConfig<T>
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw configError(UtilsErrorCode.configUnsupported, 'root', ConfigReason.plainRecordRequired)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol')
      throw configError(UtilsErrorCode.configUnsupported, 'root', ConfigReason.symbolKeyUnsupported)
  }
  /** Only a complete clone or merge result is published with ownership metadata. */
  const result = cloneGraph(value, profile, limits)
  metadata.set(result, { profile, limits })
  return result as IOwnedConfig<T>
}

/**
 * Creates a new owned config from `base` with root keys replaced or removed (`CONFIG_DELETE`);
 * unchanged subtrees are shared and `base` stays as it was. Only root keys are patched: compute a
 * changed nested subtree with `set` first. Throws `CONFIG_UNSUPPORTED` for an unowned base or
 * invalid patch and `CONFIG_PATH_INVALID` for dangerous keys.
 */
export function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: IConfigPatchOptions
): IOwnedConfig<T> {
  const {
    profile: requestedProfile,
    limits: requestedLimits,
    reuseUnchangedRoot = true
  } = options ?? {}
  /** The base identity alone supplies the patch profile and maximum permitted budgets. */
  const baseMeta = metadata.get(base as object)
  if (!baseMeta)
    throw configError(UtilsErrorCode.configUnsupported, 'config', ConfigReason.valueNotOwned)
  if (requestedProfile !== undefined && requestedProfile !== baseMeta.profile)
    throw configError(UtilsErrorCode.configConflict, 'profile', ConfigReason.profileDiffers)
  if (requestedLimits) {
    /** Snapshot all supplied limit values before comparing, matching Object.entries observation. */
    const entries = Object.entries(requestedLimits)
    for (const [key, value] of entries)
      if (value !== undefined && value > baseMeta.limits[key as keyof IConfigLimits])
        throw configError(
          UtilsErrorCode.configConflict,
          'limits',
          ConfigReason.patchLimitsCannotWiden
        )
  }
  if (patch === null || typeof patch !== 'object')
    throw configError(UtilsErrorCode.configUnsupported, 'patch', ConfigReason.plainRecordRequired)
  /** Capture the intrinsic prototype before observing the patch's prototype trap, as before. */
  const plainPrototype = Object.prototype
  /** Prototype admission has exactly two accepted identities, fixed by the plain-record contract. */
  const patchPrototype = Object.getPrototypeOf(patch)
  if (patchPrototype !== plainPrototype && patchPrototype !== null)
    throw configError(UtilsErrorCode.configUnsupported, 'patch', ConfigReason.plainRecordRequired)
  /** Snapshot the patch key order before constructing its unpublished replacement root. */
  const keys = Reflect.ownKeys(patch)
  if (keys.length === 0 && reuseUnchangedRoot) return base
  /** The unpublished root retains the base prototype and shares only safe existing subgraphs. */
  const next: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(base))
  for (const key of Reflect.ownKeys(base)) {
    /** Copy the original root descriptor without reading its value through a getter. */
    const baseDescriptor = Object.getOwnPropertyDescriptor(base, key)
    if (baseDescriptor) Object.defineProperty(next, key, baseDescriptor)
  }
  for (const key of keys) {
    if (dangerous.has(key))
      throw configError(UtilsErrorCode.configPathInvalid, String(key), ConfigReason.dangerousKey)
    if (typeof key === 'symbol')
      throw configError(
        UtilsErrorCode.configUnsupported,
        'patch',
        ConfigReason.symbolKeyUnsupported
      )
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(patch, key)
    if (!descriptor || !('value' in descriptor))
      throw configError(
        UtilsErrorCode.configUnsupported,
        String(key),
        ConfigReason.accessorUnsupported
      )
    /** This edge value is captured once before deletion, rebasing or graph projection. */
    const value = patch[key]
    if (value === CONFIG_DELETE) delete next[key]
    else next[key] = value
  }
  /** One clone memo rebases root cycles and preserves aliases across every patched property. */
  const seen = new WeakMap<object, object>()
  seen.set(base as object, next)
  seen.set(patch as object, next)
  /** One reverse graph traversal replaces a reachability search for every source property. */
  const rootReachability = new ConfigRootReachability(base)
  primeSharedNodes(base, base, seen, rootReachability)
  for (const key of Reflect.ownKeys(base)) {
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(base, key)
    if (!descriptor || !('value' in descriptor)) continue
    if (descriptor.value === base) {
      Object.defineProperty(next, key, { ...descriptor, value: next })
    } else if (rootReachability.has(descriptor.value)) {
      Object.defineProperty(next, key, {
        ...descriptor,
        value: cloneGraph(
          descriptor.value,
          baseMeta.profile,
          requestedLimits
            ? resolveLimits({ ...baseMeta.limits, ...requestedLimits })
            : baseMeta.limits,
          seen
        )
      })
    }
  }
  for (const key of Reflect.ownKeys(next)) {
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(next, key)
    if (!descriptor || !('value' in descriptor)) continue
    /** This edge value is captured once before deletion, rebasing or graph projection. */
    const value = descriptor.value === base ? next : descriptor.value
    Object.defineProperty(next, key, {
      ...descriptor,
      value: value === descriptor.value ? value : value
    })
  }
  rebaseCallablePrototypeRoots(next, base)
  for (const key of keys) {
    /** Reinspect the original patch descriptor at the preserved cloning observation point. */
    const patchDescriptor = Object.getOwnPropertyDescriptor(patch, key)
    if (
      !patchDescriptor ||
      !('value' in patchDescriptor) ||
      patchDescriptor.value === CONFIG_DELETE
    )
      continue
    Object.defineProperty(next, key, {
      ...patchDescriptor,
      value: cloneGraph(
        patchDescriptor.value,
        baseMeta.profile,
        requestedLimits
          ? resolveLimits({ ...baseMeta.limits, ...requestedLimits })
          : baseMeta.limits,
        seen
      )
    })
  }
  metadata.set(next, {
    profile: baseMeta.profile,
    limits: requestedLimits
      ? resolveLimits({ ...baseMeta.limits, ...requestedLimits })
      : baseMeta.limits
  })
  return next as IOwnedConfig<T>
}

/** Combines owned roots in source order using explicit record conflict policy. */
export function combineConfig(
  sources: readonly IOwnedConfig<IConfigRecord>[],
  options?: IConfigCombineOptions
): IOwnedConfig<IConfigRecord> {
  const {
    profile: requestedProfile,
    limits: requestedLimits,
    strategies,
    pathRules,
    onConflict
  } = options ?? {}
  /** Metadata reads complete before ownership admission, preserving the original source observation. */
  const metas = sources.map((source) => metadata.get(source as object))
  for (let index = 0; index < metas.length; index++) {
    if (!(index in metas)) continue
    /** Native some skipped absent source slots after completing the metadata snapshot. */
    const meta = metas[index]
    if (!meta)
      throw configError(UtilsErrorCode.configUnsupported, 'sources', ConfigReason.sourceNotOwned)
  }
  /** The requested profile wins only when every already-admitted source has that exact profile. */
  const profile = requestedProfile ?? metas[0]?.profile ?? ConfigProfile.data
  for (let index = 0; index < metas.length; index++) {
    if (!(index in metas)) continue
    /** Source profiles are compared only after all present metadata entries were admitted. */
    const meta = metas[index]
    if (meta!.profile !== profile)
      throw configError(UtilsErrorCode.configConflict, 'profile', ConfigReason.sourceProfilesDiffer)
  }
  if (
    sources.length === 1 &&
    requestedProfile === undefined &&
    requestedLimits === undefined &&
    strategies === undefined &&
    pathRules === undefined &&
    onConflict === undefined
  )
    return sources[0]
  /** Compute the strictest source budget field once in input order before merging. */
  const sourceLimits = metas.reduce<Record<keyof IConfigLimits, number>>(
    (minimum, meta) => {
      if (!meta) return minimum
      for (const key of configLimitKeys) minimum[key] = Math.min(minimum[key], meta.limits[key])
      return minimum
    },
    { ...defaultLimits }
  )
  /** This call retains its normalized resource budgets throughout graph admission. */
  const limits: IConfigLimits = requestedLimits
    ? resolveLimits(
        Object.fromEntries(
          configLimitKeys.map((key) => [
            key,
            Math.min(sourceLimits[key], requestedLimits[key] ?? sourceLimits[key])
          ])
        ) as Partial<IConfigLimits>
      )
    : sourceLimits
  /** Only a complete clone or merge result is published with ownership metadata. */
  const result: Record<PropertyKey, unknown> = Object.create(null)
  /** One call owns every array builder, including aliases and arrays copied inside graph nodes. */
  const arrays = new ConfigArrayMerge()
  /** All source merges share one immutable input snapshot and advance its prefix cursor. */
  const ruleIndex = indexConfigPathRules(pathRules)
  for (const source of sources)
    mergeRecord(
      result,
      source,
      strategies,
      onConflict,
      [],
      ruleIndex,
      source,
      new WeakMap<object, object>(),
      profile,
      limits,
      arrays
    )
  arrays.finish()
  return ownConfig(result, { profile, limits })
}
