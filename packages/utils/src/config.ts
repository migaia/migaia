import { UtilsErrorCode } from './error-code.js';
import { UtilsErrorText } from './error-text.js';
import { parseObjectPath, probeObjectPath, type IObjectPathTupleFor } from './object-path.js';

export const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const;
export type IConfigProfile = (typeof ConfigProfile)[keyof typeof ConfigProfile];
export const CONFIG_DELETE: unique symbol = Symbol('CONFIG_DELETE');
export type IConfigRecord = Record<PropertyKey, unknown>;
export type IOwnedConfig<T extends IConfigRecord> = T & {
  readonly __utilsOwnedConfigBrand?: unique symbol;
};
export type IConfigLimits = {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxKeys: number;
  readonly maxPathLength: number;
  readonly maxSegmentLength: number;
};
export type IOwnConfigOptions = {
  readonly profile?: IConfigProfile;
  readonly limits?: Partial<IConfigLimits>;
};
export type IConfigPatch<T extends IConfigRecord> = {
  readonly [K in keyof T]?: T[K] | typeof CONFIG_DELETE;
} & Readonly<Record<PropertyKey, unknown>>;
export type IConfigPatchOptions = IOwnConfigOptions & { readonly reuseUnchangedRoot?: boolean };
export type IConfigReadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: unknown };
export type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace';
  readonly array: 'replace' | 'concat' | 'mergeByIndex';
  readonly map: 'replace' | 'merge';
  readonly set: 'replace' | 'union';
  readonly undefined: 'ignore' | 'assign';
};
export type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown };
export type IConfigConflictContext = {
  readonly path: readonly PropertyKey[];
  readonly left: unknown;
  readonly right: unknown;
};
export type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[];
  readonly strategies: Partial<IConfigMergeStrategies>;
};
export type IConfigCombineOptions = IOwnConfigOptions & {
  readonly strategies?: Partial<IConfigMergeStrategies>;
  readonly pathRules?: readonly IConfigPathRule[];
  readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision;
};

const defaultLimits: IConfigLimits = {
  maxDepth: 256,
  maxNodes: 100_000,
  maxKeys: 1_000_000,
  maxPathLength: 4096,
  maxSegmentLength: 512
};
const metadata = new WeakMap<
  object,
  { readonly profile: IConfigProfile; readonly limits: IConfigLimits }
>();
const readonlyCache = new WeakMap<object, object>();
const readonlyRawCache = new WeakMap<object, object>();
const dangerous = new Set<PropertyKey>(['__proto__', 'prototype', 'constructor']);
/** Detects built-in internal slots without mistaking subclass prototype objects for instances. */
const hasBuiltinBrand = (value: object, kind: 'date' | 'regexp' | 'map' | 'set'): boolean => {
  try {
    if (kind === 'date') Reflect.apply(Date.prototype.getTime, value, []);
    else if (kind === 'regexp') Reflect.get(value, 'source');
    else if (kind === 'map') Reflect.apply(Map.prototype.has, value, [undefined]);
    else Reflect.apply(Set.prototype.has, value, [undefined]);
    return true;
  } catch {
    return false;
  }
};
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
]);

/** Creates a validated isolated graph with a runtime ownership brand. */
export function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: IOwnConfigOptions
): IOwnedConfig<T> {
  const { profile: requestedProfile, limits: requestedLimits } = options ?? {};
  const profile = requestedProfile ?? ConfigProfile.data;
  const limits = resolveLimits(requestedLimits);
  const existing = metadata.get(value as object);
  if (existing) {
    if (
      existing.profile !== profile ||
      Object.keys(limits).some(
        (key) => existing.limits[key as keyof IConfigLimits] !== limits[key as keyof IConfigLimits]
      )
    )
      throw configError(UtilsErrorCode.configConflict, 'config', 'ownership metadata differs');
    return value as IOwnedConfig<T>;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw configError(UtilsErrorCode.configUnsupported, 'root', 'plain record required');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol')
      throw configError(UtilsErrorCode.configUnsupported, 'root', 'symbol key is not supported');
  }
  const result = cloneGraph(value, profile, limits);
  metadata.set(result, { profile, limits });
  return result as IOwnedConfig<T>;
}

