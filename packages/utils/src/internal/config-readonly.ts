/** One canonical readonly facade per owned identity, including native collection projection. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { configError, hasBuiltinBrand, metadata } from './config-state.ts'
import { isConfigConstructable } from './config-clone.ts'
import type { IConfigRecord, IOwnedConfig } from './config-contract.ts'

/** Owned objects retain facades only while their identities remain reachable. */
const readonlyCache = new WeakMap<object, object>()
/** Reverse facade lookup never holds its raw graph alive after the facade is released. */
const readonlyRawCache = new WeakMap<object, object>()

/** Fixed mutators are the 20 names forbidden by the readonly collection/temporal contract. */
const readonlyMutators = new Set<PropertyKey>([
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
])

/** Preserve constructable target shape and the original dynamic call receiver. */
function createReadonlyCallable(value: object, constructable: boolean): Function {
  if (constructable)
    return function (this: unknown, ...args: unknown[]): unknown {
      return Reflect.apply(value as (...args: unknown[]) => unknown, this, args)
    }
  return (...args: unknown[]) =>
    Reflect.apply(value as (...args: unknown[]) => unknown, undefined, args)
}

/** Every denied method read creates its own callback, preserving observable method identity. */
function createReadonlyMutation(): () => never {
  return () => {
    throw readonlyMutation()
  }
}

/** RegExp reads snapshot source/flags at property access but isolate lastIndex on every call. */
function createReadonlyRegExpReader(
  source: string,
  flags: string,
  key: string
): (input: string) => unknown {
  return (input: string) => {
    /** This invocation owns its isolated matching cursor and never changes the owned RegExp. */
    const isolated = new RegExp(source, flags)
    return Reflect.apply(
      Reflect.get(isolated, key, isolated) as (...args: unknown[]) => unknown,
      isolated,
      [input]
    )
  }
}

/** A temporal reader keeps the exact function captured by the original property read. */
function createReadonlyNativeReader(
  reader: (...args: unknown[]) => unknown,
  target: object
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => Reflect.apply(reader, target, args)
}

/** Native Map lookup unwraps a facade key only when the returned method is called. */
function createReadonlyMapGet(target: Map<unknown, unknown>): (key: unknown) => unknown {
  return (key: unknown) => readonlyValue(target.get(unwrapReadonly(key)))
}

/** Native membership lookup retains the original object receiver and unwrapping policy. */
function createReadonlyCollectionHas(
  target: Map<unknown, unknown> | Set<unknown>
): (key: unknown) => boolean {
  return (key: unknown) => target.has(unwrapReadonly(key))
}

/** The generator function shape and lazy entry observation match native readonly Map iteration. */
function createReadonlyMapEntries(
  target: Map<unknown, unknown>
): () => Generator<unknown[], void, unknown> {
  return function* () {
    for (const [key, value] of target.entries()) yield [readonlyValue(key), readonlyValue(value)]
  }
}

/** Map key/value iteration captures the requested method name until the generator starts. */
function createReadonlyMapValues(
  target: Map<unknown, unknown>,
  key: 'keys' | 'values'
): () => Generator<unknown, void, unknown> {
  return function* () {
    for (const value of target[key]()) yield readonlyValue(value)
  }
}

/** Set iteration observes each value lazily through the same canonical facade cache. */
function createReadonlySetValues(target: Set<unknown>): () => Generator<unknown, void, unknown> {
  return function* () {
    for (const value of target.values()) yield readonlyValue(value)
  }
}

