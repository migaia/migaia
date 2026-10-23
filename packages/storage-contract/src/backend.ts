import type { StorageStageKind } from './stage-kind.js'
import type {
  IStorageStore,
  IStorageCapabilitySet,
  IStorageCapabilityApiOf,
  records
} from './capability.js'
import type { IQueryChain } from './query-chain.js'
import type { IStorageKey, IOperationContext } from './context.js'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { ICodecStageObserver } from './codec.js'
import type { ITransactionStageObserver } from './transaction.js'
import type { IConcurrencyStageObserver } from './concurrency.js'
import type { ISqlStageObserver } from './sql.js'
import type { IQueryStageObserver } from './query.js'
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

/** Native record values retain their original backend's declared row domain when available. */
type IRecordValueOf<TStore> = TStore extends {
  getRecord(key: IStorageKey): Promise<(infer TValue) | undefined>
}
  ? TValue
  : ICodecValue
/** Replaces only the common query controls, preserving native API and chain refinements. */
type IWithRecordQueryMethods<TApi, TValue, TMethods extends IChainMethods> = TApi extends {
  query(): infer TQuery
}
  ? Omit<TApi, 'query'> & {
      query<R = TValue>(): Omit<TQuery, keyof IQueryChain<unknown>> &
        IQueryChain<R, IOperationContext, R, true, IChainPart<TMethods, 'query'>> &
        IChainPart<TMethods, 'query'>
    }
  : TApi
/** Capability lookup keeps the original implementation API for every token outside records. */
type IWithQueryMethods<TStore, TMethods extends IChainMethods> = 'query' extends keyof TMethods
  ? {
      use<TCap extends IStorageCapabilitySet<TStore>>(
        capability: TCap
      ): TCap extends typeof records
        ? IWithRecordQueryMethods<
            IStorageCapabilityApiOf<TStore, TCap>,
            IRecordValueOf<TStore>,
            TMethods
          >
        : IStorageCapabilityApiOf<TStore, TCap>
    }
  : Pick<TStore, Extract<keyof TStore, 'use'>>

/** Pure authoring projection; actual methods are installed by the owning host and chain owners. */
export type IWithChainMethods<TStore, TMethods extends IChainMethods> = keyof TMethods extends never
  ? TStore
  : Omit<TStore, 'tx' | 'use' | typeof installedChainMethods> & {
      readonly [installedChainMethods]?: TMethods
    } & IWithTransactionMethods<TStore, TMethods> &
      IWithQueryMethods<TStore, TMethods>

/** Backend observations carry no client or payload authority. */
export type IBackendStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.backend
  beforeBackendCreate?: () => void | PromiseLike<void>
  afterBackendCreate?: () => void | PromiseLike<void>
  onBackendRejected?: (code?: string) => void | PromiseLike<void>
  afterBackendInstall?: () => void | PromiseLike<void>
  onBackendDisposeStart?: () => void | PromiseLike<void>
  afterBackendDispose?: () => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
/** Ordinary operation observations borrow the original scope identity. */
export type IStorageOperationStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.operation
  forTransaction: (scope: object) => IStorageOperationStageObserver
  beforeStorageOperation?: (operation: string) => void | PromiseLike<void>
  afterStorageOperation?: (
    operation: string,
    elapsedMs: number,
    count: number
  ) => void | PromiseLike<void>
  onStorageOperationError?: (operation: string, code?: string) => void | PromiseLike<void>
  onStorageIterationClose?: (count: number) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
/** Seven original observer families share one host registry; these ports own no executor. */
export type IBackendStageBindings = Readonly<{
  backendStages: IBackendStageObserver
  operationStages: (store: IStorageStore<never>) => IStorageOperationStageObserver
  codecStages: (store: IStorageStore<never>) => ICodecStageObserver
  transactionStages: (store: IStorageStore<never>) => ITransactionStageObserver
  concurrencyStages: (store: IStorageStore<never>) => IConcurrencyStageObserver
  sqlStages: (store: IStorageStore<never>) => ISqlStageObserver
  queryStages: (store: IStorageStore<never>) => IQueryStageObserver
}>
