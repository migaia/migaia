import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IDisposable, IRuntime } from '@migaia/reactive'
import { StoreFieldMode } from './field-mode-constants.ts'

/**
 * Defines extension protocols owned by the store facade.
 *
 * Field builders, mutation policies, and raw values previously lived in separate WASM, middleware,
 * and raw modules. That made `reactive-store.ts` import concrete platform implementations into the
 * facade.
 *
 * The store defines the protocols and extensions implement them. WASM fields and mutation policies
 * implement these interfaces without the store depending on their concrete types.
 */

// Field construction protocol.
// Symbol branding distinguishes builders from arbitrary field values without structural guessing.
export const FIELD_BUILDER = Symbol('store.field-builder')

/**
 * Provides the runtime's minimal reactive field capabilities without exposing dependency graph
 * internals.
 */
export type IFieldSource = IDisposable & {
  track(): void
  notify(): void
  /** Reserve the Runtime version before mutating external storage, then publish once. */
  commit<T>(write: () => T): T
  readonly observed: boolean
}

/**
 * Provides `runtime` for ordinary nodes and `createSource` for custom storage in the same graph.
 * `signal` aborts in-flight initialization when the store is disposed.
 *
 * The store owns resource registration, so this context does not expose its scope. Delegating
 * registration to builders could leak resources when a third-party builder omits registration.
 */
export type IFieldContext = {
  runtime: IRuntime
  signal: INativeAbortSignal
  createSource(debugName?: string): IFieldSource
}

export type ISyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: typeof StoreFieldMode.sync
  create(context: IFieldContext): F
}

export type IAsyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: typeof StoreFieldMode.async
  create(context: IFieldContext): Promise<F>
}

/** Builders select synchronous construction or asynchronous initialization explicitly. */
export type IFieldBuilder<F extends IDisposable> = ISyncFieldBuilder<F> | IAsyncFieldBuilder<F>

export function isFieldBuilder(value: unknown): value is IFieldBuilder<IDisposable> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[FIELD_BUILDER] === true
    )
  } catch {
    // A brand that cannot be read is not admitted by this unknown-value predicate.
    return false
  }
}

// Mutation guard protocol.
// Stores and collections ask only whether mutation is allowed.
// Policies such as `actions-only` belong to middleware instead of the facade types.
export type IMutationGuard = {
  assertMutationAllowed(operation?: string): void
}

/**
 * Marks an action scope so the mutation guard permits writes within it.
 *
 * Collections need only `IMutationGuard`, not action scopes. The store facade uses this additional
 * capability.
 */
export type IMutationPolicy = IMutationGuard & {
  runInAction<T>(fn: () => T): T
}

// —— 原样值标记 ——
//
// createStore 里 `typeof value === 'function'` 会把函数型初值误当方法包装成 action，
// 于是存不下函数状态（如 onSubmit）。raw(fn) 显式区分：
//   method() {}        → Action（方法简写）
//   callback: raw(fn)  → 普通函数值字段（可读可写可替换）
const RAW = Symbol('store.raw')

export type IRaw<T> = { readonly [RAW]: true; readonly value: T }

export function raw<T>(value: T): IRaw<T> {
  return { [RAW]: true, value }
}

export function isRaw(value: unknown): value is IRaw<unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[RAW] === true
    )
  } catch {
    // A brand that cannot be read is not admitted by this unknown-value predicate.
    return false
  }
}
