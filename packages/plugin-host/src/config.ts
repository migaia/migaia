import ERROR_TEXT, { createPluginHostTypeError } from './error-text.js';
import { assimilateCapturedThen, probeThenable } from '@migaia/lifecycle';
import type { IPluginConfig } from './typing.js';

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
/** Intrinsic prototype objects stay on native clone targets for brand/method semantics. */
const intrinsicPrototypes = new Set<object>([
  Object.prototype,
  Array.prototype,
  Function.prototype,
  String.prototype,
  Number.prototype,
  Boolean.prototype,
  Symbol.prototype,
  BigInt.prototype,
  Error.prototype,
  TypeError.prototype,
  RangeError.prototype,
  SyntaxError.prototype,
  EvalError.prototype,
  URIError.prototype,
  Date.prototype,
  RegExp.prototype,
  Map.prototype,
  Set.prototype
]);
/** Built-in constructors keep their prior prototype-object treatment during subclass cloning. */
const intrinsicConstructors = new Set<Function>([
  Object,
  Array,
  Function,
  String,
  Number,
  Boolean,
  Symbol,
  BigInt,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  EvalError,
  URIError,
  Date,
  RegExp,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise
]);

/** Captured Map readers remain the only methods allowed to receive raw collections. */
const capturedMapReaders = {
  get: Map.prototype.get,
  has: Map.prototype.has,
  entries: Map.prototype.entries,
  keys: Map.prototype.keys,
  values: Map.prototype.values,
  forEach: Map.prototype.forEach,
  iterator: Map.prototype[Symbol.iterator]
} as const;

/** Captured Set readers remain the only methods allowed to receive raw collections. */
const capturedSetReaders = {
  has: Set.prototype.has,
  entries: Set.prototype.entries,
  keys: Set.prototype.keys,
  values: Set.prototype.values,
  forEach: Set.prototype.forEach,
  iterator: Set.prototype[Symbol.iterator]
} as const;

// Proxy identity is shared across every view of an owned config graph. This is
// required for Map/Set object-key lookup when a caller obtains the key and the
// collection through separate readonlyConfig/readConfigPath calls.
const readonlyProxies = new WeakMap<object, object>();
const readonlyRawValues = new WeakMap<object, object>();

/**
 * Construction prototypes keep instances ordinary while their inherited config values stay
 * readonly.
 */
const constructionPrototypes = new WeakMap<object, object>();
/** Relate each owned constructor clone to its ordinary instance prototype. */
const callableConstructionPrototypes = new WeakMap<Function, object>();
/** Mark constructor clones whose default `instanceof` behavior needs the ordinary prototype bridge. */
const defaultCallableHasInstances = new WeakSet<Function>();

/** Reject direct and proxy-mediated mutations through the canonical readonly contract. */
const rejectReadonlyMutation = (): never => {
  throw createPluginHostTypeError(ERROR_TEXT.CONFIG_READONLY);
};

/** Check `instanceof` across readonly callable and ordinary construction prototype boundaries. */
const isOwnedCallableInstance = (callable: Function, candidate: unknown): boolean => {
  if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function'))
    return false;
  const prototype = Reflect.get(callable, 'prototype', callable) as object;
  const constructionPrototype = callableConstructionPrototypes.get(callable);
  const readonlyPrototype = readonlyProxies.get(prototype);
  let current: object | null = candidate;
  while (current !== null) {
    if (current === prototype || current === constructionPrototype || current === readonlyPrototype)
      return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
};

/** Relate a validated shallow record to its input so root cycles survive validation. */
const plainRecordSources = new WeakMap<object, object>();

/** Resolve a readonly facade back to its owned value before copy-on-write bookkeeping. */
const unwrapReadonlyValue = (value: unknown): unknown => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  return readonlyRawValues.get(value) ?? value;
};

/** Check constructability without invoking the candidate function body. */
const isConstructable = (value: Function): boolean => {
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
};

/** Reject callable shapes that cannot be safely represented by a readonly function proxy. */
const assertSupportedCallable = (value: Function, allowNonWritablePrototype = false): void => {
  const constructable = isConstructable(value);
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(value, 'prototype');
  if (constructable && (!prototypeDescriptor || !('value' in prototypeDescriptor)))
    throw createPluginHostTypeError(
      ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('constructable prototype descriptors are required')
    );
  if (constructable && !allowNonWritablePrototype && prototypeDescriptor?.writable !== true)
    throw createPluginHostTypeError(
      ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('non-writable prototypes are not admitted')
    );
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw createPluginHostTypeError(
        ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('accessor properties are not admitted')
      );
    if (descriptor.configurable === false)
      throw createPluginHostTypeError(
        ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('non-configurable properties are not admitted')
      );
  }
};