/** Creates a cached readonly facade that rejects structural mutation. */
export function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T {
  if (!metadata.has(value as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned');
  return readonlyWrap(value) as T;
}

/** Applies a root-level copy-on-write overlay. */
export function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: IConfigPatchOptions
): IOwnedConfig<T> {
  const {
    profile: requestedProfile,
    limits: requestedLimits,
    reuseUnchangedRoot = true
  } = options ?? {};
  const baseMeta = metadata.get(base as object);
  if (!baseMeta)
    throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned');
  if (requestedProfile !== undefined && requestedProfile !== baseMeta.profile)
    throw configError(UtilsErrorCode.configConflict, 'profile', 'profile differs from base');
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
    );
  if (
    patch === null ||
    typeof patch !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(patch))
  )
    throw configError(UtilsErrorCode.configUnsupported, 'patch', 'plain record required');
  const keys = Reflect.ownKeys(patch);
  if (keys.length === 0 && reuseUnchangedRoot) return base;
  const next: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(base));
  for (const key of Reflect.ownKeys(base)) next[key] = base[key];
  for (const key of keys) {
    if (dangerous.has(key))
      throw configError(UtilsErrorCode.configPathInvalid, String(key), 'dangerous key');
    if (typeof key === 'symbol')
      throw configError(UtilsErrorCode.configUnsupported, 'patch', 'symbol key is not supported');
    const descriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (!descriptor || !('value' in descriptor))
      throw configError(UtilsErrorCode.configUnsupported, String(key), 'accessor unsupported');
    const value = patch[key];
    if (value === CONFIG_DELETE) delete next[key];
    else next[key] = value;
  }
  const seen = new WeakMap<object, object>();
  seen.set(base as object, next);
  seen.set(patch as object, next);
  primeSharedNodes(base, base, seen);
  for (const key of Reflect.ownKeys(base)) {
    const descriptor = Object.getOwnPropertyDescriptor(base, key);
    if (!descriptor || !('value' in descriptor)) continue;
    if (descriptor.value === base) {
      Object.defineProperty(next, key, { ...descriptor, value: next });
    } else if (reachesRoot(descriptor.value, base)) {
      Object.defineProperty(next, key, {
        ...descriptor,
        value: cloneGraph(
          descriptor.value,
          baseMeta.profile,
          requestedLimits ? resolveLimits(requestedLimits) : baseMeta.limits,
          seen
        )
      });
    }
  }
  for (const key of Reflect.ownKeys(next)) {
    const descriptor = Object.getOwnPropertyDescriptor(next, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const value = descriptor.value === base ? next : descriptor.value;
    Object.defineProperty(next, key, {
      ...descriptor,
      value: value === descriptor.value ? value : value
    });
  }
  rebaseCallablePrototypeRoots(next, base);
  for (const key of keys) {
    const patchDescriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (
      !patchDescriptor ||
      !('value' in patchDescriptor) ||
      patchDescriptor.value === CONFIG_DELETE
    )
      continue;
    Object.defineProperty(next, key, {
      ...patchDescriptor,
      value: cloneGraph(
        patchDescriptor.value,
        baseMeta.profile,
        requestedLimits ? resolveLimits(requestedLimits) : baseMeta.limits,
        seen
      )
    });
  }
  metadata.set(next, {
    profile: baseMeta.profile,
    limits: requestedLimits ? resolveLimits(requestedLimits) : baseMeta.limits
  });
  return next as IOwnedConfig<T>;
}

/** Repoints direct old-root edges held by cloned callable prototype objects. */
function rebaseCallablePrototypeRoots(root: Record<PropertyKey, unknown>, oldRoot: object): void {
  for (const key of Reflect.ownKeys(root)) {
    const value = root[key];
    if (typeof value !== 'function') continue;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) continue;
    for (const prototypeKey of Reflect.ownKeys(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, prototypeKey);
      if (descriptor && 'value' in descriptor && descriptor.value === oldRoot)
        Object.defineProperty(prototype, prototypeKey, { ...descriptor, value: root });
    }
  }
}

