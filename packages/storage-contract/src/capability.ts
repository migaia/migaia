import type { IStorageBase, IKeyValueStore } from './store.ts'
import type { ITransactionBuilder, IOptimisticTransactionBuilder } from './concurrency.ts'
import type { IWriteConcurrencyOptions } from './concurrency.ts'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { IOperationContext, IStorageKey } from './context.ts'
import type { IRecordQuery, IQueryWatch } from './query-chain.ts'
import type {
  ITransactionScope,
  ITransactionKeyValueApi,
  ITransactionRecordsApi
} from './transaction.ts'

import {
  invalidCapability,
  isCapabilityToken as isToken,
  readCapabilityTokenFacts
} from './capability-token.ts'
import type { kv } from './capabilities/kv.ts'
import type { records } from './capabilities/records.ts'
import type { ttl, ITransactionTtlApi } from './capabilities/ttl.ts'
import type { counter, ITransactionCounterApi } from './capabilities/counter.ts'
import type { sql } from './capabilities/sql.ts'
import type { rdf, IRdfApi, ITransactionRdfApi } from './capabilities/rdf.ts'
import type { vector, IVectorApi } from './capabilities/vector.ts'
import type { ISqlExecutor } from './sql.ts'
export { defineStorageCapability } from './capability-token.ts'
export { kv } from './capabilities/kv.ts'
export { records } from './capabilities/records.ts'
export { ttl } from './capabilities/ttl.ts'
export { counter } from './capabilities/counter.ts'
export { sql } from './capabilities/sql.ts'

/** Type-only API carrier; runtime authority belongs exclusively to the private token set. */
declare const capabilityApi: unique symbol
/** Contravariant capability set prevents a subset store from claiming additional capabilities. */
declare const storeCapabilities: unique symbol
/** Implementation records cannot be written as ordinary public object literals. */
declare const capabilityImplementation: unique symbol
/** Only the provider can issue its installation port. */
declare const capabilityInstallerBrand: unique symbol
/** Retains the exact implementation tuple for host-side type projection. */
declare const providedImplementations: unique symbol

/** A capability names one API contract without supplying a backend or data implementation. */
export type IStorageCapability<TName extends string, TApi> = {
  readonly name: TName
  readonly [capabilityApi]: TApi
}

/** Common capability upper bound; names are diagnostic rather than runtime permissions. */
export type IAnyStorageCapability = IStorageCapability<string, unknown>

/** Projects a token's declared public API without changing its runtime identity. */
export type ICapabilityApi<TCap extends IAnyStorageCapability> =
  TCap extends IStorageCapability<string, infer TApi> ? TApi : never

export type { IStorageBase } from './store.ts'

/** Minimal capability-aware store surface, retaining its exact admitted capability set. */
export type IStorageStore<TCaps extends IAnyStorageCapability = never> = IStorageBase & {
  readonly [storeCapabilities]: (capability: TCaps) => void
  use<TCap extends TCaps>(capability: TCap): ICapabilityApi<TCap>
  has(capability: IAnyStorageCapability): boolean
}

/**
 * The existing KV contract owns its callable API and sync channel; capabilities.batch declares
 * batch support.
 */
export type IKeyValueApi = Omit<
  IKeyValueStore,
  'backend' | 'capabilities' | 'dispose' | typeof Symbol.asyncDispose