/** Validate a plain data record used by config/shared values. */
export const readPlainDataRecord = (
  value: unknown,
  label: string,
  rejectDangerousKeys = true,
  rejectSymbolKeys = false
): Record<PropertyKey, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw createPluginHostTypeError(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw createPluginHostTypeError(`${label} must be a plain object`);
  const result = Object.create(null) as Record<PropertyKey, unknown>;
  plainRecordSources.set(result, value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (rejectSymbolKeys && typeof key === 'symbol')
      throw createPluginHostTypeError(`${label} symbol keys are not allowed`);
    if (rejectDangerousKeys && typeof key === 'string' && dangerousKeys.has(key))
      throw createPluginHostTypeError(`${label} key "${key}" is not allowed`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw createPluginHostTypeError(`${label} properties must be data properties`);
    if (descriptor.enumerable) result[key] = descriptor.value;
  }
  return result;
};

/** Copy custom data properties after registering a special clone in the cycle map. */
const cloneConfigProperties = (
  source: object,
  target: object,
  seen: WeakMap<object, unknown>,
  skippedKey?: PropertyKey
): void => {
  for (const key of Reflect.ownKeys(source)) {
    if (key === skippedKey) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !('value' in descriptor)) continue;
    Object.defineProperty(target, key, {
      value: cloneConfigValue(descriptor.value, seen),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
};

/** Select a prototype for an owned clone without retaining a caller-owned custom prototype. */
const cloneOwnedPrototype = (source: object, seen: WeakMap<object, unknown>): object | null => {
  const prototype = Object.getPrototypeOf(source);
  return prototype === null ||
    intrinsicPrototypes.has(prototype) ||
    intrinsicConstructors.has(prototype)
    ? prototype
    : cloneConfigPrototype(prototype, seen);
};

/**
 * Reject custom-prototype accessors before cloning because their getter/setter closures may retain
 * caller-owned roots that cannot be discovered or rebased by the config graph copier.
 */
const assertOwnableCustomPrototype = (source: object): void => {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(source);
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause });
  }
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(source, key);
    } catch (cause) {
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause });
    }
    if (descriptor && !('value' in descriptor))
      throw createPluginHostTypeError(
        ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('custom prototype accessors are not admitted')
      );
  }
};

/** Walk an iterator without consulting its iterable or `Symbol.iterator` property. */
const forEachIteratorValue = <T>(iterator: Iterator<T>, visit: (value: T) => void): void => {
  let step = iterator.next();
  while (!step.done) {
    visit(step.value);
    step = iterator.next();
  }
};

/**
 * Build an extensible facade target whose own data descriptors can safely expose mapped values.
 * Proxy traps cannot substitute a readonly facade for an object-valued non-configurable,
 * non-writable property on the original target, so output boundaries use this shallow target.
 */
const createReadonlyFacadeTarget = (
  source: object,
  mapValue: (value: unknown) => unknown,
  mapPrototype: (source: object | null) => object | null,
  targetOverride?: object
): object => {
  const copyProperties = (target: object, skipKey?: PropertyKey): object => {
    for (const key of Reflect.ownKeys(source)) {
      if (key === skipKey) continue;
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor) continue;
      if ('value' in descriptor) {
        const isArrayLength = Array.isArray(source) && key === 'length';
        Object.defineProperty(target, key, {
          value: descriptor.value,
          enumerable: descriptor.enumerable,
          configurable: isArrayLength ? false : true,
          writable: isArrayLength ? descriptor.writable : true
        });
      } else {
        Object.defineProperty(target, key, {
          get: descriptor.get
            ? () => mapValue(Reflect.apply(descriptor.get!, source, []))
            : undefined,
          set: descriptor.set ? rejectReadonlyMutation : undefined,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        });
      }
    }
    return target;
  };

  if (source instanceof Date) {
    const target = new Date(source.getTime());
    Object.setPrototypeOf(target, mapPrototype(Object.getPrototypeOf(source)));
    return copyProperties(target);
  }
  if (source instanceof RegExp) {
    const target = new RegExp(source.source, source.flags);
    target.lastIndex = source.lastIndex;
    Object.setPrototypeOf(target, mapPrototype(Object.getPrototypeOf(source)));
    return copyProperties(target, 'lastIndex');
  }
  if (source instanceof Map) {
    const target = new Map<unknown, unknown>();
    Object.setPrototypeOf(target, mapPrototype(Object.getPrototypeOf(source)));
    forEachIteratorValue(readMapEntries(source), ([key, value]) => target.set(key, value));
    return copyProperties(target);
  }
  if (source instanceof Set) {
    const target = new Set<unknown>();
    Object.setPrototypeOf(target, mapPrototype(Object.getPrototypeOf(source)));
    forEachIteratorValue(readSetValues(source), (value) => target.add(value));
    return copyProperties(target);
  }
  const target =
    targetOverride ??
    (Array.isArray(source) ? [] : Object.create(mapPrototype(Object.getPrototypeOf(source))));
  if (targetOverride || Array.isArray(source))
    Object.setPrototypeOf(target, mapPrototype(Object.getPrototypeOf(source)));
  return copyProperties(target);
};

/** Read Map entries through the captured native reader, bypassing subclass iteration hooks. */
const readMapEntries = (value: Map<unknown, unknown>): Iterator<[unknown, unknown]> =>
  Reflect.apply(capturedMapReaders.entries, value, []);

/** Read Set values through the captured native reader, bypassing subclass iteration hooks. */
const readSetValues = (value: Set<unknown>): Iterator<unknown> =>
  Reflect.apply(capturedSetReaders.values, value, []);

/** Unique probe key used only to test native Map internal-slot presence. */
const mapBrandProbe = {};
/** Unique probe value used only to test native Set internal-slot presence. */
const setBrandProbe = {};

/** Distinguish a branded Map instance from a custom prototype inheriting Map.prototype. */
const isBrandedMap = (value: object): value is Map<unknown, unknown> => {
  try {
    Reflect.apply(capturedMapReaders.has, value, [mapBrandProbe]);
    return true;
  } catch {
    return false;
  }
};