/** Create an independent Proxy target while preserving callable construction and frozen prototypes. */
function readonlyTarget(value: object, callable: boolean): object {
  /** Native constructability is checked before allocating an independent Proxy target. */
  const constructable = callable && isConfigConstructable(value as Function)
  /** Independent targets allow nested facades even when owned data has frozen descriptors. */
  const target = callable
    ? createReadonlyCallable(value, constructable)
    : Array.isArray(value)
      ? []
      : Object.create(null)
  if (callable && constructable) {
    /** The existing prototype determines native subclass preservation and graph aliasing. */
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

/** Map and Set iteration callbacks receive readonly values and the canonical facade identity. */
type IReadonlyCollectionCallback = (value: unknown, key: unknown, collection: unknown) => void

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
    /** Built-in methods need the owned object's internal slots, never the facade target. */
    const target = value
    if (
      ((target instanceof Map && hasBuiltinBrand(target, 'map')) ||
        (target instanceof Set && hasBuiltinBrand(target, 'set')) ||
        (target instanceof Date && hasBuiltinBrand(target, 'date')) ||
        (target instanceof RegExp && hasBuiltinBrand(target, 'regexp'))) &&
      typeof key === 'string' &&
      readonlyMutators.has(key)
    )
      return createReadonlyMutation()
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'size')
      return target.size
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'size')
      return target.size
    /** Native Date slots select the receiver policy without invoking a value getter. */
    const brandedDate = hasBuiltinBrand(target, 'date')
    /** Native RegExp slots select isolated matching rather than mutating lastIndex. */
    const brandedRegExp = hasBuiltinBrand(target, 'regexp')
    if (brandedRegExp && (key === 'exec' || key === 'test')) {
      /** Read the intrinsic RegExp source accessor with its required native receiver. */
      const sourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
      /** Read the intrinsic RegExp flags accessor only at the original observation point. */
      const flagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get
      /** The property read captures this pattern for later isolated invocations. */
      const rawSource = sourceGetter ? Reflect.apply(sourceGetter, target, []) : ''
      /** The property read captures these flags without changing the owned RegExp cursor. */
      const rawFlags = flagsGetter ? Reflect.apply(flagsGetter, target, []) : ''
      return createReadonlyRegExpReader(rawSource, rawFlags, key)
    }
    if (brandedDate || brandedRegExp) {
      /** Observe the native property once with the raw internal-slot receiver. */
      const intrinsicResult = Reflect.get(target, key, target)
      if (typeof intrinsicResult === 'function')
        return createReadonlyNativeReader(intrinsicResult, target)
      return intrinsicResult
    }
    /** Observe this call or property once before projecting any returned graph identity. */
    const result = Reflect.get(callable && key !== 'prototype' ? value : target, key, receiver)
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'get')
      return createReadonlyMapGet(target)
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'has')
      return createReadonlyCollectionHas(target)
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'has')
      return createReadonlyCollectionHas(target)
    if (target instanceof Map && hasBuiltinBrand(target, 'map') && key === 'forEach')
      return (callback: IReadonlyCollectionCallback) => this.#forEachMap(target, callback)
    if (target instanceof Set && hasBuiltinBrand(target, 'set') && key === 'forEach')
      return (callback: IReadonlyCollectionCallback) => this.#forEachSet(target, callback)
    if (
      target instanceof Map &&
      hasBuiltinBrand(target, 'map') &&
      (key === 'entries' || key === Symbol.iterator)
    )
      return createReadonlyMapEntries(target)
    if (
      target instanceof Map &&
      hasBuiltinBrand(target, 'map') &&
      (key === 'keys' || key === 'values')
    )
      return createReadonlyMapValues(target, key)
    if (
      target instanceof Set &&
      hasBuiltinBrand(target, 'set') &&
      (key === 'values' || key === 'keys' || key === Symbol.iterator)
    )
      return createReadonlySetValues(target)
    return result && (typeof result === 'object' || typeof result === 'function')
      ? readonlyWrap(result)
      : result
  }

  /** Delegate to this exact Map's iteration while projecting every callback value once per slot. */
  #forEachMap(target: Map<unknown, unknown>, callback: IReadonlyCollectionCallback): void {
    target.forEach((mapValue, mapKey) =>
      callback(readonlyValue(mapValue), readonlyValue(mapKey), this.#proxy)
    )
  }

  /** Preserve native Set callback order and its identical value/key facade arguments. */
  #forEachSet(target: Set<unknown>, callback: IReadonlyCollectionCallback): void {
    target.forEach((setValue) =>
      callback(readonlyValue(setValue), readonlyValue(setValue), this.#proxy)
    )
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

    /** Observe this call or property once before projecting any returned graph identity. */
    const result = Reflect.construct(value as Function, args, value as Function)
    /** Ordinary constructor results remain mutable when they use the original callable prototype. */
    const expectedPrototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value
    return Object.getPrototypeOf(result) === expectedPrototype
      ? result
      : (readonlyValue(result) as object)
  }
}

/** Reuse the canonical facade identity; the named owner holds all Proxy behavior and state. */
export function readonlyWrap(value: object): object {
  /** Reentrant graph reads share the already-created facade. */
  const existing = readonlyCache.get(value)
  return existing ?? new ReadonlyFacade(value).proxy
}

/** Membership and lookup arguments recover their original owned identity when given a facade. */
function unwrapReadonly(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  return readonlyRawCache.get(value) ?? value
}

/** Every mutation trap creates the same coded native error without changing the owned graph. */
function readonlyMutation(): TypeError {
  return configError(UtilsErrorCode.configReadonly, 'config', ConfigReason.readonlyMutation)
}

/** Project only graph identities; primitive values retain their exact value semantics. */
function readonlyValue(value: unknown): unknown {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? readonlyWrap(value)
    : value
}
/**
 * Returns a cached read-only view of an owned config. Every write, including `Map` / `Set` / `Date`
 * mutators and nested values, throws a `TypeError` with `CONFIG_READONLY`; reads see the owned data
 * without copying it. Throws `CONFIG_UNSUPPORTED` when `value` did not come from `ownConfig`.
 */
export function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T {
  if (!metadata.has(value as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', ConfigReason.valueNotOwned)
  return readonlyWrap(value) as T
}