function reachesRoot(value: unknown, root: object, seen = new WeakSet<object>()): boolean {
  if (value === root) return true;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if (value instanceof Map && hasBuiltinBrand(value, 'map')) {
    const entries = Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      readonly [unknown, unknown]
    >;
    for (const [key, entry] of entries)
      if (reachesRoot(key, root, seen) || reachesRoot(entry, root, seen)) return true;
    return false;
  }
  if (value instanceof Set && hasBuiltinBrand(value, 'set')) {
    const entries = Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>;
    for (const entry of entries) if (reachesRoot(entry, root, seen)) return true;
    return false;
  }
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor && 'value' in descriptor && reachesRoot(descriptor.value, root, seen))
      return true;
  }
  return reachesRoot(Object.getPrototypeOf(value as object), root, seen);
}

/** Seeds COW clone state with subgraphs that cannot reach the replaced root. */
function primeSharedNodes(
  value: unknown,
  root: object,
  shared: WeakMap<object, object>,
  visited = new WeakSet<object>()
): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  const objectValue = value as object;
  if (visited.has(objectValue) || (objectValue !== root && shared.has(objectValue))) return;
  visited.add(objectValue);
  if (objectValue !== root && !reachesRoot(objectValue, root)) {
    shared.set(objectValue, objectValue);
    return;
  }
  if (objectValue instanceof Map && hasBuiltinBrand(objectValue, 'map')) {
    const entries = Reflect.apply(Map.prototype.entries, objectValue, []) as Iterable<
      readonly [unknown, unknown]
    >;
    for (const [key, entry] of entries) {
      primeSharedNodes(key, root, shared, visited);
      primeSharedNodes(entry, root, shared, visited);
    }
  } else if (objectValue instanceof Set && hasBuiltinBrand(objectValue, 'set')) {
    const entries = Reflect.apply(Set.prototype.values, objectValue, []) as Iterable<unknown>;
    for (const entry of entries) primeSharedNodes(entry, root, shared, visited);
  }
  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (descriptor && 'value' in descriptor)
      primeSharedNodes(descriptor.value, root, shared, visited);
  }
  primeSharedNodes(Object.getPrototypeOf(objectValue), root, shared, visited);
}

/** Applies config limits and string-key policy over the canonical object-path parser. */
export function parseConfigPath(
  path: string,
  limits: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'> = defaultLimits
): readonly string[] {
  if (path.length === 0 || path.length > limits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, path, 'invalid length');
  let parsed: readonly PropertyKey[];
  try {
    parsed = parseObjectPath(path);
  } catch (error) {
    throw configError(UtilsErrorCode.configPathInvalid, path, 'invalid segment', error);
  }
  const sourceSegments = path.split('.');
  const result = parsed.map((segment, index) =>
    typeof segment === 'number' ? /^\[(\d+)\]$/.exec(sourceSegments[index])![1] : String(segment)
  );
  for (const segment of result) {
    if (segment.length > limits.maxSegmentLength || dangerous.has(segment))
      throw configError(UtilsErrorCode.configPathInvalid, segment, 'invalid segment');
  }
  return Object.freeze(result);
}

/** Reads a config path and distinguishes missing from an undefined value. */
export function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult {
  if (!metadata.has(config as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', 'value is not owned');
  const segments = typeof path === 'string' ? parseConfigPath(path) : path;
  if (segments.length > defaultLimits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, 'path', 'invalid length');
  for (const segment of segments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > defaultLimits.maxSegmentLength ||
      dangerous.has(segment)
    )
      throw configError(UtilsErrorCode.configPathInvalid, String(segment), 'invalid segment');
  }
  const probe = probeObjectPath(config, segments as IObjectPathTupleFor<IConfigRecord>);
  if (probe.kind === 'failed') throw probe.error;
  if (probe.kind !== 'value') return { kind: 'missing' };
  const value: unknown = probe.value;
  return {
    kind: 'value',
    value:
      value && (typeof value === 'object' || typeof value === 'function')
        ? readonlyWrap(value)
        : value
  };
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
  } = options ?? {};
  const metas = sources.map((source) => metadata.get(source as object));
  if (metas.some((meta) => !meta))
    throw configError(UtilsErrorCode.configUnsupported, 'sources', 'source is not owned');
  const profile = requestedProfile ?? metas[0]?.profile ?? ConfigProfile.data;
  if (metas.some((meta) => meta!.profile !== profile))
    throw configError(UtilsErrorCode.configConflict, 'profile', 'sources use different profiles');
  if (
    sources.length === 1 &&
    requestedProfile === undefined &&
    requestedLimits === undefined &&
    strategies === undefined &&
    pathRules === undefined &&
    onConflict === undefined
  )
    return sources[0];
  const limits: IConfigLimits = requestedLimits
    ? resolveLimits(requestedLimits)
    : metas.reduce<Record<keyof IConfigLimits, number>>(
        (minimum, meta) => {
          if (!meta) return minimum;
          for (const key of Object.keys(defaultLimits) as Array<keyof IConfigLimits>)
            minimum[key] = Math.min(minimum[key], meta.limits[key]);
          return minimum;
        },
        { ...defaultLimits }
      );
  const result: Record<PropertyKey, unknown> = Object.create(null);
  for (const source of sources)
    mergeRecord(
      result,
      source,
      strategies,
      onConflict,
      [],
      pathRules,
      source,
      new WeakMap<object, object>(),
      profile,
      limits
    );
  return ownConfig(result, { profile, limits });
}

