/** Owned configuration admission, snapshots and source-ordered merge policy. */
import { ERROR_SOURCE, UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { ConfigArrayMerge } from './internal/config-array-merge.js'
import { parseObjectPath, probeObjectPath, type IObjectPathTupleFor } from './object-path.js'

/**
 * Input domains of an owned config: `data` (default) accepts portable plain data and rejects
 * functions; `richRuntime` also accepts functions and classes for configs that carry callbacks.
 */
export const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const
/** Value union of `ConfigProfile`. */
export type IConfigProfile = (typeof ConfigProfile)[keyof typeof ConfigProfile]
/**
 * Patch value meaning "delete this root key" in `patchConfig` and conflict decisions of
 * `combineConfig`.
 */
export const CONFIG_DELETE: unique symbol = Symbol('CONFIG_DELETE')
/** Config root shape: a plain record with string keys (symbol keys are rejected at runtime). */
export type IConfigRecord = Record<PropertyKey, unknown>
/**
 * Config accepted by `ownConfig`. Ownership is tracked at runtime, so an object that only carries
 * this type is still rejected by `readonlyConfig`, `patchConfig`, `readConfigPath` and
 * `combineConfig`.
 */
export type IOwnedConfig<T extends IConfigRecord> = T & {
  readonly __utilsOwnedConfigBrand?: unique symbol
}
/**
 * Safety limits of a config graph (defaults: depth 256, nodes 100000, keys 1000000, path length
 * 4096, segment length 512). They can only be tightened; exceeding one throws
 * `CONFIG_LIMIT_EXCEEDED`.
 */
export type IConfigLimits = {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxKeys: number
  readonly maxPathLength: number
  readonly maxSegmentLength: number
}
/** Options of `ownConfig`: the input `profile` and tighter `limits`. */
export type IOwnConfigOptions = {
  readonly profile?: IConfigProfile
  readonly limits?: Partial<IConfigLimits>
}
/** Root-level patch for `patchConfig`; a key set to `CONFIG_DELETE` is removed. */
export type IConfigPatch<T extends IConfigRecord> = {
  readonly [K in keyof T]?: T[K] | typeof CONFIG_DELETE
} & Readonly<Record<PropertyKey, unknown>>
/**
 * Options of `patchConfig`. `reuseUnchangedRoot` (default `true`) returns the base itself for an
 * empty patch; `profile` must match the base and `limits` may only tighten it.
 */
export type IConfigPatchOptions = IOwnConfigOptions & { readonly reuseUnchangedRoot?: boolean }
/**
 * Result of `readConfigPath`: `missing` when the key does not exist, otherwise the (possibly
 * `undefined`) value.
 */
export type IConfigReadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: unknown }
/**
 * How `combineConfig` merges each kind of value. Defaults: records `merge`, arrays / maps / sets
 * `replace`, and an explicit right-side `undefined` is `ignore`d.
 */
export type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace'
  readonly array: 'replace' | 'concat' | 'mergeByIndex'
  readonly map: 'replace' | 'merge'
  readonly set: 'replace' | 'union'
  readonly undefined: 'ignore' | 'assign'
}
/**
 * What `onConflict` returns: keep `left`, take `right`, `delete` the key, or use a replacement
 * `value`.
 */
export type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown }
/** Arguments of `onConflict`: the key `path` plus the existing `left` and incoming `right` values. */
export type IConfigConflictContext = {
  readonly path: readonly PropertyKey[]
  readonly left: unknown
  readonly right: unknown
}
/**
 * Merge strategies for keys under one path `prefix`; the longest matching prefix wins and equal
 * prefixes retain declaration order. Each description is captured once per combineConfig call;
 * accessors that return changing descriptions are not supported.
 */
export type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[]
  readonly strategies: Partial<IConfigMergeStrategies>
}
/**
 * Options of `combineConfig`: global `strategies`, per-prefix `pathRules`, and a synchronous
 * `onConflict` for values that cannot be merged automatically. Array conflicts observe the current
 * accumulated contents; a retained accumulator reference receives later array merges in this call.
 * Callbacks read accumulated arrays and return decisions; directly mutating those arrays is
 * unsupported. Resolver-selected graphs are captured when accepted so their nested arrays are
 * private builders.
 */
export type IConfigCombineOptions = IOwnConfigOptions & {
  readonly strategies?: Partial<IConfigMergeStrategies>
  readonly pathRules?: readonly IConfigPathRule[]
  readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision
}

/** One prefix node keeps the first declared rule and indexes each next path segment once. */
type IConfigPathRuleIndex = {
  /** Exact segment identity preserves the existing string/symbol prefix matching contract. */
  readonly children: Map<PropertyKey, IConfigPathRuleIndex>
  /** Captured input strategies never reread an accessor while merging later source properties. */
  strategies?: Partial<IConfigMergeStrategies>
}

const defaultLimits: IConfigLimits = {
  maxDepth: 256,
  maxNodes: 100_000,
  maxKeys: 1_000_000,
  maxPathLength: 4096,
  maxSegmentLength: 512
}
const metadata = new WeakMap<
  object,
  { readonly profile: IConfigProfile; readonly limits: IConfigLimits }
