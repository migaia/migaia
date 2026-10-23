import type { ICodecValue } from '@migaia/serialize/codec'
import type { IOperationContext } from '../context.js'
import type { IWriteConcurrencyOptions } from '../concurrency.js'
import type { IVectorQueryBuilder, IWhere } from '../query-chain.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'
import { STORAGE_VECTOR_METHODS } from '../capability-constants.js'

/** Shared count strategies keep numeric results without pretending native operation IDs are counts. */
export const DeleteCountMode = { precount: 'precount', scroll: 'scroll' } as const
/** Strategy names preserve the same constant/type namespace. */
export type DeleteCountMode = keyof typeof DeleteCountMode
/** Portable declared payload fields support named readonly/optional shapes without index signatures. */
type IVectorPayloadShape<T> = T extends ICodecValue
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly unknown[]
      ? { readonly [K in keyof T]: IVectorPayloadShape<T[K]> }
      : T extends object
        ? { readonly [K in keyof T]: IVectorPayloadShape<Exclude<T[K], undefined>> }
        : never
/** Declarative native vector predicates inspect only own payload paths before ranking. */
export type IVectorFilter =
  | { readonly all: readonly IVectorFilter[] }
  | { readonly any: readonly IVectorFilter[] }
  | { readonly not: IVectorFilter }
  | { readonly field: string; readonly eq: string | number | boolean }
  | { readonly field: string; readonly in: readonly (string | number)[] }
  | { readonly field: string; readonly gte?: number; readonly lte?: number }
/** A collection borrows its original store lifetime and owns no connection or disposal method. */
export type IVectorCollection<
  TPayload,
  TGroupable extends boolean = false,
  _TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  near(
    query: readonly number[],
    options?: { readonly metric?: 'cosine' | 'dot' | 'euclid'; readonly exact?: boolean }
  ): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
  similarTo(id: string): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
  recommend(examples: {
    readonly positive: readonly [string, ...string[]]
    readonly negative?: readonly string[]
  }): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
  upsert(
    points: readonly {
      readonly id: string
      readonly vector: readonly number[]
      readonly payload?: TPayload
    }[],
    ctx?: IOperationContext & IWriteConcurrencyOptions & { readonly ttlMs?: number }
  ): Promise<void>
  deleteWhere(
    where: IWhere<TPayload>,
    ctx?: IOperationContext & IWriteConcurrencyOptions & { readonly count?: DeleteCountMode }
  ): Promise<number>
  delete(ids: readonly string[], ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  search(
    query: readonly number[],
    options: {
      readonly k: number
      readonly filter?: IVectorFilter
      readonly withPayload?: boolean
      readonly exact?: boolean
    },
    ctx?: IOperationContext
  ): Promise<
    readonly { readonly id: string; readonly score: number; readonly payload?: TPayload }[]
  >
}
/** Real backends provide collection metadata and native query sources through one shared API. */
export type IVectorApi<
  TGroupable extends boolean = false,
  TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  collection<TPayload = ICodecValue>(
    name: string,
    ...options: [TPayload] extends [IVectorPayloadShape<TPayload>]
      ? [options?: { readonly dimensions: number; readonly metric: 'cosine' | 'dot' | 'euclid' }]
      : [options: never]
  ): IVectorCollection<TPayload, TGroupable, TChangeFeed, TAugmentMethods>
}
/** Vector collections keep native execution and have no generic transaction projection. */
export const vector = /* @__PURE__ */ defineStandardStorageCapability<IVectorApi, 'vector'>(
  'vector',
  { validate: (api) => validateCapabilityMethods(api, STORAGE_VECTOR_METHODS) }
)
