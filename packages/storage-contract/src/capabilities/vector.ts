import { type ICodecValue } from '@migaia/serialize/codec'
import { type IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { type IOperationContext } from '../context.js'
import { type IWriteConcurrencyOptions } from '../concurrency.js'
import { type IVectorQueryBuilder, type IWhere, type IQueryWatch } from '../query-chain.js'
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
  TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  near(
    query: readonly number[],
    options?: { readonly metric?: 'cosine' | 'dot' | 'euclid'; readonly exact?: boolean }
  ): IVectorQueryBuilder<
    TPayload,
    TGroupable,
    false,
    TAugmentMethods & (TChangeFeed extends true ? IQueryWatch : Record<never, never>)
  >
  similarTo(
    id: string
  ): IVectorQueryBuilder<
    TPayload,
    TGroupable,
    false,
    TAugmentMethods & (TChangeFeed extends true ? IQueryWatch : Record<never, never>)
  >
  recommend(examples: {
    readonly positive: readonly [string, ...string[]]
    readonly negative?: readonly string[]
  }): IVectorQueryBuilder<
    TPayload,
    TGroupable,
    false,
    TAugmentMethods & (TChangeFeed extends true ? IQueryWatch : Record<never, never>)
  >
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

/** The original payload constraint and collection options also serve root Feature projections. */
export type IVectorCollectionOptions<TPayload> = [TPayload] extends [IVectorPayloadShape<TPayload>]
  ? [options?: { readonly dimensions: number; readonly metric: 'cosine' | 'dot' | 'euclid' }]
  : [options: never]

/** Real backends provide collection metadata and native query sources through one shared API. */
export type IVectorApi<
  TGroupable extends boolean = false,
  TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  collection<TPayload = ICodecValue>(
    name: string,
    ...options: IVectorCollectionOptions<TPayload>
  ): IVectorCollection<TPayload, TGroupable, TChangeFeed, TAugmentMethods>
}

/** Vector collections keep native execution and have no generic transaction projection. */
export const vector = /* @__PURE__ */ defineStandardStorageCapability<IVectorApi, 'vector'>(
  'vector',
  { validate: (api) => validateCapabilityMethods(api, STORAGE_VECTOR_METHODS) }
)

/** Collection configuration is data only; the native collection owner checks repeated names. */
export type IStorageVectorConfiguration = {
  /** Positive component count shared by every vector stored in this native collection. */
  readonly dimensions: number
  /** Native distance family; cosine additionally requires a nonzero vector direction. */
  readonly metric: 'cosine' | 'dot' | 'euclid'
}

/** Optional validation facts also serve query synthesis before a collection is known. */
export type IStorageVectorValidation = {
  /** Require the collection's exact component count when its schema is already known. */
  readonly dimensions?: number
  /** Apply this known distance family, including cosine's nonzero-direction requirement. */
  readonly metric?: IStorageVectorConfiguration['metric']
}

/** Point snapshots detach vectors and portable payload fields before native writes. */
export type IStorageVectorPoint<TPayload> = {
  readonly id: string
  readonly vector: readonly number[]
  readonly payload?: TPayload
}

/** These metric spellings are the original public domain, shared by all input admission. */
const VectorMetric = { cosine: 'cosine', dot: 'dot', euclid: 'euclid' } as const

/** Reject malformed supported input before a backend can read or modify its collection. */
export function invalidVector(backend: IBackendKind | undefined): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend },
    StorageContractErrorText.vectorArgument
  )
}

/** Shape admission accepts class options while reading only the requested public fields. */
export function assertVectorObject(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidVector(backend)
}

/** Validate declared collection metadata without copying private native schema values. */
export function assertStorageVectorCollection(
  name: string,
  options?: IStorageVectorConfiguration,
  backend?: IBackendKind
): void {
  if (typeof name !== 'string') invalidVector(backend)
  if (options === undefined) return
  assertVectorObject(options, backend)
  const { dimensions, metric } = options
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    typeof metric !== 'string' ||
    !Object.hasOwn(VectorMetric, metric)
  )
    invalidVector(backend)
}

/** Validate finite dense components and the native schema without allocating another vector. */
export function assertStorageVector(
  input: readonly number[],
  options?: IStorageVectorValidation,
  backend?: IBackendKind
): void {
  if (options !== undefined) assertVectorObject(options, backend)
  const dimensions = options?.dimensions
  const metric = options?.metric
  if (
    (dimensions !== undefined && (!Number.isSafeInteger(dimensions) || dimensions < 1)) ||
    (metric !== undefined &&
      (typeof metric !== 'string' || !Object.hasOwn(VectorMetric, metric))) ||
    !Array.isArray(input) ||
    input.length === 0 ||
    (dimensions !== undefined && input.length !== dimensions)
  )
    invalidVector(backend)
  /** Cosine cannot rank the zero direction; a sum of squares could overflow for finite values. */
  let nonzero = false
  for (const value of input) {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalidVector(backend)
    if (value !== 0) nonzero = true
  }
  if (metric === VectorMetric.cosine && !nonzero) invalidVector(backend)
}

/** Validate native ID lists without copying already private recommendation batches. */
export function assertStorageVectorIds(
  ids: readonly string[],
  backend?: IBackendKind,
  rejectDuplicates = false
): void {
  if (!Array.isArray(ids) || typeof rejectDuplicates !== 'boolean') invalidVector(backend)
  /** Duplicate rejection is selected explicitly; ordinary deletes keep their original policy. */
  const seen = rejectDuplicates ? new Set<string>() : undefined
  for (const id of ids) {
    if (typeof id !== 'string' || seen?.has(id)) invalidVector(backend)
    seen?.add(id)
  }
}