>()
const readonlyCache = new WeakMap<object, object>()
const readonlyRawCache = new WeakMap<object, object>()
const dangerous = new Set<PropertyKey>(['__proto__', 'prototype', 'constructor'])
/** Detects built-in internal slots without mistaking subclass prototype objects for instances. */
const hasBuiltinBrand = (value: object, kind: 'date' | 'regexp' | 'map' | 'set'): boolean => {
  try {
    if (kind === 'date') Reflect.apply(Date.prototype.getTime, value, [])
    else if (kind === 'regexp') {
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
const intrinsicPrototypes = new Set<object>([
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
  const profile = requestedProfile ?? ConfigProfile.data
  const limits = resolveLimits(requestedLimits)
  const existing = metadata.get(value as object)
  if (existing) {
    if (
      existing.profile !== profile ||
      Object.keys(limits).some(
        (key) => existing.limits[key as keyof IConfigLimits] !== limits[key as keyof IConfigLimits]
      )
    )
      throw configError(UtilsErrorCode.configConflict, 'config', 'ownership metadata differs')
    return value as IOwnedConfig<T>
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw configError(UtilsErrorCode.configUnsupported, 'root', 'plain record required')
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol')
      throw configError(UtilsErrorCode.configUnsupported, 'root', 'symbol key is not supported')
  }
  const result = cloneGraph(value, profile, limits)
  metadata.set(result, { profile, limits })
  return result as IOwnedConfig<T>
}

/**
 * Returns a cached read-only view of an owned config. Every write, including `Map` / `Set` / `Date`
 * mutators and nested values, throws a `TypeError` with `CONFIG_READONLY`; reads see the owned data
 * without copying it. Throws `CONFIG_UNSUPPORTED` when `value` did not come from `ownConfig`.
 */
export function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T {
  if (!metadata.has(value as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned')
  return readonlyWrap(value) as T
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
  const baseMeta = metadata.get(base as object)
  if (!baseMeta) throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned')
  if (requestedProfile !== undefined && requestedProfile !== baseMeta.profile)
    throw configError(UtilsErrorCode.configConflict, 'profile', 'profile differs from base')
  if (
    requestedLimits &&
    Object.entries(requestedLimits).some(
      ([key, value]) => value !== undefined && value > baseMeta.limits[key as keyof IConfigLimits]
    )
  )
    throw configError(
      UtilsErrorCode.configConflict,
      'limits',
      'patch limits cannot widen base limits'
    )
  if (
    patch === null ||
    typeof patch !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(patch))
  )
    throw configError(UtilsErrorCode.configUnsupported, 'patch', 'plain record required')
  const keys = Reflect.ownKeys(patch)
  if (keys.length === 0 && reuseUnchangedRoot) return base
  const next: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(base))
  for (const key of Reflect.ownKeys(base)) {
    const baseDescriptor = Object.getOwnPropertyDescriptor(base, key)
    if (baseDescriptor) Object.defineProperty(next, key, baseDescriptor)
  }
  for (const key of keys) {
    if (dangerous.has(key))
      throw configError(UtilsErrorCode.configPathInvalid, String(key), 'dangerous key')
    if (typeof key === 'symbol')
      throw configError(UtilsErrorCode.configUnsupported, 'patch', 'symbol key is not supported')
    const descriptor = Object.getOwnPropertyDescriptor(patch, key)
    if (!descriptor || !('value' in descriptor))
      throw configError(UtilsErrorCode.configUnsupported, String(key), 'accessor unsupported')
    const value = patch[key]
    if (value === CONFIG_DELETE) delete next[key]
    else next[key] = value
  }
  const seen = new WeakMap<object, object>()
  seen.set(base as object, next)
  seen.set(patch as object, next)
  /** One reverse graph traversal replaces a reachability search for every source property. */
  const rootReachability = new ConfigRootReachability(base)
  primeSharedNodes(base, base, seen, rootReachability)
  for (const key of Reflect.ownKeys(base)) {
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
    const descriptor = Object.getOwnPropertyDescriptor(next, key)
    if (!descriptor || !('value' in descriptor)) continue
    const value = descriptor.value === base ? next : descriptor.value
    Object.defineProperty(next, key, {
      ...descriptor,
      value: value === descriptor.value ? value : value
    })
  }
  rebaseCallablePrototypeRoots(next, base)
  for (const key of keys) {
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

/** Repoints direct old-root edges held by cloned callable prototype objects. */
function rebaseCallablePrototypeRoots(root: Record<PropertyKey, unknown>, oldRoot: object): void {
  /** Several callable properties may share one prototype; inspect each owned prototype once. */
  const visited = new WeakSet<object>()
  for (const key of Reflect.ownKeys(root)) {
    const value = root[key]
    if (typeof value !== 'function') continue
    const prototype = Object.getPrototypeOf(value)
    if (prototype === null || visited.has(prototype)) continue
    visited.add(prototype)
    for (const prototypeKey of Reflect.ownKeys(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, prototypeKey)
      if (descriptor && 'value' in descriptor && descriptor.value === oldRoot)
        Object.defineProperty(prototype, prototypeKey, { ...descriptor, value: root })
    }
  }
}

/** Index the existing reachability grammar once, in O(nodes + edges), including cycles. */
class ConfigRootReachability {
  /** A reverse edge is retained only when the original root search follows that edge kind. */
  #parents = new Map<object, object[]>()
  /** Every node is inspected once while collecting the union of clone-sharing edges. */
  #visited = new Set<object>()
  /** Nodes with a path to the replaced root must be cloned rather than reused. */
  #reaching = new Set<object>()

  /** Collect edges, then propagate root reachability once through reverse adjacency. */
  constructor(root: object) {
    this.#collect(root)
    /** A cursor queue visits each reaching node at most once. */
    const pending: object[] = [root]
    this.#reaching.add(root)
    for (let cursor = 0; cursor < pending.length; cursor++) {
      for (const parent of this.#parents.get(pending[cursor]!) ?? []) {
        if (this.#reaching.has(parent)) continue
        this.#reaching.add(parent)
        pending.push(parent)
      }
    }
  }

  /** Primitive values never participate in graph identity. */
  has(value: unknown): boolean {
    return (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      this.#reaching.has(value)
    )
  }

  /** Collect candidate nodes once while marking the original search's exact semantic edges. */
  #collect(value: unknown): void {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      this.#visited.has(value)
    )
      return
    this.#visited.add(value)
    /** Maps and sets expose only entries to root reachability, but sharing also visits own data. */
    const map = value instanceof Map && hasBuiltinBrand(value, 'map')
    /** Preserve the original brand-checked collection distinction. */
    const set = !map && value instanceof Set && hasBuiltinBrand(value, 'set')
    if (map) {
      for (const [key, entry] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
        readonly [unknown, unknown]
      >) {
        this.#edge(value, key, true)
        this.#edge(value, entry, true)
      }
    } else if (set) {
      for (const entry of Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>)
        this.#edge(value, entry, true)
    }
    for (const key of Reflect.ownKeys(value)) {
      /** Owned graphs contain data descriptors; absent/accessor descriptors are not traversal edges. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && 'value' in descriptor) this.#edge(value, descriptor.value, !map && !set)
    }
    this.#edge(value, Object.getPrototypeOf(value), !map && !set)
  }

  /** Store one reverse edge while also discovering nodes reached only by the sharing traversal. */
  #edge(parent: object, child: unknown, searchable: boolean): void {
    if (child === null || (typeof child !== 'object' && typeof child !== 'function')) return
    if (searchable) {
      /** Append in original traversal order; reachability itself is identity based. */
      const parents = this.#parents.get(child) ?? []
      parents.push(parent)
      this.#parents.set(child, parents)
    }
    this.#collect(child)
  }
}

/** Seeds COW clone state with subgraphs that cannot reach the replaced root. */
function primeSharedNodes(
  value: unknown,
  root: object,
  shared: WeakMap<object, object>,
  rootReachability: ConfigRootReachability,
  visited = new WeakSet<object>()
): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return
  const objectValue = value as object
  if (visited.has(objectValue) || (objectValue !== root && shared.has(objectValue))) return
  visited.add(objectValue)
  if (objectValue !== root && !rootReachability.has(objectValue)) {
    shared.set(objectValue, objectValue)
    return
  }
  if (objectValue instanceof Map && hasBuiltinBrand(objectValue, 'map')) {
    const entries = Reflect.apply(Map.prototype.entries, objectValue, []) as Iterable<
      readonly [unknown, unknown]
    >
    for (const [key, entry] of entries) {
      primeSharedNodes(key, root, shared, rootReachability, visited)
      primeSharedNodes(entry, root, shared, rootReachability, visited)
    }
  } else if (objectValue instanceof Set && hasBuiltinBrand(objectValue, 'set')) {
    const entries = Reflect.apply(Set.prototype.values, objectValue, []) as Iterable<unknown>
    for (const entry of entries) primeSharedNodes(entry, root, shared, rootReachability, visited)
  }
  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
    if (descriptor && 'value' in descriptor)
      primeSharedNodes(descriptor.value, root, shared, rootReachability, visited)
  }
  primeSharedNodes(Object.getPrototypeOf(objectValue), root, shared, rootReachability, visited)
}

/** Applies config limits and string-key policy over the canonical object-path parser. */
export function parseConfigPath(
  path: string,
  limits: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'> = defaultLimits
): readonly string[] {
  if (path.length === 0 || path.length > limits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, path, 'invalid length')
  let parsed: readonly PropertyKey[]
  try {
    parsed = parseObjectPath(path)
  } catch (error) {
    throw configError(UtilsErrorCode.configPathInvalid, path, 'invalid segment', error)
  }
  const sourceSegments = path.split('.')
  const result = parsed.map((segment, index) =>
    typeof segment === 'number' ? /^\[(\d+)\]$/.exec(sourceSegments[index])![1] : String(segment)
  )
  for (const segment of result) {
    if (segment.length > limits.maxSegmentLength || dangerous.has(segment))
      throw configError(UtilsErrorCode.configPathInvalid, segment, 'invalid segment')
  }
  return Object.freeze(result)
}

/** Reads a config path and distinguishes missing from an undefined value. */
export function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult {
  if (!metadata.has(config as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned')
  const segments = typeof path === 'string' ? parseConfigPath(path) : path
  if (segments.length > defaultLimits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, 'path', 'invalid length')
  for (const segment of segments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > defaultLimits.maxSegmentLength ||
      dangerous.has(segment)
    )
      throw configError(UtilsErrorCode.configPathInvalid, String(segment), 'invalid segment')
  }
  const probe = probeObjectPath(config, segments as IObjectPathTupleFor<IConfigRecord>)
  if (probe.kind === 'failed') throw probe.error
  if (probe.kind !== 'value') return { kind: 'missing' }
  const value: unknown = probe.value
  return {
    kind: 'value',
    value:
      value && (typeof value === 'object' || typeof value === 'function')
        ? readonlyWrap(value)
        : value
  }
}

/**
 * Snapshot path-rule descriptors once, in O(total prefix segments + strategy fields). The first
 * declaration at an equal prefix wins, matching the former stable longest-prefix sort. Rules whose
 * accessors return changing descriptions are outside the supported input contract.
 */
function indexConfigPathRules(rules: readonly IConfigPathRule[] | undefined): IConfigPathRuleIndex {
  /** This private explicit context owns only the input index, never configuration graph state. */
  const root: IConfigPathRuleIndex = { children: new Map() }
  /** Equal prefixes keep the earliest declaration, so input order remains observable. */
  for (const rule of rules ?? []) {
    /** Each rule description is read once before any source property is merged. */
    const prefix = rule.prefix
    /** Snapshot even a shadowed rule once; declaration order remains the tie breaker. */
    const strategies = { ...rule.strategies }
    /** Walking a rule visits each of its supplied segments once. */
    let node = root
    /** Every supplied segment advances one exact-key edge of this rule's prefix. */
    for (const segment of prefix) {
      /** Reuse the existing exact-prefix node instead of scanning all rules for each source key. */
      let child = node.children.get(segment)
      if (!child) {
        child = { children: new Map() }
        node.children.set(segment, child)
      }
      node = child
    }
    node.strategies ??= strategies
  }
  return root
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
  const metas = sources.map((source) => metadata.get(source as object))
  if (metas.some((meta) => !meta))
    throw configError(UtilsErrorCode.configUnsupported, 'sources', 'source is not owned')
  const profile = requestedProfile ?? metas[0]?.profile ?? ConfigProfile.data
  if (metas.some((meta) => meta!.profile !== profile))
    throw configError(UtilsErrorCode.configConflict, 'profile', 'sources use different profiles')
  if (
    sources.length === 1 &&
    requestedProfile === undefined &&
    requestedLimits === undefined &&
    strategies === undefined &&
    pathRules === undefined &&
    onConflict === undefined
  )
    return sources[0]
  const sourceLimits = metas.reduce<Record<keyof IConfigLimits, number>>(
    (minimum, meta) => {
      if (!meta) return minimum
      for (const key of Object.keys(defaultLimits) as Array<keyof IConfigLimits>)
        minimum[key] = Math.min(minimum[key], meta.limits[key])
      return minimum
    },
    { ...defaultLimits }
  )
  const limits: IConfigLimits = requestedLimits
    ? resolveLimits(
        Object.fromEntries(
          (Object.keys(defaultLimits) as Array<keyof IConfigLimits>).map((key) => [
            key,
            Math.min(sourceLimits[key], requestedLimits[key] ?? sourceLimits[key])
          ])
        ) as Partial<IConfigLimits>
      )
    : sourceLimits
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

function resolveLimits(overrides?: Partial<IConfigLimits>): IConfigLimits {
  const result = { ...defaultLimits, ...overrides }
  for (const [key, value] of Object.entries(result))
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > defaultLimits[key as keyof IConfigLimits]
    )
      throw configError(UtilsErrorCode.configLimitExceeded, key, 'invalid limit')
  return result
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
      throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', 'graph keys')
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor))
      throw configError(UtilsErrorCode.configUnsupported, String(key), 'accessor unsupported')
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
    throw configError(UtilsErrorCode.configUnsupported, 'value', 'function requires richRuntime')
  const source = value
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(source, 'prototype')
  const constructable = (() => {
    try {
      Reflect.construct(Object, [], source)
      return true
    } catch {
      return false
    }
  })()
  if (constructable && (!prototypeDescriptor || !('value' in prototypeDescriptor)))
    throw configError(UtilsErrorCode.configUnsupported, 'prototype', 'callable prototype required')
  const wrapper = constructable
    ? function (this: unknown, ...args: unknown[]): unknown {
        if (new.target) return Reflect.construct(source, args, new.target)
        return Reflect.apply(source, this, args)
      }
    : function (this: unknown, ...args: unknown[]): unknown {
        return Reflect.apply(source, this, args)
      }
  seen.set(value, wrapper)
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor) || descriptor.configurable === false)
      throw configError(
        UtilsErrorCode.configUnsupported,
        String(key),
        'callable property unsupported'
      )
    Object.defineProperty(wrapper, key, {
      ...descriptor,
      value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state, false, arrays)
    })
  }
  if (constructable && prototypeDescriptor && 'value' in prototypeDescriptor) {
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
function cloneGraph<T>(
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
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxDepth', 'graph depth')
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
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
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxNodes', 'graph nodes')
  if (hasBuiltinBrand(value, 'date')) {
    const constructor = Object.getPrototypeOf(value)?.constructor
    const time = Reflect.apply(Date.prototype.getTime, value, [])
    const copy =
      typeof constructor === 'function' && constructor !== Date
        ? Reflect.construct(Date, [time], constructor)
        : new Date(time)
    seen.set(value as object, copy)
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    return copy as T
  }
  if (hasBuiltinBrand(value, 'regexp')) {
    const constructor = Object.getPrototypeOf(value)?.constructor
    const sourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
    const flagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get
    const source = sourceGetter ? Reflect.apply(sourceGetter, value, []) : ''
    const flags = flagsGetter ? Reflect.apply(flagsGetter, value, []) : ''
    const copy =
      typeof constructor === 'function' && constructor !== RegExp
        ? Reflect.construct(RegExp, [source, flags], constructor)
        : new RegExp(source, flags)
    seen.set(value as object, copy)
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    return copy as T
  }
  if (hasBuiltinBrand(value, 'map')) {
    const constructor = Object.getPrototypeOf(value)?.constructor
    const entries = Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      readonly [unknown, unknown]
    >
    const copy =
      typeof constructor === 'function' && constructor !== Map
        ? Reflect.construct(Map, [], constructor)
        : new Map()
    seen.set(value as object, copy)
    for (const [key, entry] of entries)
      if (++state.keys > limits.maxKeys)
        throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', 'graph entries')
      else
        copy.set(
          cloneGraph(key, profile, limits, seen, depth + 1, state, false, arrays),
          cloneGraph(entry, profile, limits, seen, depth + 1, state, false, arrays)
        )
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    const sourcePrototype = Object.getPrototypeOf(value)
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true, arrays)
      )
    return copy as T
  }
  if (hasBuiltinBrand(value, 'set')) {
    const constructor = Object.getPrototypeOf(value)?.constructor
    const copy =
      typeof constructor === 'function' && constructor !== Set
        ? Reflect.construct(Set, [], constructor)
        : new Set()
    seen.set(value as object, copy)
    const entries = Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>
    for (const entry of entries) {
      if (++state.keys > limits.maxKeys)
        throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', 'graph entries')
      copy.add(cloneGraph(entry, profile, limits, seen, depth + 1, state, false, arrays))
    }
    copyOwnDataDescriptors(value, copy, limits, profile, seen, depth, state, arrays)
    const sourcePrototype = Object.getPrototypeOf(value)
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true, arrays)
      )
    return copy as T
  }
  const sourcePrototype = Object.getPrototypeOf(value)
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
      throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', 'graph keys')
    if (
      typeof key === 'string' &&
      dangerous.has(key) &&
      !(allowConstructorKey && key === 'constructor')
    )
      throw configError(UtilsErrorCode.configUnsupported, key, 'dangerous key')
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key)!
    if (!('value' in descriptor))
      throw configError(UtilsErrorCode.configUnsupported, String(key), 'accessor unsupported')
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

