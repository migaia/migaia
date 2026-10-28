import {
  DeleteCountMode,
  type IVectorFilter,
  type IVectorCollection,
  type IStorageVectorConfiguration,
  type IStorageVectorValidation,
  type IStorageVectorPoint,
  invalidVector,
  assertVectorObject,
  assertStorageVectorCollection,
  assertStorageVector,
  assertStorageVectorIds,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText
} from '@migaia/storage-contract'
import { asCodecValue, toPortableValue } from '@migaia/serialize/codec'
import { parseObjectPath } from '@migaia/utils/object'
/** The native engine remains responsible for retrieval; only query synthesis is shared. */
export { recommendStorageVector } from '../backends/vector-core.ts'

/** Preserve coded contract failures and retain the exact cause of getters and codec failures. */
/** Only payload projection normalizes a real serialization failure to the vector contract. */
function projectVectorPayload<T>(value: T, backend: IBackendKind | undefined): T {
  try {
    return asCodecValue(toPortableValue(value)) as T
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend, cause },
      StorageContractErrorText.vectorArgument
    )
  }
}

/** Actual borrowed array bounds must be safe integers, without imposing a business size cap. */
function assertVectorArrayLength(
  length: number,
  minimum: 0 | 1,
  backend: IBackendKind | undefined
): void {
  if (!Number.isSafeInteger(length) || length < minimum) invalidVector(backend)
}

/** Capture caller metadata because native layout lookup and deferred queries can await. */
export function snapshotStorageVectorCollection(
  name: string,
  options?: IStorageVectorConfiguration,
  backend?: IBackendKind
): Readonly<{ name: string; options: Readonly<IStorageVectorConfiguration> | undefined }> {
  assertStorageVectorCollection(name, options, backend)
  return {
    name,
    options:
      options === undefined ? undefined : { dimensions: options.dimensions, metric: options.metric }
  }
}

/** Capture caller components because native layout lookup and deferred queries can await. */
export function snapshotStorageVector(
  input: readonly number[],
  options?: IStorageVectorValidation,
  backend?: IBackendKind
): readonly number[] {
  assertStorageVector(input, options, backend)
  return [...input]
}

/**
 * Capture every point before returning a write plan. The serialize owner projects class instances
 * to their own portable fields, without schema validation or a second payload serializer.
 */
export function snapshotStorageVectorUpsert<TPayload>(
  points: readonly IStorageVectorPoint<TPayload>[],
  configuration?: IStorageVectorConfiguration,
  backend?: IBackendKind
): readonly IStorageVectorPoint<TPayload>[] {
  /** Omission captures the batch only; a native schema is never inferred from caller values. */
  let config: IStorageVectorConfiguration | undefined
  if (configuration !== undefined) {
    /** Configuration is validated synchronously and borrowed only for this capture. */
    assertStorageVectorCollection('', configuration, backend)
    config = configuration
  }
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
      inputPayload === undefined ? undefined : projectVectorPayload(inputPayload, backend)
    result.set(id, { id, vector: components, ...(payload === undefined ? {} : { payload }) })
  }
  return [...result.values()]
}

