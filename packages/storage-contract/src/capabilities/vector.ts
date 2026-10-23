import { asCodecValue, toPortableValue, type ICodecValue } from '@migaia/serialize/codec'
import { parseObjectPath } from '@migaia/utils/object'
import type { IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import type { IOperationContext } from '../context.js'
import type { IWriteConcurrencyOptions } from '../concurrency.js'
import type { IVectorQueryBuilder, IWhere, IQueryWatch } from '../query-chain.js'
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

/** Collection configuration is data only; the native collection owner checks repeated names. */
export type IStorageVectorConfiguration = {
  readonly dimensions: number
  readonly metric: 'cosine' | 'dot' | 'euclid'
}
/** Optional validation facts also serve query synthesis before a collection is known. */
export type IStorageVectorValidation = {
  readonly dimensions?: number
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

/** Preserve coded contract failures and retain the exact cause of getters and codec failures. */
function vectorInput<T>(backend: IBackendKind | undefined, capture: () => T): T {
  try {
    return capture()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend, cause },
      StorageContractErrorText.vectorArgument
    )
  }
}
/** Reject malformed supported input before a backend can read or modify its collection. */
function invalidVector(backend: IBackendKind | undefined): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend },
    StorageContractErrorText.vectorArgument
  )
}
/** Shape admission accepts class options while reading only the requested public fields. */
function assertVectorObject(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidVector(backend)
}
/** Actual borrowed array bounds must be safe integers, without imposing a business size cap. */
function assertVectorArrayLength(
  length: number,
  minimum: 0 | 1,
  backend: IBackendKind | undefined
): void {
  if (!Number.isSafeInteger(length) || length < minimum) invalidVector(backend)
}
/** Snapshot declared configuration once; absence is resolved only by the native collection owner. */
export function snapshotStorageVectorCollection(
  name: string,
  options?: IStorageVectorConfiguration,
  backend?: IBackendKind
): Readonly<{ name: string; options: Readonly<IStorageVectorConfiguration> | undefined }> {
  return vectorInput(backend, () => {
    if (typeof name !== 'string') invalidVector(backend)
    if (options === undefined) return Object.freeze({ name, options: undefined })
    assertVectorObject(options, backend)
    const { dimensions, metric } = options
    if (
      !Number.isSafeInteger(dimensions) ||
      dimensions < 1 ||
      typeof metric !== 'string' ||
      !Object.hasOwn(VectorMetric, metric)
    )
      invalidVector(backend)
    return Object.freeze({ name, options: Object.freeze({ dimensions, metric }) })
  })
}
/** Capture finite components and reject cosine's undefined zero direction without native work. */
export function snapshotStorageVector(
  input: readonly number[],
  options?: IStorageVectorValidation,
  backend?: IBackendKind
): readonly number[] {
  return vectorInput(backend, () => {
    if (options !== undefined) assertVectorObject(options, backend)
    const dimensions = options?.dimensions
    const metric = options?.metric
    if (
      (dimensions !== undefined && (!Number.isSafeInteger(dimensions) || dimensions < 1)) ||
      (metric !== undefined &&
        (typeof metric !== 'string' || !Object.hasOwn(VectorMetric, metric))) ||
      !Array.isArray(input)
    )
      invalidVector(backend)
    /** Read the borrowed array bound once before copying each component. */
    const length = input.length
    assertVectorArrayLength(length, 1, backend)
    if (dimensions !== undefined && length !== dimensions) invalidVector(backend)
    /** The accepted vector owns its component array and exposes no mutable input. */
    const result: number[] = []
    /** Zero detection avoids a norm sum that can overflow on otherwise finite components. */
    let nonzero = false
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(input, index)) invalidVector(backend)
      /** Each component is captured once after dense-array admission. */
      const value = input[index]
      if (typeof value !== 'number' || !Number.isFinite(value)) invalidVector(backend)
      result.push(value)
      if (value !== 0) nonzero = true
    }
    if (metric === VectorMetric.cosine && !nonzero) invalidVector(backend)
    return Object.freeze(result)
  })
}
/**
 * Capture every point before returning a write plan. The serialize owner projects class instances
 * to their own portable fields, without schema validation or a second payload serializer.
 */