function resolveLimits(overrides?: Partial<IConfigLimits>): IConfigLimits {
  const result = { ...defaultLimits, ...overrides };
  for (const [key, value] of Object.entries(result))
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > defaultLimits[key as keyof IConfigLimits]
    )
      throw configError(UtilsErrorCode.configLimitExceeded, key, 'invalid limit');
  return result;
}

function cloneGraph<T>(
  value: T,
  profile: IConfigProfile,
  limits: IConfigLimits,
  seen = new WeakMap<object, object>(),
  depth = 0,
  state: { nodes: number; keys: number } = { nodes: 0, keys: 0 },
  allowConstructorKey = false
): T {
  if (depth > limits.maxDepth)
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxDepth', 'graph depth');
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const existing = seen.get(value as object);
    if (existing) return existing as T;
  }
  if (typeof value === 'function') {
    if (profile === ConfigProfile.data)
      throw configError(UtilsErrorCode.configUnsupported, 'value', 'function requires richRuntime');
    const source = value as (...args: unknown[]) => unknown;
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(source, 'prototype');
    const constructable = (() => {
      try {
        Reflect.construct(Object, [], source);
        return true;
      } catch {
        return false;
      }
    })();
    if (constructable && (!prototypeDescriptor || !('value' in prototypeDescriptor)))
      throw configError(
        UtilsErrorCode.configUnsupported,
        'prototype',
        'callable prototype required'
      );
    const wrapper = constructable
      ? function (this: unknown, ...args: unknown[]): unknown {
          if (new.target) return Reflect.construct(source, args, new.target);
          return Reflect.apply(source, this, args);
        }
      : function (this: unknown, ...args: unknown[]): unknown {
          return Reflect.apply(source, this, args);
        };
    seen.set(value as object, wrapper);
    for (const key of Reflect.ownKeys(source)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !('value' in descriptor) || descriptor.configurable === false)
        throw configError(
          UtilsErrorCode.configUnsupported,
          String(key),
          'callable property unsupported'
        );
      Object.defineProperty(wrapper, key, {
        ...descriptor,
        value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state)
      });
    }
    if (constructable && prototypeDescriptor && 'value' in prototypeDescriptor) {
      const clonedPrototype = cloneGraph(
        prototypeDescriptor.value,
        profile,
        limits,
        seen,
        depth + 1,
        state,
        true
      );
      Object.defineProperty(wrapper, 'prototype', {
        ...prototypeDescriptor,
        value: clonedPrototype
      });
    }
    return wrapper as T;
  }
  if (value === null || typeof value !== 'object') return value;
  state.nodes++;
  if (state.nodes > limits.maxNodes)
    throw configError(UtilsErrorCode.configLimitExceeded, 'maxNodes', 'graph nodes');
  if (value instanceof Date && hasBuiltinBrand(value, 'date')) {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    const copy =
      typeof constructor === 'function' && constructor !== Date
        ? Reflect.construct(Date, [value.getTime()], constructor)
        : new Date(value.getTime());
    seen.set(value as object, copy);
    return copy as T;
  }
  if (value instanceof RegExp && hasBuiltinBrand(value, 'regexp')) {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    const copy =
      typeof constructor === 'function' && constructor !== RegExp
        ? Reflect.construct(RegExp, [value.source, value.flags], constructor)
        : new RegExp(value.source, value.flags);
    seen.set(value as object, copy);
    return copy as T;
  }
  if (value instanceof Map && hasBuiltinBrand(value, 'map')) {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    const entries = Reflect.apply(Map.prototype.entries, value, []) as Iterable<
      readonly [unknown, unknown]
    >;
    const copy =
      typeof constructor === 'function' && constructor !== Map
        ? Reflect.construct(Map, [], constructor)
        : new Map();
    seen.set(value as object, copy);
    for (const [key, entry] of entries)
      copy.set(
        cloneGraph(key, profile, limits, seen, depth + 1, state),
        cloneGraph(entry, profile, limits, seen, depth + 1, state)
      );
    const sourcePrototype = Object.getPrototypeOf(value);
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true)
      );
    return copy as T;
  }
  if (value instanceof Set && hasBuiltinBrand(value, 'set')) {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    const copy =
      typeof constructor === 'function' && constructor !== Set
        ? Reflect.construct(Set, [], constructor)
        : new Set();
    seen.set(value as object, copy);
    const entries = Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>;
    for (const entry of entries)
      copy.add(cloneGraph(entry, profile, limits, seen, depth + 1, state));
    const sourcePrototype = Object.getPrototypeOf(value);
    if (sourcePrototype && !intrinsicPrototypes.has(sourcePrototype))
      Object.setPrototypeOf(
        copy,
        cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true)
      );
    return copy as T;
  }
  const sourcePrototype = Object.getPrototypeOf(value);
  const target = Array.isArray(value) ? [] : Object.create(null);
  seen.set(value as object, target);
  if (sourcePrototype === null || intrinsicPrototypes.has(sourcePrototype))
    Object.setPrototypeOf(target, sourcePrototype);
  else
    Object.setPrototypeOf(
      target,
      cloneGraph(sourcePrototype, profile, limits, seen, depth + 1, state, true)
    );
  for (const key of Reflect.ownKeys(value as object)) {
    state.keys++;
    if (state.keys > limits.maxKeys)
      throw configError(UtilsErrorCode.configLimitExceeded, 'maxKeys', 'graph keys');
    if (
      typeof key === 'string' &&
      dangerous.has(key) &&
      !(allowConstructorKey && key === 'constructor')
    )
      throw configError(UtilsErrorCode.configUnsupported, key, 'dangerous key');
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key)!;
    if (!('value' in descriptor))
      throw configError(UtilsErrorCode.configUnsupported, String(key), 'accessor unsupported');
    Object.defineProperty(target, key, {
      ...descriptor,
      value: cloneGraph(descriptor.value, profile, limits, seen, depth + 1, state)
    });
  }
  return target as T;
}

