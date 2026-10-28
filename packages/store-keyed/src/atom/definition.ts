/**
 * 纯定义层。
 *
 * **这个文件不 import 内核**——一个描述若需要 Signal、Computed 或 Runtime 才能 成立，它就不是描述，而是一份提前绑定的实现。此前 definition 上挂着
 * `instantiate(scope)`，等于把「怎么建节点」写进了「这是什么」里：实例化层因此 无法替换，定义也无法在没有内核的场合独立存在。
 *
 * 所以定义退化成一个带品牌的**判别联合**：只说明种类与参数，怎么建由 store 层决定。
 *
 * 分层：kernel → atom-definition（此处）→ atom-store → atom facade → React
 */

import { probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { createStoreKeyedTypeError, StoreKeyedErrorCode } from '../errors.ts'
import { AtomKind } from './kind-constants.ts'
import { StoreKeyedErrorText } from '../error-text.ts'

// Symbol.for keeps definitions recognizable when two copies of the package
// coexist in one Realm (for example an app bundle plus a same-realm devtools copy).
const DEFINITION = Symbol.for('morning-watch.store.atom-definition')

/** Reads another definition's current value within a store. */
export type IAtomGet = <T>(definition: IAtomDefinition<T>) => T

/**
 * Writes another writable definition within a store. The source-definition overload comes first so
 * an updater's `previous` parameter is typed from the definition instead of falling back to `any`.
 */
export type IAtomSet = {
  <T>(
    definition: IPrimitiveDefinition<T> | IPrimitiveFactoryDefinition<T>,
    update: IAtomUpdate<T>
  ): void
  <T, Args extends readonly unknown[], Result>(
    definition: IWritableAtomDefinition<T, Args, Result>,
    ...args: Args
  ): Result
}

/** Reads other definitions of the same store through `get` and returns the derived value. */
export type IAtomRead<T> = (get: IAtomGet) => T

/**
 * Write logic of a writable derived definition; `get`/`set` act on the same store, `args` come from
 * `store.set(def, ...args)`.
 */
export type IAtomWriter<Args extends readonly unknown[], Result> = (
  get: IAtomGet,
  set: IAtomSet,
  ...args: Args
) => Result

/** A new value, or a function computing it from the previous one. */
export type IAtomUpdate<T> = T | ((previous: T) => T)

type IDefinitionBase = {
  readonly [DEFINITION]: true
  readonly debugLabel?: string
}

/** Describes a source atom with its initial value. */
export type IPrimitiveDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.primitive
  readonly init: T
}

/**
 * Creates an independent initial value when each `AtomStore` first instantiates the definition.
 *
 * Objects, arrays, and other mutable containers must not share template references across provider
 * or SSR scopes. A separate kind distinguishes a function value from an initialization factory.
 */
export type IPrimitiveFactoryDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.primitiveFactory
  readonly create: () => T
  /** Only explicitly marked factories may execute during speculative preview. */
  readonly previewSafe: boolean
}

/** Describes a derived atom through its read function. */
export type IDerivedDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.derived
  readonly read: IAtomRead<T>
  /** Provides an equality comparison for the store layer to apply. */
  readonly equals?: (a: T, b: T) => boolean
}

/** Describes a derived atom that reads one value and writes another. */
export type IWritableDerivedDefinition<
  T,
  Args extends readonly unknown[],
  Result
> = IDefinitionBase & {
  readonly kind: typeof AtomKind.writableDerived
  readonly read: IAtomRead<T>
  readonly write: IAtomWriter<Args, Result>
  readonly equals?: (a: T, b: T) => boolean
}

/**
 * 读侧的统一形态。
 *
 * 可写派生的 write 在这里被擦除成最宽的形状：读取方根本不关心它的参数， 而把具体 Args 写进联合会让任何一个具体的可写定义都无法赋值进来。 需要写时由
 * `IWritableAtomDefinition` 重新收窄。
 */
type IErasedWritableDerived<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.writableDerived
  readonly read: IAtomRead<T>
  readonly write: (...args: never[]) => unknown
  readonly equals?: (a: T, b: T) => boolean
}

/** Any definition a store can read: source, factory source, derived or writable derived. */
export type IAtomDefinition<T> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IDerivedDefinition<T>
  | IErasedWritableDerived<T>

/** Accepts writes to a source definition or a derived definition with `write`. */
export type IWritableAtomDefinition<
  T,
  Args extends readonly unknown[] = readonly [IAtomUpdate<T>],
  Result = void
> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IWritableDerivedDefinition<T, Args, Result>

/** Unknown-value predicate: a brand that cannot be read is not admitted. */
export const isAtomDefinition = (value: unknown): value is IAtomDefinition<unknown> => {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[DEFINITION] === true
    )
  } catch {
    return false
  }
}

/**
 * Rejects thenables: async initial values are not supported here, and a silently-stored unresolved
 * Promise is far harder to debug than an immediate throw. `context` names the call site for the
 * error message.
 */
export function assertNotThenable(value: unknown, context: string): void {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.failed) {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.thenable(context),
      { cause: probe.error }
    )
  }
  if (probe.kind === ThenableProbeKind.thenable) {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.thenable(context)
    )
  }
}

// Constructors assemble descriptions without accessing a runtime.

/**
 * Defines source state with an initial value. The definition holds no value; each store keeps its
 * own copy, cloning object and array initial values. Thenable initial values throw
 * `INVALID_OPTION`.
 */
export function atomDef<T>(init: T, debugLabel?: string): IPrimitiveDefinition<T> {
  assertNotThenable(init, 'atomDef(init)')
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.primitive,
    init,
    debugLabel
  })
}

/**
 * Defines source state whose initial value comes from `create()`, called once per store on first
 * read. Not allowed in `store.preview()`; use `previewSafeAtomDefFactory` for pure factories.
 */
export function atomDefFactory<T>(
  create: () => T,
  debugLabel?: string
): IPrimitiveFactoryDefinition<T> {
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.primitiveFactory,
    create,
    previewSafe: false,
    debugLabel
  })
}

/**
 * Creates a factory whose body is explicitly allowed during speculative React preview. The function
 * must be pure, deterministic, and free of externally visible effects because preview may be
 * abandoned.
 */
export function previewSafeAtomDefFactory<T>(
  create: () => T,
  debugLabel?: string
): IPrimitiveFactoryDefinition<T> {
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.primitiveFactory,
    create,
    previewSafe: true,
    debugLabel
  })
}

/**
 * Defines a read-only value computed from other definitions of the same store; recomputed when what
 * it reads changes, compared with `equals` (default `Object.is`).
 */
export function derivedDef<T>(
  read: IAtomRead<T>,
  debugLabel?: string,
  equals?: (a: T, b: T) => boolean
): IDerivedDefinition<T> {
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.derived,
    read,
    debugLabel,
    equals
  })
}

/**
 * Defines a derived value with custom write logic: `store.set(def, ...args)` calls `write(get, set,
 * ...args)` and returns its result.
 */
export function writableDef<T, Args extends readonly unknown[], Result>(
  read: IAtomRead<T>,
  write: IAtomWriter<Args, Result>,
  debugLabel?: string,
  equals?: (a: T, b: T) => boolean
): IWritableDerivedDefinition<T, Args, Result> {
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.writableDerived,
    read,
    write,
    debugLabel,
    equals
  })
}
