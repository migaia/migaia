import type { StorageStageKind } from './stage-kind.js'
import type {
  IStorageStore,
  IStorageCapabilitySet,
  IStorageCapabilityApiOf,
  IWithTransactionQueryMethods,
  IRecordsApi,
  ICapabilityImpl,
  ICapabilityStore,
  IAnyStorageCapability,
  records
} from './capability.js'
import type { rdf, IRdfApi } from './capabilities/rdf.js'
import type {
  vector,
  IVectorApi,
  IVectorCollection,
  IVectorCollectionOptions
} from './capabilities/vector.js'
import type { IKeyValueStore } from './store.js'
import type { IRecordQuery, IRdfQuery, IVectorQueryBuilder, IQueryWatch } from './query-chain.js'
import type { IStorageKey, IOperationContext } from './context.js'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { ICodecStageObserver } from './codec.js'
import type { ITransactionStageObserver } from './transaction.js'
import type { IConcurrencyStageObserver } from './concurrency.js'
import type { ISqlStageObserver } from './sql.js'
import type { IQueryStageObserver } from './query.js'
import type { ITransactionBuilder, IOptimisticTransactionBuilder } from './concurrency.js'

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
  TBuilder extends IOptimisticTransactionBuilder<infer TScope, infer TAugmentMethods>
    ? IOptimisticTransactionBuilder<
        IWithTransactionQueryMethods<
          TScope,
          IChainPart<TMethods, 'query'>,
          IChainPart<TMethods, 'rdf'>
        >,
        TAugmentMethods & IChainPart<TMethods, 'tx'>
      >
    : TBuilder extends ITransactionBuilder<infer TScope, infer TAugmentMethods>
      ? ITransactionBuilder<
          IWithTransactionQueryMethods<
            TScope,
            IChainPart<TMethods, 'query'>,
            IChainPart<TMethods, 'rdf'>
          >,
          TAugmentMethods & IChainPart<TMethods, 'tx'>
        >
      : TBuilder extends { run(run: (scope: infer TScope) => unknown): unknown }
        ? {
            [K in Exclude<keyof TBuilder, 'run'>]: TBuilder[K] extends (
              ...args: infer TArguments
            ) => TBuilder
              ? (...args: TArguments) => IWithTransactionBuilderMethods<TBuilder, TMethods>
              : TBuilder[K]
          } & {
            run<TResult>(
              run: (
                scope: IWithTransactionQueryMethods<
                  TScope,
                  IChainPart<TMethods, 'query'>,
                  IChainPart<TMethods, 'rdf'>
                >
              ) => TResult
            ): Promise<Awaited<TResult>>
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
type IWithRecordQueryMethods<
  TApi,
  TValue,
  TMethods extends IChainMethods,
  TExtra extends object = Record<never, never>
> = TApi extends {
  query(): infer TQuery
}
  ? Omit<TApi, 'query'> & {
      query<R = TValue>(): Omit<TQuery, keyof IRecordQuery<unknown>> &
        IRecordQuery<
          R,
          IOperationContext,
          Omit<TQuery, keyof IRecordQuery<unknown>> & IChainPart<TMethods, 'query'> & TExtra
        > &
        IChainPart<TMethods, 'query'>
    }
  : TApi
/** Native RDF members and previous query additions survive the standard match projection. */
type IWithRdfQueryMethods<
  TApi,
  TMethods extends IChainMethods,
  TExtra extends object = Record<never, never>
> = TApi extends {
  match(...args: infer TArguments): infer TQuery
}
  ? Omit<TApi, 'match'> & {
      match(
        ...args: TArguments
      ): IRdfQuery<
        IOperationContext,
        Omit<TQuery, keyof IRdfQuery> & IChainPart<TMethods, 'rdf'> & TExtra
      >
    }
  : TApi
/** Existing collection builders declare their original pure methods and native watch presence. */
type IVectorBuilderOf<TCollection> = TCollection extends { near(...args: never[]): infer TBuilder }
  ? TBuilder
  : never
/** Grouping is inferred from actual bounded method presence, never widened from an absent flag. */
type IVectorGroupingOf<TCollection> =
  IVectorBuilderOf<TCollection> extends { topK(count: number): infer TQuery }
    ? TQuery extends { groupBy(...args: never[]): unknown }
      ? true
      : false
    : false
/** Generic payload options use the original vector owner; native collection members remain exact. */
type IWithVectorQueryMethods<
  TApi,
  TMethods extends IChainMethods,
  TExtra extends object = Record<never, never>
> = TApi extends {
  collection(...args: never[]): infer TCollection
}
  ? Omit<TApi, 'collection'> & {
      collection<TPayload = ICodecValue>(
        name: string,
        ...options: IVectorCollectionOptions<TPayload>
      ): Omit<TCollection, keyof IVectorCollection<unknown>> &
        IVectorCollection<
          TPayload,
          IVectorGroupingOf<TCollection>,
          false,
          Omit<IVectorBuilderOf<TCollection>, keyof IVectorQueryBuilder<unknown>> &
            IChainPart<TMethods, 'vector'> &
            TExtra
        >
    }
  : TApi
/** Each actual root family receives only its own methods; all other native APIs remain untouched. */
type IWithQueryMethods<TStore, TMethods extends IChainMethods> =
  Extract<'query' | 'vector' | 'rdf', keyof TMethods> extends never
    ? Pick<TStore, Extract<keyof TStore, 'use'>>
    : {
        use<TCap extends IStorageCapabilitySet<TStore>>(
          capability: TCap
        ): TCap extends typeof records
          ? IWithRecordQueryMethods<
              IStorageCapabilityApiOf<TStore, TCap>,
              IRecordValueOf<TStore>,
              TMethods
            >
          : TCap extends typeof rdf
            ? IWithRdfQueryMethods<IStorageCapabilityApiOf<TStore, TCap>, TMethods>
            : TCap extends typeof vector
              ? IWithVectorQueryMethods<IStorageCapabilityApiOf<TStore, TCap>, TMethods>
              : IStorageCapabilityApiOf<TStore, TCap>
      }

/** Pure authoring projection; actual methods are installed by the owning host and chain owners. */
export type IWithChainMethods<TStore, TMethods extends IChainMethods> = keyof TMethods extends never
  ? TStore
  : Omit<TStore, 'tx' | 'use' | typeof installedChainMethods> & {
      readonly [installedChainMethods]?: TMethods
    } & IWithTransactionMethods<TStore, TMethods> &
      IWithQueryMethods<TStore, TMethods>
/** A truthful store-wide feed refines only the three standard query APIs and keeps native members. */
type IWithChangeFeedApi<TApi> =
  TApi extends IRecordsApi<infer TValue, infer _TFeed, infer TMethods>
    ? IWithRecordQueryMethods<TApi, TValue, { query: TMethods }, IQueryWatch>
    : TApi extends IVectorApi<infer _TGroupable, infer _TFeed, infer TMethods>
      ? IWithVectorQueryMethods<TApi, { vector: TMethods }, IQueryWatch>
      : TApi extends IRdfApi<infer _TFeed, infer TMethods>
        ? IWithRdfQueryMethods<TApi, { rdf: TMethods }, IQueryWatch>
        : TApi
/** Rebuilds the original implementation tuple from existing metadata without a capability registry. */
type IChangeFeedImplementation<S, C extends IAnyStorageCapability> = C extends unknown
  ? Omit<ICapabilityImpl<C>, 'api'> & {
      readonly api: IWithChangeFeedApi<IStorageCapabilityApiOf<S, C>>
    }
  : never
/** Known-store refinement preserves native, sync, metadata, transaction and Feature method domains. */
export type IWithChangeFeedCapabilities<S extends Omit<IKeyValueStore, 'use'>> = ([
  IStorageCapabilitySet<S>
] extends [never]
  ? S
  : ICapabilityStore<
        S,
        IStorageCapabilitySet<S>,
        readonly IChangeFeedImplementation<S, IStorageCapabilitySet<S>>[]
      > extends infer T
    ? IWithChainMethods<T, IChainMethodsOf<S>>
    : never) & { readonly capabilities: S['capabilities'] & { readonly changeFeed: true } }

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
  /** Batch callers may include their entry count without exposing keys or values. */
  beforeStorageOperation?: (operation: string, count?: number) => void | PromiseLike<void>
  afterStorageOperation?: (
    operation: string,
    elapsedMs: number,
    count: number
  ) => void | PromiseLike<void>
  /** Optional batch count preserves the original single-operation argument positions. */
  onStorageOperationError?: (
    operation: string,
    code?: string,
    count?: number
  ) => void | PromiseLike<void>
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