function readonlyWrap(value: object): object {
  const existing = readonlyCache.get(value);
  if (existing) return existing;
  const callable = typeof value === 'function';
  const constructable = callable
    ? (() => {
        try {
          Reflect.construct(Object, [], value as Function);
          return true;
        } catch {
          return false;
        }
      })()
    : false;
  const target = callable
    ? constructable
      ? function (this: unknown, ...args: unknown[]): unknown {
          return Reflect.apply(value as (...args: unknown[]) => unknown, this, args);
        }
      : (...args: unknown[]) =>
          Reflect.apply(value as (...args: unknown[]) => unknown, undefined, args)
    : value;
  if (callable && constructable) {
    const sourcePrototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value;
    if (sourcePrototype !== undefined)
      Object.defineProperty(target, 'prototype', {
        value: readonlyValue(sourcePrototype),
        writable: true,
        configurable: false
      });
  }
  const proxy = new Proxy(target, {
    get: (target, key, receiver) => {
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
          throw readonlyMutation();
        };
      if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'size')
        return target.size;
      if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'size')
        return target.size;
      const result = Reflect.get(callable && key !== 'prototype' ? value : target, key, receiver);
      if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'get')
        return (mapKey: unknown) => readonlyValue(target.get(unwrapReadonly(mapKey)));
      if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'has')
        return (mapKey: unknown) => target.has(unwrapReadonly(mapKey));
      if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'has')
        return (setValue: unknown) => target.has(unwrapReadonly(setValue));
      if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'forEach')
        return (callback: (value: unknown, mapKey: unknown, map: unknown) => void) =>
          target.forEach((mapValue, mapKey) =>
            callback(readonlyValue(mapValue), readonlyValue(mapKey), proxy)
          );
      if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'forEach')
        return (callback: (value: unknown, setValue: unknown, set: unknown) => void) =>
          target.forEach((setValue) =>
            callback(readonlyValue(setValue), readonlyValue(setValue), proxy)
          );
      if (
        target instanceof Map &&
        hasBuiltinBrand(target, 'map') &&
        (key === 'entries' || key === Symbol.iterator)
      )
        return function* () {
          for (const [mapKey, mapValue] of target.entries())
            yield [readonlyValue(mapKey), readonlyValue(mapValue)];
        };
      if (
        target instanceof Map &&
        hasBuiltinBrand(target, 'map') &&
        (key === 'keys' || key === 'values')
      )
        return function* () {
          for (const value of target[key]()) yield readonlyValue(value);
        };
      if (
        target instanceof Set &&
        hasBuiltinBrand(target, 'set') &&
        (key === 'values' || key === 'keys' || key === Symbol.iterator)
      )
        return function* () {
          for (const value of target.values()) yield readonlyValue(value);
        };
      if (target instanceof Date && hasBuiltinBrand(target, 'date') && key === 'getTime')
        return () => target.getTime();
      if (target instanceof RegExp && hasBuiltinBrand(target, 'regexp') && key === 'exec')
        return (input: string) => new RegExp(target.source, target.flags).exec(input);
      if (target instanceof RegExp && hasBuiltinBrand(target, 'regexp') && key === 'test')
        return (input: string) => new RegExp(target.source, target.flags).test(input);
      return result && (typeof result === 'object' || typeof result === 'function')
        ? readonlyWrap(result)
        : result;
    },
    set: () => {
      throw readonlyMutation();
    },
    defineProperty: () => {
      throw readonlyMutation();
    },
    deleteProperty: () => {
      throw readonlyMutation();
    },
    setPrototypeOf: () => {
      throw readonlyMutation();
    },
    preventExtensions: () => {
      throw readonlyMutation();
    },
    getPrototypeOf: () => readonlyValue(Object.getPrototypeOf(value)) as object | null,
    apply: (_target, thisArg, args) =>
      readonlyValue(Reflect.apply(value as (...args: unknown[]) => unknown, thisArg, args)),
    construct: (_target, args) => {
      const result = Reflect.construct(value as Function, args, value as Function);
      const expectedPrototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value;
      return Object.getPrototypeOf(result) === expectedPrototype ? result : readonlyValue(result);
    }
  });
  readonlyCache.set(value, proxy);
  readonlyRawCache.set(proxy, value);
  return proxy;
}

