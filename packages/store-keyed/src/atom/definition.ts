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

import { createStoreKeyedTypeError, StoreKeyedErrorCode } from '../errors.js';
import { AtomKind } from './kind-constants.js';

// Symbol.for keeps definitions recognizable when two copies of the package
// coexist in one Realm (for example an app bundle plus a worker/devtools copy).
const DEFINITION = Symbol.for('morning-watch.store.atom-definition');

/** 在某个 store 内读另一个定义的当前值。 */
export type IAtomGet = <T>(definition: IAtomDefinition<T>) => T;

/** 在某个 store 内写另一个可写定义。 */
export type IAtomSet = <T, Args extends readonly unknown[], Result>(
  definition: IWritableAtomDefinition<T, Args, Result>,
  ...args: Args
) => Result;

export type IAtomRead<T> = (get: IAtomGet) => T;

export type IAtomWriter<Args extends readonly unknown[], Result> = (
  get: IAtomGet,
  set: IAtomSet,
  ...args: Args
) => Result;

export type IAtomUpdate<T> = T | ((previous: T) => T);

type IDefinitionBase = {
  readonly [DEFINITION]: true;
  readonly debugLabel?: string;
};

/** 源定义：只有初值。 */
export type IPrimitiveDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.primitive;
  readonly init: T;
};

/**
 * 每个 AtomStore 首次实例化时各自创建初值。
 *
 * 对象、数组及其它可变容器不应作为跨 Provider/SSR scope 共享的模板引用； 独立 kind 避免把“函数值”误判成初始化函数。
 */
export type IPrimitiveFactoryDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.primitiveFactory;
  readonly create: () => T;
  /** Only explicitly marked factories may execute during speculative preview. */
  readonly previewSafe: boolean;
};

/** 派生定义：只有读函数。 */
export type IDerivedDefinition<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.derived;
  readonly read: IAtomRead<T>;
  /** 自定义相等比较。这里只是个参数，怎么用由 store 层决定。 */
  readonly equals?: (a: T, b: T) => boolean;
};

/** 可写派生定义：读一份、写另一份。 */
export type IWritableDerivedDefinition<
  T,
  Args extends readonly unknown[],
  Result
> = IDefinitionBase & {
  readonly kind: typeof AtomKind.writableDerived;
  readonly read: IAtomRead<T>;
  readonly write: IAtomWriter<Args, Result>;
  readonly equals?: (a: T, b: T) => boolean;
};

/**
 * 读侧的统一形态。
 *
 * 可写派生的 write 在这里被擦除成最宽的形状：读取方根本不关心它的参数， 而把具体 Args 写进联合会让任何一个具体的可写定义都无法赋值进来。 需要写时由
 * `IWritableAtomDefinition` 重新收窄。
 */
type IErasedWritableDerived<T> = IDefinitionBase & {
  readonly kind: typeof AtomKind.writableDerived;
  readonly read: IAtomRead<T>;
  readonly write: (...args: never[]) => unknown;
  readonly equals?: (a: T, b: T) => boolean;
};

export type IAtomDefinition<T> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IDerivedDefinition<T>
  | IErasedWritableDerived<T>;

/** 能被 set 的定义：源定义，或带 write 的派生定义。 */
export type IWritableAtomDefinition<
  T,
  Args extends readonly unknown[] = readonly [IAtomUpdate<T>],
  Result = void
> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IWritableDerivedDefinition<T, Args, Result>;

export const isAtomDefinition = (value: unknown): value is IAtomDefinition<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<PropertyKey, unknown>)[DEFINITION] === true;

/**
 * Rejects thenables: async initial values are not supported here, and a silently-stored unresolved
 * Promise is far harder to debug than an immediate throw. `context` names the call site for the
 * error message.
 */
export function assertNotThenable(value: unknown, context: string): void {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  ) {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      `[store] ${context} returned a thenable — async initial values are not supported here; ` +
        `compose with @migaia/resource instead (e.g. \`familyDef((id) => createResource(() => fetch(id)))\`)`
    );
  }
}

// —— 构造器：只组装描述，不碰任何运行时 ——

export function atomDef<T>(init: T, debugLabel?: string): IPrimitiveDefinition<T> {
  assertNotThenable(init, 'atomDef(init)');
  return Object.freeze({
    [DEFINITION]: true as const,
    kind: AtomKind.primitive,
    init,
    debugLabel
  });
}

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
  });
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
  });
}

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
  });
}

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
  });
}