/** One snapshot owns active ancestors while preserving repeated sibling nodes. */
class VectorFilterSnapshot {
  /** The original backend labels every malformed filter without allocating another error owner. */
  readonly #backend: IBackendKind | undefined
  /** Only active ancestors are retained, so shared acyclic subtrees remain supported. */
  readonly #active = new Set<object>()
  /** Establish one synchronous capture; no caller input survives in the returned filter. */
  constructor(backend: IBackendKind | undefined) {
    this.#backend = backend
  }
  /** Validate the closed AST alternatives and detach values before native filter execution awaits. */
  capture(input: IVectorFilter): IVectorFilter {
    assertVectorObject(input, this.#backend)
    if (this.#active.has(input)) invalidVector(this.#backend)
    this.#active.add(input)
    try {
      /** Own keys select one closed operator alternative. */
      const keys = Object.keys(input)
      /** The canonical object guard admits ordinary field reads. */
      const fields = input as unknown as Record<string, unknown>
      for (const operation of ['all', 'any', 'not'] as const) {
        if (!Object.hasOwn(input, operation)) continue
        if (keys.length !== 1) invalidVector(this.#backend)
        /** The selected operator owns either one child or a child sequence. */
        const value = fields[operation]
        if (operation === 'not') return { not: this.capture(value as IVectorFilter) }
        if (!Array.isArray(value)) invalidVector(this.#backend)
        assertVectorArrayLength(value.length, 0, this.#backend)
        /** New children remain detached from the caller across native awaits. */
        const children: IVectorFilter[] = []
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index)) invalidVector(this.#backend)
          children.push(this.capture(value[index]))
        }
        return operation === 'all' ? { all: children } : { any: children }
      }
      return this.#field(fields, keys)
    } finally {
      this.#active.delete(input)
    }
  }
  /** Field grammar shares the query parser; scalar alternatives retain their exact type. */
  #field(fields: Record<string, unknown>, keys: string[]): IVectorFilter {
    if (!Object.hasOwn(fields, 'field')) invalidVector(this.#backend)
    /** Paths use the same grammar as record query predicates. */
    const field = fields.field
    if (typeof field !== 'string') invalidVector(this.#backend)
    try {
      parseObjectPath(field)
    } catch (cause) {
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend: this.#backend, cause },
        StorageContractErrorText.vectorArgument
      )
    }
    if (Object.hasOwn(fields, 'eq')) {
      if (keys.length !== 2) invalidVector(this.#backend)
      /** Equality preserves the scalar type used by native engines. */
      const eq = fields.eq
      if (
        typeof eq !== 'string' &&
        typeof eq !== 'boolean' &&
        (typeof eq !== 'number' || !Number.isFinite(eq))
      )
        invalidVector(this.#backend)
      return { field, eq }
    }
    if (Object.hasOwn(fields, 'in')) return this.#membership(field, fields.in, keys.length)
    if (keys.some((key) => key !== 'field' && key !== 'gte' && key !== 'lte'))
      invalidVector(this.#backend)
    /** Both optional bounds are checked before the native query can run. */
    const gte = fields.gte,
      lte = fields.lte
    if (
      (gte === undefined && lte === undefined) ||
      (gte !== undefined && (typeof gte !== 'number' || !Number.isFinite(gte))) ||
      (lte !== undefined && (typeof lte !== 'number' || !Number.isFinite(lte))) ||
      (gte !== undefined && lte !== undefined && (gte as number) > (lte as number))
    )
      invalidVector(this.#backend)
    return {
      field,
      ...(gte === undefined ? {} : { gte: gte as number }),
      ...(lte === undefined ? {} : { lte: lte as number })
    }
  }
  /** Membership operands are copied once because the native filter can outlive this call. */
  #membership(field: string, values: unknown, keyCount: number): IVectorFilter {
    if (keyCount !== 2 || !Array.isArray(values)) invalidVector(this.#backend)
    assertVectorArrayLength(values.length, 0, this.#backend)
    /** Membership keeps original string/number identity while owning the array. */
    const members: (string | number)[] = []
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index)) invalidVector(this.#backend)
      /** Each dense operand is independently admitted before publication. */
      const value = values[index]
      if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
        invalidVector(this.#backend)
      members.push(value)
    }
    return { field, in: members }
  }
}
/** Detach the filter AST before the backend performs native asynchronous work. */
export function snapshotStorageVectorFilter(
  filter: IVectorFilter,
  backend?: IBackendKind
): IVectorFilter {
  return new VectorFilterSnapshot(backend).capture(filter)
}

/** Shared search admission validates even k=0 and leaves actual ranking entirely with the backend. */
export function snapshotStorageVectorSearch(
  query: readonly number[],
  options: Parameters<IVectorCollection<unknown>['search']>[1],
  configuration?: IStorageVectorConfiguration,
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
  /** Omission snapshots query/options only, without guessing a native dimension or metric. */
  let config: IStorageVectorConfiguration | undefined
  if (configuration !== undefined) {
    /** Configuration is validated before the independent query snapshot. */
    assertStorageVectorCollection('', configuration, backend)
    config = configuration
  }
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
  return {
    query: capturedQuery,
    options: {
      k,
      filter: capturedFilter,
      withPayload: withPayload ?? false,
      exact: exact ?? false
    }
  }
}

/** Capture caller IDs because native schema lookup and deferred recommendation reads can await. */
export function snapshotStorageVectorIds(
  ids: readonly string[],
  backend?: IBackendKind,
  rejectDuplicates = false
): readonly string[] {
  assertStorageVectorIds(ids, backend, rejectDuplicates)
  return [...ids]
}

/** Resolve only the declared deletion strategy; engines retain ownership of actual count behavior. */
export function snapshotStorageDeleteCountMode(
  value: DeleteCountMode | undefined,
  backend?: IBackendKind
): DeleteCountMode {
  if (value === undefined) return DeleteCountMode.precount
  if (value !== DeleteCountMode.precount && value !== DeleteCountMode.scroll) invalidVector(backend)
  return value
}