function unwrapReadonly(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  return readonlyRawCache.get(value) ?? value;
}

function mergeRecord(
  target: Record<PropertyKey, unknown>,
  source: IConfigRecord,
  strategies?: Partial<IConfigMergeStrategies>,
  onConflict?: IConfigCombineOptions['onConflict'],
  path: readonly PropertyKey[] = [],
  pathRules?: readonly IConfigPathRule[],
  sourceRoot: IConfigRecord = source,
  sourceSeen = new WeakMap<object, object>(),
  profile: IConfigProfile = ConfigProfile.data,
  limits: IConfigLimits = defaultLimits
): void {
  if (sourceSeen.has(source as object)) return;
  sourceSeen.set(source as object, target);
  for (const key of Reflect.ownKeys(source)) {
    const right = source[key];
    const left = target[key];
    const currentPath = [...path, key];
    if (right === sourceRoot) {
      target[key] = target;
      continue;
    }
    if (right === CONFIG_DELETE) {
      if (target instanceof Set)
        throw configError(UtilsErrorCode.configConflict, String(key), 'delete is not valid here');
      if (key in target) delete target[key];
      continue;
    }
    const matched = pathRules
      ?.filter((rule) => rule.prefix.every((segment, index) => currentPath[index] === segment))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    const effective = { ...strategies, ...matched?.strategies };
    if (right !== null && (typeof right === 'object' || typeof right === 'function')) {
      const seenTarget = sourceSeen.get(right as object);
      if (seenTarget) {
        target[key] = seenTarget;
        continue;
      }
    }
    if (left instanceof Map && right instanceof Map && effective.map === 'merge') {
      for (const [mapKey, mapValue] of right) {
        if (mapValue === CONFIG_DELETE) left.delete(mapKey);
        else {
          const mappedKey =
            mapKey !== null && (typeof mapKey === 'object' || typeof mapKey === 'function')
              ? cloneGraph(mapKey, profile, limits, sourceSeen)
              : mapKey;
          const mappedValue =
            mapValue !== null && (typeof mapValue === 'object' || typeof mapValue === 'function')
              ? cloneGraph(mapValue, profile, limits, sourceSeen)
              : mapValue;
          left.set(mappedKey, mappedValue);
        }
      }
      continue;
    }
    if (left instanceof Set && right instanceof Set && effective.set === 'union') {
      for (const entry of right) {
        if (entry === CONFIG_DELETE)
          throw configError(
            UtilsErrorCode.configConflict,
            String(key),
            'delete is not valid in Set'
          );
        const mappedEntry =
          entry !== null && (typeof entry === 'object' || typeof entry === 'function')
            ? cloneGraph(entry, profile, limits, sourceSeen)
            : entry;
        left.add(mappedEntry);
      }
      continue;
    }
    if (Array.isArray(left) && Array.isArray(right) && effective.array === 'concat')
      target[key] = [...left, ...right];
    else if (Array.isArray(left) && Array.isArray(right) && effective.array === 'mergeByIndex') {
      const merged = left.slice();
      right.forEach((entry, index) => {
        if (entry === CONFIG_DELETE) delete merged[index];
        else merged[index] = entry;
      });
      target[key] = merged;
    } else if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right) &&
      effective.record !== 'replace'
    )
      mergeRecord(
        left as Record<PropertyKey, unknown>,
        right as IConfigRecord,
        effective,
        onConflict,
        currentPath,
        pathRules,
        sourceRoot,
        sourceSeen,
        profile,
        limits
      );
    else if (key in target && onConflict) {
      const decision = onConflict({ path: currentPath, left, right });
      if (
        decision === null ||
        typeof decision !== 'object' ||
        typeof (decision as { then?: unknown }).then === 'function'
      )
        throw configError(
          UtilsErrorCode.configConflict,
          String(key),
          'resolver must be synchronous'
        );
      if (!['left', 'right', 'delete', 'value'].includes(decision.kind))
        throw configError(
          UtilsErrorCode.configConflict,
          String(key),
          'resolver decision is invalid'
        );
      if (decision.kind === 'left') continue;
      if (decision.kind === 'delete') {
        delete target[key];
        continue;
      }
      target[key] = decision.kind === 'value' ? decision.value : right;
    } else if (right !== undefined || strategies?.undefined !== 'ignore') {
      if (right instanceof Map) {
        const mapped = new Map<unknown, unknown>();
        for (const [mapKey, mapValue] of right) {
          mapped.set(
            mapKey !== null && (typeof mapKey === 'object' || typeof mapKey === 'function')
              ? cloneGraph(mapKey, profile, limits, sourceSeen)
              : mapKey,
            mapValue !== null && (typeof mapValue === 'object' || typeof mapValue === 'function')
              ? cloneGraph(mapValue, profile, limits, sourceSeen)
              : mapValue
          );
        }
        target[key] = mapped;
      } else if (right instanceof Set) {
        const mapped = new Set<unknown>();
        for (const entry of right)
          mapped.add(
            entry !== null && (typeof entry === 'object' || typeof entry === 'function')
              ? (sourceSeen.get(entry as object) ?? entry)
              : entry
          );
        target[key] = mapped;
      } else target[key] = right;
    }
  }
}

function readonlyMutation(): TypeError {
  return configError(UtilsErrorCode.configReadonly, 'config', 'readonly mutation');
}

function readonlyValue(value: unknown): unknown {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? readonlyWrap(value)
    : value;
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
            : UtilsErrorText.configUnsupported(path, reason);
  const options = cause === undefined ? undefined : { cause };
  const error =
    code === UtilsErrorCode.configLimitExceeded
      ? new RangeError(message, options)
      : new TypeError(message, options);
  Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}