/** Create an independent Proxy target while preserving callable construction and frozen prototypes. */
function readonlyTarget(value: object, callable: boolean): object {
  const constructable = callable
    ? (() => {
        try {
          Reflect.construct(Object, [], value as Function)
          return true
        } catch {
          return false
        }
      })()
    : false
  /** Independent targets allow nested facades even when owned data has frozen descriptors. */
  const target = callable
    ? constructable
      ? function (this: unknown, ...args: unknown[]): unknown {
          return Reflect.apply(value as (...args: unknown[]) => unknown, this, args)
        }
      : (...args: unknown[]) =>
          Reflect.apply(value as (...args: unknown[]) => unknown, undefined, args)
    : Array.isArray(value)
      ? []
      : Object.create(null)
  if (callable && constructable) {
    const sourcePrototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value
    if (sourcePrototype !== undefined)
      Object.defineProperty(target, 'prototype', {
        value: readonlyValue(sourcePrototype),
        writable: true,
        configurable: false
      })
  }
  return target
}

/** One readonly facade owns its raw value, independent target and reflection/iteration behavior. */
class ReadonlyFacade implements ProxyHandler<object> {
  /** The owned raw graph supplies internal slots and original descriptors. */
  #value: object
  /** Callable targets have distinct Proxy invariants for own keys and prototype. */
  #callable: boolean
  /** Independent target permits nested facades for frozen owned descriptors. */
  #target: object
  /** Iteration callbacks must expose this same facade identity. */
  #proxy: object

