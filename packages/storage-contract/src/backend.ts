import type { ITransactionBuilder } from './concurrency.js'

/** Canonical provider label syntax shared by base and KV admission. */
export const BACKEND_KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/** Checks diagnostic backend syntax without admitting a store or granting any capability. */
export function isBackendKind(value: unknown): value is string {
  return typeof value === 'string' && BACKEND_KIND_PATTERN.test(value)
}

/** Original fluent families accept only their own method maps; no runtime registry lives here. */
export type IChainMethods = {
  readonly query?: object
  readonly tx?: object
  readonly vector?: object
  readonly rdf?: object
}

/** Retains installed chain methods in pure projections without granting runtime authority. */
declare const installedChainMethods: unique symbol

/** Projects the exact carried method groups from an already enhanced store. */
export type IChainMethodsOf<TStore> = TStore extends {
  readonly [installedChainMethods]?: infer TMethods extends IChainMethods
}
  ? TMethods
  : Record<never, never>

/** Retrieves one finite family without widening an absent group to arbitrary methods. */
type IChainPart<
  TMethods extends IChainMethods,
  K extends keyof IChainMethods
> = K extends keyof TMethods ? NonNullable<TMethods[K]> : Record<never, never>

/** Preserves both the canonical builder's second generic and specialized no-lock builders. */
type IWithTransactionBuilderMethods<TBuilder, TMethods extends IChainMethods> =
  TBuilder extends ITransactionBuilder<infer TScope, infer TAugmentMethods>
    ? ITransactionBuilder<TScope, TAugmentMethods & IChainPart<TMethods, 'tx'>>
    : TBuilder extends { run(run: (scope: infer TScope) => unknown): unknown }
      ? {
          [K in Exclude<keyof TBuilder, 'run'>]: TBuilder[K] extends (
            ...args: infer TArguments
          ) => TBuilder
            ? (...args: TArguments) => IWithTransactionBuilderMethods<TBuilder, TMethods>
            : TBuilder[K]
        } & {
          run<TResult>(run: (scope: TScope) => TResult): Promise<Awaited<TResult>>
        } & IChainPart<TMethods, 'tx'>
      : TBuilder

/** Rebuilds only an existing transaction builder, retaining every backend-specific member. */
type IWithTransactionMethods<TStore, TMethods extends IChainMethods> = TStore extends {
  tx(): infer TBuilder
}
  ? { tx(): IWithTransactionBuilderMethods<TBuilder, TMethods> }
  : Record<never, never>

/** Pure authoring projection; actual methods are installed by the owning host and chain owners. */
export type IWithChainMethods<TStore, TMethods extends IChainMethods> = keyof TMethods extends never
  ? TStore
  : Omit<TStore, 'tx' | typeof installedChainMethods> & {
      readonly [installedChainMethods]?: TMethods
    } & IWithTransactionMethods<TStore, TMethods>