/** Distinguish a branded Set instance from a custom prototype inheriting Set.prototype. */
const isBrandedSet = (value: object): value is Set<unknown> => {
  try {
    Reflect.apply(capturedSetReaders.has, value, [setBrandProbe]);
    return true;
  } catch {
    return false;
  }
};

/** Clone configuration values once at an ownership boundary while preserving shared subtrees. */
const cloneConfigValue = (
  value: unknown,
  seen: WeakMap<object, unknown>,
  allowNonWritablePrototype = false
): unknown => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  const rawValue = unwrapReadonlyValue(value) as object;
  const existing = seen.get(rawValue);
  if (existing !== undefined) return existing;
  if (typeof rawValue === 'function') {
    assertSupportedCallable(rawValue, allowNonWritablePrototype);
    const constructable = isConstructable(rawValue);
    /** Callable owned clone forwards behavior while allowing its own data graph to be cloned. */
    const clone = constructable
      ? function (this: unknown, ...args: unknown[]): unknown {
          if (new.target !== undefined) return Reflect.construct(rawValue, args, new.target);
          return Reflect.apply(rawValue, this, args);
        }
      : new Proxy((...args: unknown[]): unknown => Reflect.apply(rawValue, undefined, args), {
          apply(_target, thisArg, args) {
            return Reflect.apply(rawValue, thisArg, args);
          }
        });
    seen.set(rawValue, clone);
    Object.setPrototypeOf(clone, cloneOwnedPrototype(rawValue, seen));
    if (constructable) {
      const prototypeDescriptor = Object.getOwnPropertyDescriptor(rawValue, 'prototype');
      if (prototypeDescriptor && 'value' in prototypeDescriptor)
        clone.prototype = cloneConfigValue(prototypeDescriptor.value, seen);
    }
    for (const key of Reflect.ownKeys(rawValue)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      const descriptor = Object.getOwnPropertyDescriptor(rawValue, key);
      if (!descriptor || !('value' in descriptor)) continue;
      Object.defineProperty(clone, key, {
        value: cloneConfigValue(descriptor.value, seen),
        enumerable: descriptor.enumerable,
        configurable: true,
        writable: descriptor.writable
      });
    }
    if (constructable && !Reflect.ownKeys(rawValue).includes(Symbol.hasInstance))
      defaultCallableHasInstances.add(clone);
    return clone;
  }
  if (rawValue instanceof Date) {
    const clone = new Date(rawValue.getTime());
    seen.set(rawValue, clone);
    Object.setPrototypeOf(clone, cloneOwnedPrototype(rawValue, seen));
    cloneConfigProperties(rawValue, clone, seen);
    return clone;
  }
  if (rawValue instanceof RegExp) {
    const clone = new RegExp(rawValue.source, rawValue.flags);
    clone.lastIndex = rawValue.lastIndex;
    seen.set(rawValue, clone);
    Object.setPrototypeOf(clone, cloneOwnedPrototype(rawValue, seen));
    cloneConfigProperties(rawValue, clone, seen, 'lastIndex');
    return clone;
  }
  if (rawValue instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(rawValue, clone);
    Object.setPrototypeOf(clone, cloneOwnedPrototype(rawValue, seen));
    forEachIteratorValue(readMapEntries(rawValue), ([key, entry]) => {
      clone.set(cloneConfigValue(key, seen), cloneConfigValue(entry, seen));
    });
    cloneConfigProperties(rawValue, clone, seen);
    return clone;
  }
  if (rawValue instanceof Set) {
    const clone = new Set<unknown>();
    seen.set(rawValue, clone);
    Object.setPrototypeOf(clone, cloneOwnedPrototype(rawValue, seen));
    forEachIteratorValue(readSetValues(rawValue), (entry) => {
      clone.add(cloneConfigValue(entry, seen));
    });
    cloneConfigProperties(rawValue, clone, seen);
    return clone;
  }
  // Register shell before cloning custom prototype; prototype edges may point back to rawValue.
  const target = Array.isArray(rawValue) ? [] : Object.create(null);
  seen.set(rawValue, target);
  Object.setPrototypeOf(target, cloneOwnedPrototype(rawValue, seen));
  for (const key of Reflect.ownKeys(rawValue)) {
    if (Array.isArray(rawValue) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(rawValue, key);
    if (!descriptor || !('value' in descriptor)) continue;
    Object.defineProperty(target, key, {
      value: cloneConfigValue(descriptor.value, seen),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
  return target;
};

/** Clone custom prototype data so admitted config cannot follow later source-prototype mutation. */
const cloneConfigPrototype = (source: object, seen: WeakMap<object, unknown>): object => {
  const existing = seen.get(source);
  if (
    existing !== undefined &&
    (typeof existing === 'object' || typeof existing === 'function') &&
    existing !== null
  )
    return existing;
  if (typeof source === 'function' && !intrinsicConstructors.has(source))
    return cloneConfigValue(source, seen, true) as Function;
  assertOwnableCustomPrototype(source);
  const target = Object.create(null) as object;
  seen.set(source, target);
  const parent = Object.getPrototypeOf(source);
  Object.setPrototypeOf(
    target,
    parent === null || intrinsicPrototypes.has(parent) || intrinsicConstructors.has(parent)
      ? parent
      : cloneConfigPrototype(parent, seen)
  );
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    if ('value' in descriptor) {
      Object.defineProperty(target, key, {
        ...descriptor,
        value: cloneConfigValue(descriptor.value, seen, key === 'constructor')
      });
      continue;
    }
    throw createPluginHostTypeError(
      ERROR_TEXT.CONFIG_CALLABLE_UNSUPPORTED('custom prototype accessors are not admitted')
    );
  }
  return target;
};

/** Graph metadata used to identify owned nodes that must be cloned to rebase root cycles. */
type IConfigGraph = {
  readonly nodes: readonly object[];
  readonly parents: WeakMap<object, readonly object[]>;
};

/** Protocol family used by a lazy output facade; async takes precedence over sync. */
type IOutputIteratorKind = 'sync' | 'async';

/** List object-valued edges without invoking config accessors. */
const configObjectChildren = (value: object): readonly object[] => {
  const children: object[] = [];
  const add = (candidate: unknown): void => {
    if (candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function'))
      children.push(candidate);
  };
  if (isBrandedMap(value)) {
    forEachIteratorValue(readMapEntries(value as Map<unknown, unknown>), ([key, entry]) => {
      add(key);
      add(entry);
    });
  } else if (isBrandedSet(value)) {
    forEachIteratorValue(readSetValues(value as Set<unknown>), add);
  }
  /** Custom prototypes are owned graph edges; intrinsic prototypes remain native boundaries. */
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && !intrinsicPrototypes.has(prototype)) add(prototype);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) add(descriptor.value);
  }
  return children;
};

