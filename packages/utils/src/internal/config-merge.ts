/** Source-ordered config merge decisions and private collection accumulation; no root publication. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import {
  CONFIG_DELETE,
  ConfigProfile,
  type IConfigCombineOptions,
  type IConfigLimits,
  type IConfigMergeStrategies,
  type IConfigPathRule,
  type IConfigProfile,
  type IConfigRecord
} from './config-contract.ts'
import { ConfigArrayMerge } from './config-array-merge.ts'
import { cloneGraph } from './config-clone.ts'
import { configError, defaultLimits, hasBuiltinBrand } from './config-state.ts'

/** One prefix node keeps the first declared rule and indexes each next path segment once. */
type IConfigPathRuleIndex = {
  /** Exact segment identity preserves the existing string/symbol prefix matching contract. */
  readonly children: Map<PropertyKey, IConfigPathRuleIndex>
  /** Captured input strategies never reread an accessor while merging later source properties. */
  strategies?: Partial<IConfigMergeStrategies>
}

/**
 * Snapshot path-rule descriptors once, in O(total prefix segments + strategy fields). The first
 * declaration at an equal prefix wins, matching the former stable longest-prefix sort. Rules whose
 * accessors return changing descriptions are outside the supported input contract.
 */
export function indexConfigPathRules(
  rules: readonly IConfigPathRule[] | undefined
): IConfigPathRuleIndex {
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

/** Resolve one leaf conflict synchronously, then capture its selected graph before the next key. */
function resolveConfigConflict(
  target: Record<PropertyKey, unknown>,
  key: PropertyKey,
  onConflict: NonNullable<IConfigCombineOptions['onConflict']>,
  currentPath: readonly PropertyKey[],
  left: unknown,
  right: unknown,
  profile: IConfigProfile,
  limits: IConfigLimits,
  sourceSeen: WeakMap<object, object>,
  arrays: ConfigArrayMerge
): void {
  /** The resolver result is inspected synchronously before any later source property is read. */
  const decision = onConflict({ path: currentPath, left, right })
  if (
    decision === null ||
    typeof decision !== 'object' ||
    typeof (decision as { then?: unknown }).then === 'function'
  )
    throw configError(UtilsErrorCode.configConflict, String(key), ConfigReason.resolverSynchronous)
  if (!['left', 'right', 'delete', 'value'].includes(decision.kind))
    throw configError(
      UtilsErrorCode.configConflict,
      String(key),
      ConfigReason.resolverDecisionInvalid
    )
  if (decision.kind === 'left') return
  if (decision.kind === 'delete') {
    delete target[key]
    return
  }
  /** Capture selected graphs now so nested arrays are private before later nested conflicts. */
  const selected = decision.kind === 'value' ? decision.value : right
  target[key] =
    selected !== null && (typeof selected === 'object' || typeof selected === 'function')
      ? cloneGraph(selected, profile, limits, sourceSeen, 0, undefined, false, arrays)
      : selected
}

/** Capture a replacement value with the existing Map/Set admission and source-local alias policy. */
function cloneConfigReplacement(
  right: unknown,
  profile: IConfigProfile,
  limits: IConfigLimits,
  sourceSeen: WeakMap<object, object>,
  arrays: ConfigArrayMerge
): unknown {
  if (hasBuiltinBrand(right as object, 'map')) {
    /** This replacement collection is private to the unpublished merge result. */
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
    return mapped
  } else if (hasBuiltinBrand(right as object, 'set')) {
    /** This replacement collection is private to the unpublished merge result. */
    const mapped = new Set<unknown>()
    for (const entry of right as Set<unknown>)
      mapped.add(
        entry !== null && (typeof entry === 'object' || typeof entry === 'function')
          ? (sourceSeen.get(entry as object) ?? entry)
          : entry
      )
    return mapped
  } else if (right !== null && (typeof right === 'object' || typeof right === 'function')) {
    return cloneGraph(right, profile, limits, sourceSeen, 0, undefined, false, arrays)
  } else return right
}

/**
 * Merge properties in observable source order, delegating collection-specific work to its named
 * owner. The source loop stays together because alias memo registration and synchronous conflict
 * decisions must occur at the current property before the next property is read. Collection
 * algorithms and leaf conflict admission have their own named owners.
 */
export function mergeRecord(
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
    /** Read the incoming property before observing its accumulated left value. */
    const right = source[key]
    /** The current accumulator remains visible to the synchronous conflict policy. */
    const left = target[key]
    /** Owned input depth is capped by defaultLimits.maxDepth (256), so this copy is bounded. */
    const currentPath = [...path, key]
    if (right === sourceRoot) {
      target[key] = target
      continue
    }
    if (right === CONFIG_DELETE) {
      if (target instanceof Set)
        throw configError(
          UtilsErrorCode.configConflict,
          String(key),
          UtilsErrorText.configSetDeleteReason
        )
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
      /** An earlier graph edge determines the canonical target identity for this alias. */
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
      resolveConfigConflict(
        target,
        key,
        onConflict,
        currentPath,
        left,
        right,
        profile,
        limits,
        sourceSeen,
        arrays
      )
    } else if (right !== undefined || effective.undefined === 'assign') {
      target[key] = cloneConfigReplacement(right, profile, limits, sourceSeen, arrays)
    }
  }
}
