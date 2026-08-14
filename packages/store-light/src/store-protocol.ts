import type { IDisposable, IRuntime } from '@migaia/reactive';

/**
 * Store 门面对外开放的扩展协议。
 *
 * 这里的三样东西原本散落在 `wasm/field.ts`、`middleware.ts` 和 `raw.ts`，于是 `reactive-store.ts` 反过来静态 import 了
 * Wasm 与中间件——对象门面本该只是内核的 facade，却认识了平台实现的具体类型。
 *
 * 方向反过来：**Store 定义协议，扩展去实现**。Wasm 字段、变更策略都只是这些接口 的实现者，Store 不需要知道它们存在。
 */

// —— 字段构造协议 ——
//
// symbol 品牌识别而非鸭子类型：字段值本身可能是任意形状，靠结构猜会误判。
export const FIELD_BUILDER = Symbol('store.field-builder');

/** Runtime 为字段签发的最小响应式能力，不暴露依赖图内部结构。 */
export type IFieldSource = IDisposable & {
  track(): void;
  notify(): void;
  /** Reserve the Runtime version before mutating external storage, then publish once. */
  commit<T>(write: () => T): T;
  readonly observed: boolean;
};

/**
 * 构造上下文：runtime 供创建普通节点，createSource 供自定义存储接入同一张图， signal 让 Store dispose 时能中止在途初始化。
 *
 * 刻意不传 scope——所有权登记是 Store 的职责。让 Builder 自己登记的话，第三方实现 一旦「创建了资源却忘了登记」，$dispose 就漏释放，而 Store 无从察觉。
 */
export type FieldContext = {
  runtime: IRuntime;
  signal: AbortSignal;
  createSource(debugName?: string): IFieldSource;
};

export type SyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true;
  readonly mode: 'sync';
  create(context: FieldContext): F;
};

export type AsyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true;
  readonly mode: 'async';
  create(context: FieldContext): Promise<F>;
};

/** Pre-discriminant builder accepted only by legacy creation paths. */
export type LegacyFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true;
  create(context: FieldContext): Promise<F>;
};

export type FieldBuilder<F extends IDisposable> =
  | SyncFieldBuilder<F>
  | AsyncFieldBuilder<F>
  | LegacyFieldBuilder<F>;

export function isFieldBuilder(value: unknown): value is FieldBuilder<IDisposable> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[FIELD_BUILDER] === true
  );
}

// —— 变更守卫协议 ——
//
// Store 与 collections 只需要「能不能改」这一个问题的答案。具体策略（actions-only、
// 严格模式等）属于中间件层，不该出现在门面的类型里。
export type IMutationGuard = {
  assertMutationAllowed(operation?: string): void;
};

/**
 * Store 门面额外需要的一件事：把一次动作标记为「正在动作内」，好让守卫放行其中的写入。
 *
 * 与 IMutationGuard 分开，是因为 collections 只需要问「能不能改」，不该被迫实现 动作作用域。按需要的最小面拆接口，实现方自然满足更大的那个。
 */
export type IMutationPolicy = IMutationGuard & {
  runInAction<T>(fn: () => T): T;
};

// —— 原样值标记 ——
//
// createStore 里 `typeof value === 'function'` 会把函数型初值误当方法包装成 action，
// 于是存不下函数状态（如 onSubmit）。raw(fn) 显式区分：
//   method() {}        → Action（方法简写）
//   callback: raw(fn)  → 普通函数值字段（可读可写可替换）
const RAW = Symbol('store.raw');

export type Raw<T> = { readonly [RAW]: true; readonly value: T };

export function raw<T>(value: T): Raw<T> {
  return { [RAW]: true, value };
}

export function isRaw(value: unknown): value is Raw<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[RAW] === true
  );
}