export function snapshotStorageVectorUpsert<TPayload>(
  points: readonly IStorageVectorPoint<TPayload>[],
  configuration: IStorageVectorConfiguration,
  backend?: IBackendKind
): readonly IStorageVectorPoint<TPayload>[] {
  return vectorInput(backend, () => {
    /** Required native configuration is never replaced with inferred dimensions. */
    assertVectorObject(configuration, backend)
    /** Validate one detached configuration without resolving or creating a native collection. */
    const config = snapshotStorageVectorCollection('', configuration, backend).options!
    if (!Array.isArray(points)) invalidVector(backend)
    /** A dense batch is visited completely before any write plan is exposed. */
    const length = points.length
    assertVectorArrayLength(length, 0, backend)
    /** Repeated IDs replace their earlier value only after that input also passed validation. */
    const result = new Map<string, IStorageVectorPoint<TPayload>>()
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(points, index)) invalidVector(backend)
      /** Retain the declared payload schema while runtime admission checks the actual fields. */
      const point: IStorageVectorPoint<TPayload> = points[index]
      assertVectorObject(point, backend)
      const { id, vector: input, payload: inputPayload } = point
      if (typeof id !== 'string') invalidVector(backend)
      /** The copied vector and projected payload no longer borrow caller-owned storage. */
      const components = snapshotStorageVector(input, config, backend)
      /** Schema typing stays with the caller; the codec owns the portable runtime value domain. */
      const payload =
        inputPayload === undefined
          ? undefined
          : (asCodecValue(toPortableValue(inputPayload)) as TPayload)
      result.set(
        id,
        Object.freeze({ id, vector: components, ...(payload === undefined ? {} : { payload }) })
      )
    }
    return Object.freeze([...result.values()])
  })
}
/** Detach the declarative AST and membership arrays; native engines own its translation/execution. */
export function snapshotStorageVectorFilter(
  filter: IVectorFilter,
  backend?: IBackendKind
): IVectorFilter {
  return vectorInput(backend, () => {
    /** One invocation tracks only active ancestors, allowing repeated sibling AST nodes. */
    const active = new Set<object>()
    /** Ancestor-only tracking admits repeated sibling nodes without admitting a cyclic AST. */
    const capture = (input: IVectorFilter): IVectorFilter => {
      assertVectorObject(input, backend)
      if (active.has(input)) invalidVector(backend)
      active.add(input)
      try {
        /** Own keys distinguish the closed operator alternatives without invoking field getters. */
        const keys = Object.keys(input)
        for (const operation of ['all', 'any', 'not'] as const) {
          if (!Object.hasOwn(input, operation)) continue
          if (keys.length !== 1) invalidVector(backend)
          /** Only the selected operator getter is read. */
          const value = Reflect.get(input, operation)
          if (operation === 'not') return Object.freeze({ not: capture(value) })
          if (!Array.isArray(value)) invalidVector(backend)
          /** Snapshot the child bound once before descending. */
          const length = value.length
          assertVectorArrayLength(length, 0, backend)
          /** Children are fresh immutable nodes rather than aliases to the original AST. */
          const children: IVectorFilter[] = []
          for (let index = 0; index < length; index++) {
            if (!Object.hasOwn(value, index)) invalidVector(backend)
            children.push(capture(value[index]))
          }
          return Object.freeze({ [operation]: Object.freeze(children) }) as IVectorFilter
        }
        if (!Object.hasOwn(input, 'field')) invalidVector(backend)
        /** The path parser owns the same field grammar used by declarative query conditions. */
        const field = Reflect.get(input, 'field')
        if (typeof field !== 'string') invalidVector(backend)
        parseObjectPath(field)
        if (Object.hasOwn(input, 'eq')) {
          if (keys.length !== 2) invalidVector(backend)
          /** Scalar equality preserves type and rejects non-finite numeric operands. */
          const eq = Reflect.get(input, 'eq')
          if (
            typeof eq !== 'string' &&
            typeof eq !== 'boolean' &&
            (typeof eq !== 'number' || !Number.isFinite(eq))
          )
            invalidVector(backend)
          return Object.freeze({ field, eq })
        }
        if (Object.hasOwn(input, 'in')) {
          if (keys.length !== 2) invalidVector(backend)
          /** Membership input is detached here; native execution compiles its set once. */
          const values = Reflect.get(input, 'in')
          if (!Array.isArray(values)) invalidVector(backend)
          /** Read only this invocation's membership array bound. */
          const length = values.length
          assertVectorArrayLength(length, 0, backend)
          /** Native engines receive an immutable operand sequence for their own translation. */
          const members: (string | number)[] = []
          for (let index = 0; index < length; index++) {
            if (!Object.hasOwn(values, index)) invalidVector(backend)
            /** Each present operand is captured once and keeps its string/number identity. */
            const value = values[index]
            if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
              invalidVector(backend)
            members.push(value)
          }
          return Object.freeze({ field, in: Object.freeze(members) })
        }
        if (keys.some((key) => key !== 'field' && key !== 'gte' && key !== 'lte'))
          invalidVector(backend)
        /** At least one finite bound is required; absent optional bounds remain absent. */
        const gte = Reflect.get(input, 'gte')
        /** The upper bound is captured separately without re-reading the lower getter. */
        const lte = Reflect.get(input, 'lte')
        if (
          (gte === undefined && lte === undefined) ||
          (gte !== undefined && (typeof gte !== 'number' || !Number.isFinite(gte))) ||
          (lte !== undefined && (typeof lte !== 'number' || !Number.isFinite(lte))) ||
          (gte !== undefined && lte !== undefined && gte > lte)
        )
          invalidVector(backend)
        return Object.freeze({
          field,
          ...(gte === undefined ? {} : { gte }),
          ...(lte === undefined ? {} : { lte })
        })
      } finally {
        active.delete(input)
      }
    }
    return capture(filter)
  })
}
/** Shared search admission validates even k=0 and leaves actual ranking entirely with the backend. */
export function snapshotStorageVectorSearch(
  query: readonly number[],
  options: Parameters<IVectorCollection<unknown>['search']>[1],
  configuration: IStorageVectorConfiguration,
  backend?: IBackendKind
): Readonly<{
  query: readonly number[]
  options: Readonly<{
    k: number
    filter: IVectorFilter | undefined
    withPayload: boolean
    exact: boolean
  }>
}> {
  return vectorInput(backend, () => {
    /** Required native configuration is never replaced with inferred dimensions. */
    assertVectorObject(configuration, backend)
    /** Validate one detached configuration without resolving or creating a native collection. */
    const config = snapshotStorageVectorCollection('', configuration, backend).options!
    assertVectorObject(options, backend)
    const { k, filter, withPayload, exact } = options
    if (
      !Number.isSafeInteger(k) ||
      k < 0 ||
      (withPayload !== undefined && typeof withPayload !== 'boolean') ||
      (exact !== undefined && typeof exact !== 'boolean')
    )
      invalidVector(backend)
    /** Even a zero-result search validates its direction before the native owner short-circuits. */
    const capturedQuery = snapshotStorageVector(query, config, backend)
    /** The filter snapshot belongs to this call, independent of later caller mutation. */
    const capturedFilter =
      filter === undefined ? undefined : snapshotStorageVectorFilter(filter, backend)
    return Object.freeze({
      query: capturedQuery,
      options: Object.freeze({
        k,
        filter: capturedFilter,
        withPayload: withPayload ?? false,
        exact: exact ?? false
      })
    })
  })
}
