import type { IDisposable, IRuntime } from '@migaia/reactive';
import type { IAtomDefinition } from '../atom/definition';

/**
 * Atom 协议：只有形状与跨 Runtime 校验，没有实现。
 *
 * 实例式的 `PrimitiveAtom`/`DerivedAtom` 已经搬到 `atom/legacy.ts`——它们建立在 Definition + AtomStore 之上，属于
 * facade 层。这个文件留在内核目录里，因为 async / family / react 都只需要这套类型，不该为此认识实例化层。
 */

export type IReadableAtom<T> = IDisposable & {
  readonly runtime: IRuntime;
  /** Pure definition bridge used by the Provider-scoped React adapter. */
  readonly atomDefinition?: IAtomDefinition<any>;
  readonly value: T;
  readonly observed: boolean;
  read(): T;
  /**
   * 非追踪读。
   *
   * React 适配层的 getSnapshot 可能在任意时刻被调用，包括另一个组件正在 捕获依赖的窗口内。用 `.value` 会把这次读记进别人的依赖集合，造成串边；
   * 必须有一条明确不建边的读法。
   */
  peek(): T;
};

export type IWritableAtom<T, Args extends readonly unknown[], Result> = IReadableAtom<T> & {
  write(...args: Args): Result;
};

export type IAtomGetter = <T>(atom: IReadableAtom<T>) => T;

export type IAtomSetter = <T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>,
  ...args: Args
) => Result;

export type IAtomRead<T> = (get: IAtomGetter) => T;

export type IAtomWrite<Args extends readonly unknown[], Result> = (
  get: IAtomGetter,
  set: IAtomSetter,
  ...args: Args
) => Result;

export type IAtomUpdate<T> = T | ((previous: T) => T);

function assertSameRuntime(runtime: IRuntime, atom: IReadableAtom<unknown>): void {
  if (atom.runtime !== runtime) {
    throw new Error('[store] cross-runtime atom access is not allowed');
  }
}

/**
 * 构造一个绑定到指定 Runtime 的 getter。
 *
 * 导出是因为它属于 atom 协议本身：async / family 这类扩展层要在自己的节点里 复用同一套跨 runtime 校验，不该各写一份。
 */
export function atomGetter(runtime: IRuntime): IAtomGetter {
  return <T>(atom: IReadableAtom<T>): T => {
    assertSameRuntime(runtime, atom);
    return atom.value;
  };
}

export function atomSetter(runtime: IRuntime): IAtomSetter {
  return <T, Args extends readonly unknown[], Result>(
    atom: IWritableAtom<T, Args, Result>,
    ...args: Args
  ): Result => {
    assertSameRuntime(runtime, atom);
    return atom.write(...args);
  };
}
