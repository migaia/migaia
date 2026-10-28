/** Canonical owned-config domains and public type contracts; no graph or lifecycle state. */
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