> & {
  /** Reads one native text snapshot, retaining input order, duplicates and undefined missing rows. */
  getMany(
    keys: readonly IStorageKey[],
    ctx?: IOperationContext
  ): Promise<readonly (string | undefined)[]>
  /** Atomically writes a batch in one native operation; canonical duplicate keys reject before I/O. */
  setMany(
    entries: readonly {
      readonly key: IStorageKey
      readonly value: string
      readonly ttlMs?: number
    }[],
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<void>
  /** Atomically removes distinct canonical text keys and returns the actual deleted count. */
  removeMany(
    keys: readonly IStorageKey[],
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
  /** Removes only matching text keys using the canonical prefix range in the current organization. */
  removeByPrefix(
    prefix: IStorageKey,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
}

/**
 * Standard record entry reuses the implemented query core; writes retain the native backend
 * pipeline.
 */
export type IRecordsApi<
  TValue = ICodecValue,
  TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  query<R = TValue>(): IRecordQuery<
    R,
    IOperationContext,
    TAugmentMethods & (TChangeFeed extends true ? IQueryWatch : Record<never, never>)
  >
  removeByPrefix(
    prefix: IStorageKey,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
}

/** Only standard capabilities with a declared transaction projection belong to transaction use. */
export type ITransactionalCapability<TCaps extends IAnyStorageCapability> = Extract<
  TCaps,
  typeof kv | typeof records | typeof ttl | typeof counter | typeof sql | typeof rdf
>

/** Projects the standard transaction API without creating or admitting a transaction scope. */
export type ITransactionCapabilityApi<TCap extends IAnyStorageCapability> = TCap extends typeof kv
  ? ITransactionKeyValueApi
  : TCap extends typeof records
    ? ITransactionRecordsApi
    : TCap extends typeof ttl
      ? ITransactionTtlApi
      : TCap extends typeof counter
        ? ITransactionCounterApi
        : TCap extends typeof sql
          ? ISqlExecutor
          : TCap extends typeof rdf
            ? ITransactionRdfApi
            : never

/** Optional contravariant proof permits complete external scopes without private symbol access. */
export type ITransactionCapabilityView<
  TCaps extends IAnyStorageCapability,
  TValue = ICodecValue
> = {
  readonly [storeCapabilities]?: (capability: TCaps) => void
  use<TCap extends ITransactionalCapability<TCaps>>(
    capability: TCap
  ): TCap extends typeof records ? ITransactionRecordsApi<TValue> : ITransactionCapabilityApi<TCap>
}
/** Actual record values follow the original backend getRecord declaration, never a root API cast. */
type IScopeRecordValue<TScope> = TScope extends {
  getRecord(key: IStorageKey): Promise<(infer TValue) | undefined>
}
  ? TValue
  : ICodecValue
/** The native RDF/raw pair keeps both exact overload domains instead of using its last return. */
type INativeTransactionRdfApi<TUse> = TUse extends {
  (capability: infer TFirst): infer TFirstApi
  (capability: infer TSecond): infer TSecondApi
}
  ?
      | (TFirst extends typeof rdf ? TFirstApi : never)
      | (TSecond extends typeof rdf ? TSecondApi : never)
  : never
/** Only an existing native RDF match gains RDF Feature methods; raw and native refinements survive. */
type IWithNativeTransactionRdfMethods<
  TScope extends { use: (...args: never[]) => unknown },
  TRdfAugmentMethods extends object
> = keyof TRdfAugmentMethods extends never
  ? TScope
  : INativeTransactionRdfApi<TScope['use']> extends infer TApi
    ? [TApi] extends [never]
      ? TScope
      : TApi extends ITransactionRdfApi
        ? Omit<TScope, 'use'> & {
            use: ((
              capability: typeof rdf
            ) => Omit<TApi, 'match'> & ITransactionRdfApi<TRdfAugmentMethods>) &
              TScope['use']
          }
        : TScope
    : TScope
/**
 * Adds selected query methods only to an existing standard transaction capability lookup. Native
 * scope members remain untouched, token availability follows the original use parameter, and the
 * record and RDF queries keep separate Feature groups and undefined operation contexts.
 */
export type IWithTransactionQueryMethods<
  TScope,
  TAugmentMethods extends object,
  TRdfAugmentMethods extends object = Record<never, never>
> = keyof (TAugmentMethods & TRdfAugmentMethods) extends never
  ? TScope
  : TScope extends { use: (...args: never[]) => unknown }
    ? Exclude<
        Parameters<TScope['use']>[0],
        ITransactionalCapability<Extract<Parameters<TScope['use']>[0], IAnyStorageCapability>>
      > extends never
      ? Omit<TScope, 'use'> & {
          use<
            TCap extends ITransactionalCapability<
              Extract<Parameters<TScope['use']>[0], IAnyStorageCapability>
            >
          >(
            capability: TCap
          ): TCap extends typeof records
            ? ITransactionRecordsApi<IScopeRecordValue<TScope>, TAugmentMethods>
            : TCap extends typeof rdf
              ? ITransactionRdfApi<TRdfAugmentMethods>
              : ITransactionCapabilityApi<TCap>
        }
      : IWithNativeTransactionRdfMethods<TScope, TRdfAugmentMethods>
    : TScope

/** Replaces only capability-facing members while preserving every native scope extension. */
type IAddScopedCapabilities<
  TScope,
  TCaps extends IAnyStorageCapability
> = TScope extends ITransactionKeyValueApi
  ? Omit<TScope, 'use' | typeof storeCapabilities> &
      ITransactionCapabilityView<TCaps, IScopeRecordValue<TScope>>
  : TScope extends { use: (...args: never[]) => unknown }
    ? TScope
    : TScope & ITransactionCapabilityView<TCaps, IScopeRecordValue<TScope>>
/** Native support flags refine implementations while each token retains its original default API. */
type ICapabilityImplementationApi<TCap extends IAnyStorageCapability> =
  | ICapabilityApi<TCap>
  | (TCap extends typeof records
      ? IRecordsApi<ICodecValue, boolean, object>
      : TCap extends typeof rdf
        ? IRdfApi<boolean, object>
        : TCap extends typeof vector
          ? IVectorApi<boolean, boolean, object>
          : never)
/** Authentic implementation descriptor; the API object keeps its backend-owned lifetime. */
export type ICapabilityImpl<
  TCap extends IAnyStorageCapability = IAnyStorageCapability,
  TApi extends ICapabilityImplementationApi<TCap> = ICapabilityApi<TCap>
> = {
  readonly [capabilityImplementation]: true
  readonly capability: TCap
  readonly api: TApi
}

/** Exact API supplied for a selected token, including backend-specific refinements. */
type IProvidedApi<
  TImplementations extends readonly ICapabilityImpl[],
  TCap extends IAnyStorageCapability
> =
  Extract<TImplementations[number], { readonly capability: TCap }> extends infer TMatch
    ? [TMatch] extends [never]
      ? ICapabilityApi<TCap>
      : TMatch extends { readonly api: infer TApi }
        ? TApi
        : ICapabilityApi<TCap>
    : never

/** KV methods become flat only when the provider receives the real standard KV token. */
type IFlatKeyValue<TCaps extends IAnyStorageCapability> = [Extract<TCaps, typeof kv>] extends [
  never
]
  ? Record<never, never>
  : IKeyValueApi

/**
 * Retains the backend's full scope, options and existing builder augmentation without owning
 * execution.
 */
type ITransactionMembers<TBase, TCaps extends IAnyStorageCapability> = TBase extends {
  transaction(run: (scope: infer TScope) => unknown, options?: infer TOptions): unknown
}
  ? {
      transaction<TResult>(
        run: (scope: IAddScopedCapabilities<TScope, TCaps>) => TResult,
        options?: TOptions
      ): Promise<Awaited<TResult>>
    } & (TBase extends {
      tx(): IOptimisticTransactionBuilder<infer TBuilderScope, infer TAugmentMethods>
    }
      ? {
          tx(): IOptimisticTransactionBuilder<
            IAddScopedCapabilities<TBuilderScope, TCaps>,
            TAugmentMethods
          >
        }
      : TBase extends { tx(): ITransactionBuilder<infer TBuilderScope, infer TAugmentMethods> }
        ? {
            tx(): ITransactionBuilder<IAddScopedCapabilities<TBuilderScope, TCaps>, TAugmentMethods>
          }
        : TBase extends { tx(): infer TBuilder }
          ? { tx(): TBuilder }
          : Record<never, never>)
  : Record<never, never>

/** Refines the original base object without spreading away class or nonenumerable public members. */
export type ICapabilityStore<
  TBase,
  TCaps extends IAnyStorageCapability,
  TImplementations extends readonly ICapabilityImpl[] = readonly []
> = Omit<
  TBase,
  'use' | 'has' | 'transaction' | 'tx' | typeof providedImplementations | typeof storeCapabilities
> &
  Omit<IStorageStore<TCaps>, 'use'> & {
    readonly [providedImplementations]?: TImplementations
    use<TCap extends TCaps>(capability: TCap): IProvidedApi<TImplementations, TCap>
  } & IFlatKeyValue<TCaps> &
  ITransactionMembers<TBase, TCaps>

/** Public type projection; only the provider's private object table grants runtime authority. */
export type IStorageCapabilitySet<TStore> = TStore extends {
  readonly [storeCapabilities]: (capability: infer TCaps) => void
}
  ? Extract<TCaps, IAnyStorageCapability>
  : never

/** Projects the exact original implementation tuple without creating any capability. */
export type IStorageImplementationsOf<TStore> = TStore extends {
  readonly [providedImplementations]?: infer TImplementations extends readonly ICapabilityImpl[]
}
  ? TImplementations
  : readonly []

/** Projects the original API from admitted implementation metadata without creating authority. */
export type IStorageCapabilityApiOf<TStore, TCap extends IAnyStorageCapability> = IProvidedApi<
  IStorageImplementationsOf<TStore>,
  TCap
>

/** A prepared publication is local until publish; release removes only its own installations. */
export type ICapabilityPublication = {
  publish(): void
  release(): void
}

/** Unique per-store installation port used by its host to publish selected Feature outputs. */
export type ICapabilityInstallPort = {
  readonly [capabilityInstallerBrand]: true
  prepare(implementations: readonly ICapabilityImpl[]): ICapabilityPublication
}

/** Transaction binding stays private until the original transaction owner asks for its projection. */
export type IStorageImplementationRecord = {
  readonly implementation: ICapabilityImpl
  /** Private storage erases the scope type; only the original token/owner can invoke the binder. */
  readonly forTransaction?: (scope: never) => unknown
}
/** Authentic definition descriptors; public symbols and lookalike fields do not authorize them. */
const implementations = new WeakMap<object, IStorageImplementationRecord>()

/** Creates an authentic implementation definition without taking ownership of its API. */
export function implement<
  TCap extends IAnyStorageCapability,
  TApi extends ICapabilityImplementationApi<NoInfer<TCap>> = ICapabilityApi<TCap>
>(
  capability: TCap,
  api: TApi,
  options?: {
    readonly forTransaction?: (
      scope: ITransactionScope<ICodecValue, TCap>
    ) => NoInfer<ITransactionCapabilityApi<TCap>>
  }
): ICapabilityImpl<TCap, TApi> {
  if (!isToken(capability)) throw invalidCapability()
  /** Standard eligibility belongs to this exact token, never its diagnostic name. */
  const transaction = readCapabilityTokenFacts(capability)?.transaction
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw invalidCapability()
  /** The original owner validates use; definition preserves the exact opaque callback identity. */
  const forTransaction = options?.forTransaction as ((scope: never) => unknown) | undefined
  if (
    forTransaction !== undefined &&
    (transaction === undefined || typeof forTransaction !== 'function')
  )
    throw invalidCapability()
  /** API shape admission for standard tokens happens again at the atomic provider boundary. */
  const descriptor = { capability, api } as ICapabilityImpl<TCap, TApi>
  implementations.set(descriptor, { implementation: descriptor, forTransaction })
  return descriptor
}

/** Reads only the canonical implementation definition; it grants no store installation authority. */
export function readStorageImplementation(
  descriptor: unknown
): IStorageImplementationRecord | undefined {
  return typeof descriptor === 'object' && descriptor !== null
    ? implementations.get(descriptor)
    : undefined
}