/** Collect config nodes and reverse edges so only root-referencing paths need cloning. */
const collectConfigGraph = (root: object): IConfigGraph => {
  const nodes: object[] = [];
  const parents = new WeakMap<object, readonly object[]>();
  const visited = new WeakSet<object>();
  const pending: object[] = [root];
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    nodes.push(value);
    const children = configObjectChildren(value);
    for (const child of children) {
      const existingParents = parents.get(child);
      parents.set(child, existingParents ? [...existingParents, value] : [value]);
      if (!visited.has(child)) pending.push(child);
    }
  }
  return { nodes, parents };
};

/** Find nodes whose outgoing graph can reach the old root and therefore cannot be shared. */
const findRootReachers = (root: object, graph: IConfigGraph): WeakSet<object> => {
  const rootReachers = new WeakSet<object>();
  const pending: object[] = [root];
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (rootReachers.has(value)) continue;
    rootReachers.add(value);
    for (const parent of graph.parents.get(value) ?? []) pending.push(parent);
  }
  return rootReachers;
};

/** Clone the validated root while preserving cycles that point back to the caller's root. */
const cloneConfigRoot = (record: Record<PropertyKey, unknown>, source: object): IPluginConfig => {
  const target = Object.create(null) as IPluginConfig;
  const seen = new WeakMap<object, unknown>();
  seen.set(unwrapReadonlyValue(source) as object, target);
  seen.set(source, target);
  seen.set(record, target);
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) continue;
    Object.defineProperty(target, key, {
      value: cloneConfigValue(descriptor.value, seen),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
  return target;
};

/**
 * Merge an update patch into an owned config root with cycle-aware copy-on-write semantics.
 * Unchanged subtrees remain owned and shared; every path that points back to the old root is cloned
 * once and rebased to the new root. Patch-owned values are cloned through the same map.
 */
export const copyConfigWithPatch = (
  base: IPluginConfig,
  patch: Record<PropertyKey, unknown>
): IPluginConfig => {
  const target = Object.create(null) as IPluginConfig;
  const graph = collectConfigGraph(base);
  const rootReachers = findRootReachers(base, graph);
  const seen = new WeakMap<object, unknown>();
  seen.set(base, target);
  seen.set(patch, target);
  /** Original patch object retained by validation, including cycles not copied into the record. */
  const patchSource = plainRecordSources.get(patch);
  if (patchSource) {
    seen.set(patchSource, target);
    seen.set(unwrapReadonlyValue(patchSource) as object, target);
  }
  for (const node of graph.nodes) {
    if (node !== base && !rootReachers.has(node)) seen.set(node, node);
  }
  const keys = Reflect.ownKeys(base);
  for (const key of Reflect.ownKeys(patch)) {
    if (!keys.includes(key)) keys.push(key);
  }
  for (const key of keys) {
    const patchDescriptor = Object.getOwnPropertyDescriptor(patch, key);
    const baseDescriptor = Object.getOwnPropertyDescriptor(base, key);
    const descriptor = patchDescriptor ?? baseDescriptor;
    if (!descriptor || !('value' in descriptor)) continue;
    const value =
      patchDescriptor && 'value' in patchDescriptor
        ? patchDescriptor.value
        : baseDescriptor && 'value' in baseDescriptor
          ? baseDescriptor.value
          : undefined;
    Object.defineProperty(target, key, {
      value: cloneConfigValue(value, seen),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
  return target;
};

/**
 * Return an owned configuration snapshot; unchanged subtrees can be shared by copy-on-write
 * updates.
 */
export const copyConfig = (config: IPluginConfig, validationLabel?: string): IPluginConfig => {
  const record = readPlainDataRecord(config, validationLabel ?? 'config', true, true);
  return cloneConfigRoot(record, config);
};

/** Create a lazily materialized, cached readonly view of an owned configuration graph. */
export const readonlyConfig = <T>(value: T): Readonly<T> => {
  /** Cache readonly prototype facades so repeated `Object.getPrototypeOf` calls preserve identity. */
  const readonlyPrototypeViews = new WeakMap<object, object>();
  /** Cache iterator views so repeated aliases retain one readonly identity without consuming them. */
  const iteratorViews = new WeakMap<object, object>();
  /** Cache safe callable targets while their public proxies are being initialized. */
  const callableTargets = new WeakMap<Function, Function>();
  /** Map one iterator result through the same readonly facade cache as ordinary output objects. */
  const wrapIteratorResult = (result: unknown): unknown => wrap(result);
  /** Find a property descriptor without invoking an accessor on the candidate or its prototypes. */
  const findDescriptor = (
    candidate: object,
    property: PropertyKey
  ): PropertyDescriptor | undefined => {
    let current: object | null = candidate;
    try {
      while (current !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(current, property);
        if (descriptor) return descriptor;
        current = Object.getPrototypeOf(current);
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  /** Return safe prototype facade, keeping null and already-facaded prototypes unchanged. */
  const readonlyPrototype = (source: object | null): object | null => {
    if (source === null) return null;
    if (intrinsicPrototypes.has(source)) return source;
    if (typeof source === 'function') return wrap(source) as object;
    if (readonlyRawValues.has(source)) return source;
    const cached = readonlyPrototypeViews.get(source);
    if (cached) return cached;
    const target = Object.create(null) as object;
    const proxy = new Proxy(target, {
      get(target, property, receiver) {
        return Reflect.get(target, property, receiver);
      },
      set: rejectReadonlyMutation,
      deleteProperty: rejectReadonlyMutation,
      defineProperty: rejectReadonlyMutation,
      setPrototypeOf: rejectReadonlyMutation,
      preventExtensions: rejectReadonlyMutation,
      getPrototypeOf: () => readonlyPrototype(Object.getPrototypeOf(source))
    });
    readonlyPrototypeViews.set(source, proxy);
    readonlyProxies.set(source, proxy);
    readonlyRawValues.set(proxy, source);
    const parent = Object.getPrototypeOf(source);
    Object.setPrototypeOf(target, readonlyPrototype(parent));
    for (const property of Reflect.ownKeys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, property);
      if (!descriptor) continue;
      if ('value' in descriptor) {
        Object.defineProperty(target, property, {
          value: wrap(descriptor.value),
          enumerable: descriptor.enumerable,
          configurable: true,
          writable: true
        });
        continue;
      }
      Object.defineProperty(target, property, {
        enumerable: descriptor.enumerable,
        configurable: true,
        get: descriptor.get
          ? function (this: unknown): unknown {
              return wrap(Reflect.apply(descriptor.get!, this, []));
            }
          : undefined,
        set: rejectReadonlyMutation
      });
    }
    return proxy;
  };

  /** Detect iterator-like results from descriptor shape only; accessor values stay lazy. */
  const readOutputIteratorKind = (candidate: object): IOutputIteratorKind | undefined => {
    const nextDescriptor = findDescriptor(candidate, 'next');
    if (!nextDescriptor) return undefined;
    if ('value' in nextDescriptor && typeof nextDescriptor.value !== 'function') return undefined;
    const asyncDescriptor = findDescriptor(candidate, Symbol.asyncIterator);
    if (asyncDescriptor) {
      if (!('value' in asyncDescriptor) || typeof asyncDescriptor.value === 'function')
        return 'async';
    }
    const syncDescriptor = findDescriptor(candidate, Symbol.iterator);
    if (syncDescriptor) {
      if (!('value' in syncDescriptor) || typeof syncDescriptor.value === 'function') return 'sync';
    }
    return asyncDescriptor || syncDescriptor ? undefined : 'sync';
  };

  /** Identify iterator protocol and advancement keys whose functions require the raw receiver. */
  const isIteratorMethodKey = (property: PropertyKey): boolean =>
    property === 'next' ||
    property === 'return' ||
    property === 'throw' ||
    property === Symbol.iterator ||
    property === Symbol.asyncIterator;
  /** Distinguish a deliberately captured undefined method from an uncaptured property read. */
  const uncapturedIteratorMethod = Symbol('uncaptured iterator method');
  /** Create one iterator method facade while retaining the raw iterator receiver. */
  const createIteratorMethod = (
    iterator: object,
    property: PropertyKey,
    kind: IOutputIteratorKind,
    capturedMethod: unknown = uncapturedIteratorMethod
  ): unknown => {
    const method =
      capturedMethod === uncapturedIteratorMethod
        ? Reflect.get(iterator, property, iterator)
        : capturedMethod;
    if (typeof method !== 'function') return wrap(method);
    if (
      (property === Symbol.iterator && kind === 'sync') ||
      (property === Symbol.asyncIterator && kind === 'async')
    )
      return (...args: unknown[]) => {
        const produced = Reflect.apply(method, iterator, args);
        if (produced === iterator) return readonlyProxies.get(iterator);
        return wrap(produced);
      };
    if (property === 'next' || property === 'return' || property === 'throw')
      return (...args: unknown[]) => {
        const result = Reflect.apply(method, iterator, args);
        return kind === 'async' ? wrap(result) : wrapIteratorResult(result);
      };
    return (...args: unknown[]) => Reflect.apply(method, iterator, args);
  };

  /** Populate a fresh iterator target without exposing locked raw property values. */
  const initializeIteratorTarget = (
    target: object,
    iterator: object,
    kind: IOutputIteratorKind
  ): void => {
    for (const property of Reflect.ownKeys(iterator)) {
      const descriptor = Object.getOwnPropertyDescriptor(iterator, property);
      if (!descriptor) continue;
      if ('value' in descriptor) {
        const value = isIteratorMethodKey(property)
          ? createIteratorMethod(iterator, property, kind, descriptor.value)
          : wrap(descriptor.value);
        Object.defineProperty(target, property, { ...descriptor, value });
        continue;
      }
      Object.defineProperty(target, property, {
        get: descriptor.get
          ? () => {
              const value = Reflect.get(iterator, property, iterator);
              return isIteratorMethodKey(property)
                ? createIteratorMethod(iterator, property, kind, value)
                : wrap(value);
            }
          : undefined,
        set: rejectReadonlyMutation,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable
      });
    }
    if (!Object.isExtensible(iterator)) Reflect.preventExtensions(target);
  };

  /** Create a lazy iterator facade that preserves raw receiver, return/throw, errors, and aliases. */
  const createIteratorView = (iterator: object, kind: IOutputIteratorKind): object => {
    const cached = iteratorViews.get(iterator);
    if (cached) return cached;
    const target = Object.create(null) as object;
    const proxy = new Proxy(target, {
      get(target, property, receiver) {
        if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
        if (isIteratorMethodKey(property)) return createIteratorMethod(iterator, property, kind);
        return wrap(Reflect.get(iterator, property, iterator));
      },
      set: rejectReadonlyMutation,
      deleteProperty: rejectReadonlyMutation,
      defineProperty: rejectReadonlyMutation,
      setPrototypeOf: rejectReadonlyMutation,
      preventExtensions: rejectReadonlyMutation
    });
    iteratorViews.set(iterator, proxy);
    readonlyProxies.set(iterator, proxy);
    readonlyRawValues.set(proxy, iterator);
    Reflect.setPrototypeOf(target, wrap(Object.getPrototypeOf(iterator)) as object | null);
    initializeIteratorTarget(target, iterator, kind);
    return proxy;
  };
  /** Protect one object-like callable output without taking ownership of arbitrary application data. */
  const protectCallableOutput = (result: unknown): unknown => {
    if (result === null || (typeof result !== 'object' && typeof result !== 'function'))
      return result;
    return wrap(result);
  };
  /** Cache construction targets so `new.target` exposes readonly callable properties. */
  const constructionTargets = new WeakMap<Function, Function>();
  /** Build an ordinary prototype whose inherited config values remain readonly. */
  const getConstructionPrototype = (prototype: object): object => {
    const cached = constructionPrototypes.get(prototype);
    if (cached) return cached;
    const constructionPrototype = Object.create(Object.getPrototypeOf(prototype)) as object;
    constructionPrototypes.set(prototype, constructionPrototype);
    for (const key of Reflect.ownKeys(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (!descriptor || !('value' in descriptor)) continue;
      Object.defineProperty(constructionPrototype, key, {
        value: wrap(descriptor.value),
        enumerable: descriptor.enumerable,
        configurable: true,
        writable: true
      });
    }
    return constructionPrototype;
  };
  /** Create a private `new.target` facade with mutable instance prototypes and readonly config. */
  const getConstructionTarget = (target: Function): Function => {
    const cached = constructionTargets.get(target);
    if (cached) return cached;
    const prototype = Reflect.get(target, 'prototype', target) as object;
    const constructionPrototype = getConstructionPrototype(prototype);
    callableConstructionPrototypes.set(target, constructionPrototype);
    const constructionTarget = new Proxy(target, {
      get(source, property, receiver) {
        if (property === 'prototype') return constructionPrototype;
        return wrap(Reflect.get(source, property, receiver));
      },
      getOwnPropertyDescriptor(source, property) {
        const descriptor = Object.getOwnPropertyDescriptor(source, property);
        if (!descriptor || !('value' in descriptor)) return descriptor;
        return {
          ...descriptor,
          value: property === 'prototype' ? constructionPrototype : wrap(descriptor.value)
        };
      },
      set: rejectReadonlyMutation,
      deleteProperty: rejectReadonlyMutation,
      defineProperty: rejectReadonlyMutation,
      setPrototypeOf: rejectReadonlyMutation,
      preventExtensions: rejectReadonlyMutation
    });
    constructionTargets.set(target, constructionTarget);
    return constructionTarget;
  };

  /** Create callable forwarding target with no raw output properties behind proxy invariants. */
  const createCallableForwardingTarget = (source: Function): Function => {
    const target = isConstructable(source)
      ? function (this: unknown, ...args: unknown[]): unknown {
          return Reflect.apply(source, this, args);
        }
      : (...args: unknown[]) => Reflect.apply(source, undefined, args);
    callableTargets.set(source, target);
    return target;
  };

  /** Copy callable output descriptors after proxy registration, preserving cycles and locked values. */
  const initializeCallableForwardingTarget = (source: Function, target: Function): void => {
    Reflect.setPrototypeOf(target, wrap(Object.getPrototypeOf(source)) as object | null);
    if (isConstructable(source)) defaultCallableHasInstances.add(target);
    for (const property of Reflect.ownKeys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, property);
      if (!descriptor) continue;
      if ('value' in descriptor) {
        const value = wrap(descriptor.value);
        Object.defineProperty(target, property, { ...descriptor, value });
        continue;
      }
      Object.defineProperty(target, property, {
        get: descriptor.get ? () => wrap(Reflect.get(source, property, source)) : undefined,
        set: rejectReadonlyMutation,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable
      });
    }
    if (!Object.isExtensible(source)) Reflect.preventExtensions(target);
  };
  const wrap = (candidate: unknown): unknown => {
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function'))
      return candidate;
    if (readonlyRawValues.has(candidate)) return candidate;
    const cached = readonlyProxies.get(candidate);
    if (cached) return cached;
    const probe = probeThenable(candidate);
    if (probe.kind === 'failed') {
      const rejected = Promise.reject(probe.error);
      readonlyProxies.set(candidate, rejected);
      readonlyRawValues.set(rejected, candidate);
      void rejected.catch(() => undefined);
      return rejected;
    }
    if (probe.kind === 'thenable') {
      const mapped = assimilateCapturedThen<unknown>(probe.thenFn, candidate).then((fulfilled) =>
        wrap(fulfilled)
      );
      readonlyProxies.set(candidate, mapped);
      readonlyRawValues.set(mapped, candidate);
      void mapped.catch(() => undefined);
      return mapped;
    }
    if (typeof candidate === 'object') {
      const iteratorKind = readOutputIteratorKind(candidate);
      if (iteratorKind !== undefined) return createIteratorView(candidate, iteratorKind);
    }
    const ordinaryFacadeTarget =
      typeof candidate === 'object' &&
      !(candidate instanceof Date) &&
      !(candidate instanceof RegExp) &&
      !(candidate instanceof Map) &&
      !(candidate instanceof Set);
    const target =
      typeof candidate === 'function'
        ? createCallableForwardingTarget(candidate)
        : ordinaryFacadeTarget
          ? Array.isArray(candidate)
            ? []
            : Object.create(null)
          : createReadonlyFacadeTarget(candidate, wrap, readonlyPrototype);
    const proxy = new Proxy(target, {
      get(target, property, receiver) {
        const descriptor = findDescriptor(candidate, property);
        const protocolAccessor =
          (property === 'next' ||
            property === 'return' ||
            property === 'throw' ||
            property === Symbol.iterator ||
            property === Symbol.asyncIterator) &&
          descriptor !== undefined &&
          !('value' in descriptor);
        const value = protocolAccessor
          ? Reflect.get(candidate, property, candidate)
          : target instanceof Date || target instanceof RegExp
            ? Reflect.get(target, property, target)
            : target instanceof Map && property === 'size'
              ? Reflect.get(target, property, target)
              : target instanceof Set && property === 'size'
                ? Reflect.get(target, property, target)
                : Reflect.get(target, property, receiver);
        if (
          property === Symbol.hasInstance &&
          typeof candidate === 'function' &&
          (defaultCallableHasInstances.has(candidate) ||
            defaultCallableHasInstances.has(target as Function))
        ) {
          const instanceCallable = defaultCallableHasInstances.has(candidate)
            ? candidate
            : (target as Function);
          return (instance: unknown) => isOwnedCallableInstance(instanceCallable, instance);
        }
        if (property === Symbol.asyncIterator && typeof value === 'function')
          return (...args: unknown[]) => {
            const iterator = Reflect.apply(value, candidate, args);
            return wrap(iterator);
          };
        if (property === Symbol.iterator && typeof value === 'function')
          return (...args: unknown[]) => {
            const iterator = Reflect.apply(value, candidate, args);
            if (iterator === target) return proxy;
            return wrap(iterator);
          };
        if (typeof value !== 'function') return wrap(value);
        if (target instanceof Date) {
          if (property === 'setTime' || String(property).startsWith('set'))
            return rejectReadonlyMutation;
          return (...args: unknown[]) => Reflect.apply(value, target, args);
        }
        if (target instanceof Map) {
          if (property === 'set' || property === 'delete' || property === 'clear')
            return rejectReadonlyMutation;
          if (property === 'get' && value === capturedMapReaders.get)
            return (key: unknown) => wrap(Reflect.apply(value, target, [unwrap(key)]));
          if (property === 'has' && value === capturedMapReaders.has)
            return (key: unknown) => Reflect.apply(value, target, [unwrap(key)]);
          if (
            (property === 'entries' && value === capturedMapReaders.entries) ||
            (property === Symbol.iterator && value === capturedMapReaders.iterator)
          )
            return function* (): IterableIterator<[unknown, unknown]> {
              const iterator = Reflect.apply(value, target, []) as IterableIterator<
                [unknown, unknown]
              >;
              let step = iterator.next();
              while (!step.done) {
                const [key, entry] = step.value;
                yield [wrap(key), wrap(entry)];
                step = iterator.next();
              }
            };
          if (property === 'values' && value === capturedMapReaders.values)
            return function* (): IterableIterator<unknown> {
              const iterator = Reflect.apply(value, target, []) as IterableIterator<unknown>;
              let step = iterator.next();
              while (!step.done) {
                yield wrap(step.value);
                step = iterator.next();
              }
            };
          if (property === 'keys' && value === capturedMapReaders.keys)
            return function* (): IterableIterator<unknown> {
              const iterator = Reflect.apply(value, target, []) as IterableIterator<unknown>;
              let step = iterator.next();
              while (!step.done) {
                yield wrap(step.value);
                step = iterator.next();
              }
            };
          if (property === 'forEach' && value === capturedMapReaders.forEach)
            return (
              callback: (value: unknown, key: unknown, map: ReadonlyMap<unknown, unknown>) => void
            ) => {
              Reflect.apply(value, target, [
                (entry: unknown, key: unknown) =>
                  callback(wrap(entry), wrap(key), proxy as ReadonlyMap<unknown, unknown>)
              ]);
            };
          return (...args: unknown[]) => Reflect.apply(value, proxy, args);
        }
        if (target instanceof Set) {
          if (property === 'add' || property === 'delete' || property === 'clear')
            return rejectReadonlyMutation;
          if (property === 'has' && value === capturedSetReaders.has)
            return (entry: unknown) => Reflect.apply(value, target, [unwrap(entry)]);
          if (
            (property === 'values' && value === capturedSetReaders.values) ||
            (property === 'keys' && value === capturedSetReaders.keys) ||
            (property === Symbol.iterator && value === capturedSetReaders.iterator)
          )
            return function* (): IterableIterator<unknown> {
              const iterator = Reflect.apply(value, target, []) as IterableIterator<unknown>;
              let step = iterator.next();
              while (!step.done) {
                yield wrap(step.value);
                step = iterator.next();
              }
            };
          if (property === 'entries' && value === capturedSetReaders.entries)
            return function* (): IterableIterator<[unknown, unknown]> {
              const iterator = Reflect.apply(value, target, []) as IterableIterator<
                [unknown, unknown]
              >;
              let step = iterator.next();
              while (!step.done) {
                const [key, entry] = step.value;
                yield [wrap(key), wrap(entry)];
                step = iterator.next();
              }
            };
          if (property === 'forEach' && value === capturedSetReaders.forEach)
            return (
              callback: (value: unknown, key: unknown, set: ReadonlySet<unknown>) => void
            ) => {
              Reflect.apply(value, target, [
                (entry: unknown) =>
                  callback(wrap(entry), wrap(entry), proxy as ReadonlySet<unknown>)
              ]);
            };
          return (...args: unknown[]) => Reflect.apply(value, proxy, args);
        }
        if (target instanceof RegExp && (property === 'exec' || property === 'test')) {
          return (...args: unknown[]) => Reflect.apply(value, new RegExp(target), args);
        }
        return wrap(value);
      },
      set(target, property, value, receiver) {
        if (receiver !== proxy) return Reflect.set(target, property, value, receiver);
        return rejectReadonlyMutation();
      },
      deleteProperty() {
        return rejectReadonlyMutation();
      },
      defineProperty() {
        return rejectReadonlyMutation();
      },
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(target, property);
        if (!descriptor || !('value' in descriptor)) return descriptor;
        return {
          ...descriptor,
          value: wrap(descriptor.value)
        };
      },
      getPrototypeOf(target) {
        return readonlyPrototype(Object.getPrototypeOf(target));
      },
      setPrototypeOf() {
        return rejectReadonlyMutation();
      },
      preventExtensions() {
        return rejectReadonlyMutation();
      },
      apply(target, thisArg, args) {
        return protectCallableOutput(Reflect.apply(candidate as Function, thisArg, args));
      },
      construct(target, args, newTarget) {
        if (typeof candidate !== 'function' || !isConstructable(candidate))
          return Reflect.construct(candidate as Function, args, newTarget);
        const ownedNewTarget = unwrap(newTarget);
        if (defaultCallableHasInstances.has(candidate as Function)) {
          const constructionNewTarget =
            ownedNewTarget === candidate
              ? getConstructionTarget(candidate as Function)
              : (ownedNewTarget as Function);
          const result = Reflect.construct(candidate, args, constructionNewTarget);
          if (result === null || (typeof result !== 'object' && typeof result !== 'function'))
            return result;
          const expectedPrototype = Reflect.get(
            constructionNewTarget,
            'prototype',
            constructionNewTarget
          );
          if (ownedNewTarget === candidate && expectedPrototype !== null)
            callableConstructionPrototypes.set(candidate, expectedPrototype as object);
          if (Object.getPrototypeOf(result) === expectedPrototype) return result;
          return cloneConfigValue(result, new WeakMap<object, unknown>());
        }
        const result = Reflect.construct(candidate, args, newTarget);
        return protectCallableOutput(result);
      }
    });
    readonlyProxies.set(candidate, proxy);
    readonlyRawValues.set(proxy, candidate);
    if (ordinaryFacadeTarget)
      createReadonlyFacadeTarget(candidate, wrap, readonlyPrototype, target);
    if (typeof candidate === 'function')
      initializeCallableForwardingTarget(candidate, target as Function);
    return proxy;
  };
  const unwrap = (candidate: unknown): unknown => {
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function'))
      return candidate;
    return readonlyRawValues.get(candidate) ?? candidate;
  };
  return wrap(value) as Readonly<T>;
};

/** Parse `key.[0].nested` paths without accepting prototype-related segments. */
export const parseConfigPath = (path: string): string[] => {
  if (typeof path !== 'string' || path.length === 0)
    throw createPluginHostTypeError('config path must be a non-empty string');
  const segments: string[] = [];
  for (const part of path.split('.')) {
    if (part.length === 0) throw createPluginHostTypeError('config path contains an empty segment');
    const match = /^\[(\d+)\]$/.exec(part);
    const segment = match ? match[1] : part;
    if (!segment || dangerousKeys.has(segment))
      throw createPluginHostTypeError(`config path key "${segment}" is not allowed`);
    if (!match && (segment.includes('[') || segment.includes(']')))
      throw createPluginHostTypeError(`config path segment "${segment}" is invalid`);
    segments.push(segment);
  }
  return segments;
};

/** Read one nested config value and expose objects through a cached readonly lazy proxy. */
export const readConfigPath = (config: IPluginConfig, segments: readonly string[]): unknown => {
  let current: unknown = config;
  for (const segment of segments.slice(1)) {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function'))
      return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return readonlyConfig(current);
};