  /** Build and cache the facade before any later graph traversal can revisit it. */
  constructor(value: object) {
    this.#value = value
    this.#callable = typeof value === 'function'
    this.#target = readonlyTarget(value, this.#callable)
    this.#proxy = new Proxy(this.#target, this)
    readonlyCache.set(value, this.#proxy)
    readonlyRawCache.set(this.#proxy, value)
  }

  /** Return the single facade identity allocated for this owned object. */
  get proxy(): object {
    return this.#proxy
  }

  /** Project a property with the correct built-in receiver and recursively readonly results. */
  get(_target: object, key: string | symbol, receiver: unknown): unknown {
    /** Local aliases expose explicit owner state to short result/event callbacks. */
    const value = this.#value
    /** Callable reflection must use the independent target. */
    const callable = this.#callable
    /** Collection callbacks receive the canonical facade, never its raw graph node. */
    const proxy = this.#proxy

    /** Built-in methods need the owned object's internal slots, never the facade target. */
    const target = value
    if (
      ((target instanceof Map && hasBuiltinBrand(target, 'map')) ||
        (target instanceof Set && hasBuiltinBrand(target, 'set')) ||
        (target instanceof Date && hasBuiltinBrand(target, 'date')) ||
        (target instanceof RegExp && hasBuiltinBrand(target, 'regexp'))) &&
      typeof key === 'string' &&
      [
        'set',
        'add',
        'delete',
        'clear',
        'setDate',
        'setTime',
        'setFullYear',
        'setMonth',
        'setHours',
        'setMinutes',
        'setSeconds',
        'setMilliseconds',
        'setUTCDate',
        'setUTCFullYear',
        'setUTCHours',
        'setUTCMilliseconds',
        'setUTCMinutes',
        'setUTCMonth',
        'setUTCSeconds',
        'setYear'
      ].includes(key)
    )
      return () => {
        throw readonlyMutation()
      }
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'size')
      return target.size
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'size')
      return target.size
    const brandedDate = hasBuiltinBrand(target, 'date')
    const brandedRegExp = hasBuiltinBrand(target, 'regexp')
    if (brandedRegExp && (key === 'exec' || key === 'test')) {
      const sourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
      const flagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get
      const rawSource = sourceGetter ? Reflect.apply(sourceGetter, target, []) : ''
      const rawFlags = flagsGetter ? Reflect.apply(flagsGetter, target, []) : ''
      return (input: string) => {
        const isolated = new RegExp(rawSource, rawFlags)
        return Reflect.apply(
          Reflect.get(isolated, key, isolated) as (...args: unknown[]) => unknown,
          isolated,
          [input]
        )
      }
    }
    if (brandedDate || brandedRegExp) {
      const intrinsicResult = Reflect.get(target, key, target)
      if (typeof intrinsicResult === 'function')
        return (...args: unknown[]) => Reflect.apply(intrinsicResult, target, args)
      return intrinsicResult
    }
    const result = Reflect.get(callable && key !== 'prototype' ? value : target, key, receiver)
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'get')
      return (mapKey: unknown) => readonlyValue(target.get(unwrapReadonly(mapKey)))
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'has')
      return (mapKey: unknown) => target.has(unwrapReadonly(mapKey))
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'has')
      return (setValue: unknown) => target.has(unwrapReadonly(setValue))
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'forEach')
      return (callback: (value: unknown, mapKey: unknown, map: unknown) => void) =>
        target.forEach((mapValue, mapKey) =>
          callback(readonlyValue(mapValue), readonlyValue(mapKey), proxy)
        )
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'forEach')
      return (callback: (value: unknown, setValue: unknown, set: unknown) => void) =>
        target.forEach((setValue) =>
          callback(readonlyValue(setValue), readonlyValue(setValue), proxy)
        )
    if (
      target instanceof Map &&
      hasBuiltinBrand(target, 'map') &&
      (key === 'entries' || key === Symbol.iterator)
    )
      return function* () {
        for (const [mapKey, mapValue] of target.entries())
          yield [readonlyValue(mapKey), readonlyValue(mapValue)]
      }
    if (
      target instanceof Map &&
      hasBuiltinBrand(target, 'map') &&
      (key === 'keys' || key === 'values')
    )
      return function* () {
        for (const value of target[key]()) yield readonlyValue(value)
      }
    if (
      target instanceof Set &&
      hasBuiltinBrand(target, 'set') &&
      (key === 'values' || key === 'keys' || key === Symbol.iterator)
    )
      return function* () {
        for (const value of target.values()) yield readonlyValue(value)
      }
    if (target instanceof Date && hasBuiltinBrand(target, 'date') && key === 'getTime')
      return () => target.getTime()
    if (target instanceof RegExp && hasBuiltinBrand(target, 'regexp') && key === 'exec')
      return (input: string) => new RegExp(target.source, target.flags).exec(input)
    if (target instanceof RegExp && hasBuiltinBrand(target, 'regexp') && key === 'test')
      return (input: string) => new RegExp(target.source, target.flags).test(input)
    return result && (typeof result === 'object' || typeof result === 'function')
      ? readonlyWrap(result)
      : result
  }

  /** Callable own-data reflection belongs to the independent target. */
  has(_target: object, key: string | symbol): boolean {
    return Reflect.has(this.#callable ? this.#target : this.#value, key)
  }
  /** Preserve the original live key order. */
  ownKeys(): (string | symbol)[] {
    return Reflect.ownKeys(this.#callable ? this.#target : this.#value)
  }

  /** Keep descriptors live while returning readonly nested graph values. */
  getOwnPropertyDescriptor(_target: object, key: string | symbol): PropertyDescriptor | undefined {
    /** The owned value remains the descriptor source. */
    const value = this.#value
    /** Callable descriptor invariants use the independent target. */
    const callable = this.#callable
    /** Fixed own properties belong to this Proxy target. */
    const target = this.#target

    if (callable) return Reflect.getOwnPropertyDescriptor(target, key)
    /** Array length is the only fixed own property on the independent object target. */
    const arrayLength = Array.isArray(value) && key === 'length'
    /** Reflect owned descriptors without leaking their unwrapped graph values. */
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return undefined
    return {
      ...descriptor,
      configurable: !arrayLength,
      ...('value' in descriptor ? { value: readonlyValue(descriptor.value) } : {}),
      ...(arrayLength ? { writable: true } : {})
    }
  }

  /** All mutation traps share the canonical readonly failure. */
  set(): never {
    throw readonlyMutation()
  }
  /** Descriptor changes cannot mutate the owned graph. */
  defineProperty(): never {
    throw readonlyMutation()
  }
  /** Deletion cannot mutate the owned graph. */
  deleteProperty(): never {
    throw readonlyMutation()
  }
  /** Prototype changes cannot mutate the owned graph. */
  setPrototypeOf(): never {
    throw readonlyMutation()
  }
  /** Freezing the facade must not change the owned graph. */
  preventExtensions(): never {
    throw readonlyMutation()
  }
  /** Project the original prototype through the same readonly graph owner. */
  getPrototypeOf(): object | null {
    return readonlyValue(Object.getPrototypeOf(this.#value)) as object | null
  }
  /** Calls preserve the supplied receiver before projecting their result. */
  apply(_target: object, thisArg: unknown, args: unknown[]): unknown {
    return readonlyValue(
      Reflect.apply(this.#value as (...args: unknown[]) => unknown, thisArg, args)
    )
  }
  /** Construction preserves the original callable's expected prototype identity. */
  construct(_target: object, args: unknown[]): object {
    /** The original callable remains the native construction target. */
    const value = this.#value

    const result = Reflect.construct(value as Function, args, value as Function)
    const expectedPrototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value
    return Object.getPrototypeOf(result) === expectedPrototype
      ? result
      : (readonlyValue(result) as object)
  }
}

/** Reuse the canonical facade identity; the named owner holds all Proxy behavior and state. */
function readonlyWrap(value: object): object {
  /** Reentrant graph reads share the already-created facade. */
  const existing = readonlyCache.get(value)
  return existing ?? new ReadonlyFacade(value).proxy
}

function unwrapReadonly(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  return readonlyRawCache.get(value) ?? value
}

/** Explicit entry context keeps native forEach timing without capturing graph state in a callback. */
type IConfigArrayEntryContext = {
  /** All writes remain on the per-call private array builder. */
  readonly target: unknown[]
  /** Admission retains the enclosing combine operation's selected profile. */
  readonly profile: IConfigProfile
  /** Graph cloning uses the same existing resource limits as sibling values. */
  readonly limits: IConfigLimits
  /** Incoming element aliases share the source's canonical clone memo. */
  readonly seen: WeakMap<object, object>
  /** Sparse-index bookkeeping belongs to the one array owner of this combine call. */
  readonly arrays: ConfigArrayMerge
}

/** Clone one present incoming index and apply its replacement/deletion to the private builder. */
function mergeConfigArrayEntry(
  context: IConfigArrayEntryContext,
  entry: unknown,
  index: number
): void {
  context.arrays.set(
    context.target,
    index,
    entry === CONFIG_DELETE
      ? undefined
      : cloneGraph(
          entry,
          context.profile,
          context.limits,
          context.seen,
          0,
          undefined,
          false,
          context.arrays
        ),
    entry === CONFIG_DELETE
  )
}

/** Extend one private array without copying any already accumulated prefix. */
function mergeConfigArray(
  target: unknown[],
  source: unknown[],
  strategy: 'concat' | 'mergeByIndex',
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen: WeakMap<object, object>,
  arrays: ConfigArrayMerge
): void {
  /** Register the incoming array before visiting its entries, preserving self and sibling aliases. */
  seen.set(source, target)
  /** A callback can feed this builder into a later owned source; snapshot only that self-alias. */
  const incoming =
    target === source ? (strategy === 'concat' ? [...source] : source.slice()) : source
  if (strategy === 'concat') {
    arrays.concat(target)
    for (const entry of incoming)
      target.push(cloneGraph(entry, profile, limits, seen, 0, undefined, false, arrays))
  } else {
    arrays.begin(target)
    /** The native/custom forEach keeps its existing hole and initial-length semantics. */
    const context: IConfigArrayEntryContext = { target, profile, limits, seen, arrays }
    incoming.forEach((entry, index) => mergeConfigArrayEntry(context, entry, index))
  }
}

/** Merge a Map in entry order while sharing the enclosing graph's original clone identities. */
function mergeConfigMap(
  target: Map<unknown, unknown>,
  source: Map<unknown, unknown>,
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen: WeakMap<object, object>,
  arrays: ConfigArrayMerge
): void {
  for (const [key, value] of source) {
    if (value === CONFIG_DELETE) target.delete(key)
    else {
      /** Object keys reuse the same traversal identity as values and sibling record properties. */
      const mappedKey =
        key !== null && (typeof key === 'object' || typeof key === 'function')
          ? cloneGraph(key, profile, limits, seen, 0, undefined, false, arrays)
          : key
      /** Each value is cloned only through the existing graph owner and its shared memo. */
      const mappedValue =
        value !== null && (typeof value === 'object' || typeof value === 'function')
          ? cloneGraph(value, profile, limits, seen, 0, undefined, false, arrays)
          : value
      target.set(mappedKey, mappedValue)
    }
  }
}

/** Union a Set without admitting deletion markers or changing shared graph identity/order. */
function unionConfigSet(
  target: Set<unknown>,
  source: Set<unknown>,
  key: PropertyKey,
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen: WeakMap<object, object>,
  arrays: ConfigArrayMerge
): void {
  for (const entry of source) {
    if (entry === CONFIG_DELETE)
      throw configError(
        UtilsErrorCode.configConflict,
        String(key),
        UtilsErrorText.configSetDeleteReason
      )
    /** The graph's clone cache preserves aliases across all values in the enclosing merge. */
    const mapped =
      entry !== null && (typeof entry === 'object' || typeof entry === 'function')
        ? cloneGraph(entry, profile, limits, seen, 0, undefined, false, arrays)
        : entry
    target.add(mapped)
  }
}

/**
 * Merge properties in observable source order, delegating collection-specific work to its named
 * owner. The source loop stays together because alias memo registration and synchronous conflict
 * decisions must occur at the current property before the next property is read. Collection
 * algorithms already have named owners; splitting this dispatch would add forwarding helpers with
 * the same graph context instead of separating another responsibility.
 */
function mergeRecord(
  target: Record<PropertyKey, unknown>,
  source: IConfigRecord,
  strategies?: Partial<IConfigMergeStrategies>,
  onConflict?: IConfigCombineOptions['onConflict'],
  path: readonly PropertyKey[] = [],
  ruleIndex?: IConfigPathRuleIndex,
  sourceRoot: IConfigRecord = source,
  sourceSeen = new WeakMap<object, object>(),
  profile: IConfigProfile = ConfigProfile.data,
  limits: IConfigLimits = defaultLimits,
  arrays = new ConfigArrayMerge()
): void {
  if (sourceSeen.has(source as object)) return
  sourceSeen.set(source as object, target)
  for (const key of Reflect.ownKeys(source)) {
    const right = source[key]
    const left = target[key]
    /** Owned input depth is capped by defaultLimits.maxDepth (256), so this copy is bounded. */
    const currentPath = [...path, key]
    if (right === sourceRoot) {
      target[key] = target
      continue
    }
    if (right === CONFIG_DELETE) {
      if (target instanceof Set)
        throw configError(UtilsErrorCode.configConflict, String(key), 'delete is not valid here')
      if (key in target) delete target[key]
      continue
    }
    /** One Map step follows the current key; an ancestor rule remains effective below its prefix. */
    const ruleNode = ruleIndex?.children.get(key)
    /** An exact longer prefix wins; otherwise the current prefix's first rule still applies. */
    const matched = ruleNode?.strategies ?? ruleIndex?.strategies
    /** Prefix policies override only their declared fields while preserving inherited defaults. */
    const effective: IConfigMergeStrategies = {
      record: strategies?.record ?? 'merge',
      array: strategies?.array ?? 'replace',
      map: strategies?.map ?? 'replace',
      set: strategies?.set ?? 'replace',
      undefined: strategies?.undefined ?? 'ignore',
      ...matched
    }
    if (right !== null && (typeof right === 'object' || typeof right === 'function')) {
      const seenTarget = sourceSeen.get(right as object)
      if (seenTarget) {
        target[key] = seenTarget
        continue
      }
    }
    if (
      hasBuiltinBrand(left as object, 'map') &&
      hasBuiltinBrand(right as object, 'map') &&
      effective.map === 'merge'
    ) {
      mergeConfigMap(
        left as Map<unknown, unknown>,
        right as Map<unknown, unknown>,
        profile,
        limits,
        sourceSeen,
        arrays
      )
      continue
    }
    if (
      hasBuiltinBrand(left as object, 'set') &&
      hasBuiltinBrand(right as object, 'set') &&
      effective.set === 'union'
    ) {
      unionConfigSet(
        left as Set<unknown>,
        right as Set<unknown>,
        key,
        profile,
        limits,
        sourceSeen,
        arrays
      )
      continue
    }
    if (
      Array.isArray(left) &&
      Array.isArray(right) &&
      (effective.array === 'concat' || effective.array === 'mergeByIndex')
    ) {
      /** Resolver-provided arrays also enter the existing graph clone before any in-place write. */
      const accumulator = arrays.has(left)
        ? left
        : cloneGraph(left, profile, limits, sourceSeen, 0, undefined, false, arrays)
      mergeConfigArray(accumulator, right, effective.array, profile, limits, sourceSeen, arrays)
      target[key] = accumulator
    } else if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right) &&
      !hasBuiltinBrand(left, 'date') &&
      !hasBuiltinBrand(right, 'date') &&
      !hasBuiltinBrand(left, 'regexp') &&
      !hasBuiltinBrand(right, 'regexp') &&
      !hasBuiltinBrand(left, 'map') &&
      !hasBuiltinBrand(right, 'map') &&
      !hasBuiltinBrand(left, 'set') &&
      !hasBuiltinBrand(right, 'set') &&
      effective.record !== 'replace'
    )
      mergeRecord(
        left as Record<PropertyKey, unknown>,
        right as IConfigRecord,
        effective,
        onConflict,
        currentPath,
        ruleNode,
        sourceRoot,
        sourceSeen,
        profile,
        limits,
        arrays
      )
    else if (key in target && onConflict) {
      const decision = onConflict({ path: currentPath, left, right })
      if (
        decision === null ||
        typeof decision !== 'object' ||
        typeof (decision as { then?: unknown }).then === 'function'
      )
        throw configError(
          UtilsErrorCode.configConflict,
          String(key),
          'resolver must be synchronous'
        )
      if (!['left', 'right', 'delete', 'value'].includes(decision.kind))
        throw configError(
          UtilsErrorCode.configConflict,
          String(key),
          'resolver decision is invalid'
        )
      if (decision.kind === 'left') continue
      if (decision.kind === 'delete') {
        delete target[key]
        continue
      }
      /** Capture selected graphs now so nested arrays are private before later nested conflicts. */
      const selected = decision.kind === 'value' ? decision.value : right
      target[key] =
        selected !== null && (typeof selected === 'object' || typeof selected === 'function')
          ? cloneGraph(selected, profile, limits, sourceSeen, 0, undefined, false, arrays)
          : selected
    } else if (right !== undefined || effective.undefined === 'assign') {
      if (hasBuiltinBrand(right as object, 'map')) {
        const mapped = new Map<unknown, unknown>()
        for (const [mapKey, mapValue] of right as Map<unknown, unknown>) {
          mapped.set(
            mapKey !== null && (typeof mapKey === 'object' || typeof mapKey === 'function')
              ? cloneGraph(mapKey, profile, limits, sourceSeen, 0, undefined, false, arrays)
              : mapKey,
            mapValue !== null && (typeof mapValue === 'object' || typeof mapValue === 'function')
              ? cloneGraph(mapValue, profile, limits, sourceSeen, 0, undefined, false, arrays)
              : mapValue
          )
        }
        target[key] = mapped
      } else if (hasBuiltinBrand(right as object, 'set')) {
        const mapped = new Set<unknown>()
        for (const entry of right as Set<unknown>)
          mapped.add(
            entry !== null && (typeof entry === 'object' || typeof entry === 'function')
              ? (sourceSeen.get(entry as object) ?? entry)
              : entry
          )
        target[key] = mapped
      } else if (right !== null && (typeof right === 'object' || typeof right === 'function')) {
        target[key] = cloneGraph(right, profile, limits, sourceSeen, 0, undefined, false, arrays)
      } else target[key] = right
    }
  }
}

function readonlyMutation(): TypeError {
  return configError(UtilsErrorCode.configReadonly, 'config', 'readonly mutation')
}

function readonlyValue(value: unknown): unknown {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? readonlyWrap(value)
    : value
}
function configError(code: string, path: string, reason: string, cause?: unknown): Error {
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
  const options = cause === undefined ? undefined : { cause }
  const error =
    code === UtilsErrorCode.configLimitExceeded
      ? new RangeError(message, options)
      : new TypeError(message, options)
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

export { ConfigOwner } from './config-owner.js'
export type {
  IConfigAsyncSource,
  IConfigDiffEntry,
  IConfigOwnerAsyncOptions,
  IConfigOwnerEnvOptions,
  IConfigOwnerOptions,
  IConfigOwnerParseOptions,
  IConfigOwnerPath,
  IConfigOwnerPathValue,
  IConfigOwnerWriteValue,
  IConfigSource,
  IConfigValidator,
  IConfigView,
  IMergedConfig
} from './config-owner.js'
