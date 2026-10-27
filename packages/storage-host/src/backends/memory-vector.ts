// Vector collection capabilities for the memory backend (see ./memory.ts).
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertStorageTtlDuration,
  QueryOperator,
  QueryOperation,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  DeleteCountMode,
  type IStorageVectorPoint,
  type IStorageVectorConfiguration,
  type IVectorCollection,
  type IVectorHit,
  type IVectorFilter,
  type IQueryCondition,
  type IStorageKey
} from '@migaia/storage-contract'
import { snapshotConcurrencyLockRange, lockKey } from '../authoring/concurrency.js'
import {
  snapshotStorageBatchKeys,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix
} from '../authoring/key.js'
import {
  createVectorQuery,
  compileStorageWhere,
  compileStorageQueryCondition
} from '../authoring/query.js'
import {
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch
} from '../authoring/vector.js'
import { parseObjectPath } from '@migaia/utils/object-path'
import { rankMemoryVectors, recommendStorageVector } from './vector-core.js'
import { StorageErrorText } from '../error-text.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { MemoryOperation, MemoryState } from './memory-constants.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import { compareRecordIndexKeys } from '../core/ordered-record-index.js'
import {
  deletePhysical,
  liveEntry,
  identity,
  clone,
  mutationEntry,
  entryBytes,
  capacityFact,
  setDeadline,
  bump,
  publish
} from './memory-entries.js'
import { watchChanges, atomicEntry, nativeIterator, asyncEntry } from './memory-namespace-base.js'
import { queryDraft } from './memory.js'
import type { IMemoryNamespaceContext, IMemoryVectorSelection } from './memory.js'

/** New native capability calls check the same controller before the original registration runner. */
function vectorOperation<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  invoke: () => Promise<R>
): Promise<R> {
  try {
    namespaceContext.controller.assertLive()
    return invoke()
  } catch (cause) {
    return Promise.reject(cause)
  }
}

/** Vector admission errors retain the shared contract identity and the actual native backend. */
function invalidVector(): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: STORAGE_MEMORY_BACKEND },
    StorageErrorText.memoryVectorArgument
  )
}

/** Canonical payload filter translation reuses the original query compiler and membership Set. */
function vectorCondition(filter: IVectorFilter): IQueryCondition {
  if ('all' in filter)
    return {
      kind: 'and',
      conditions: filter.all.map((filter: IVectorFilter) => vectorCondition(filter))
    }
  if ('any' in filter)
    return {
      kind: 'or',
      conditions: filter.any.map((filter: IVectorFilter) => vectorCondition(filter))
    }
  if ('not' in filter) return { kind: 'not', condition: vectorCondition(filter.not) }
  /** The canonical path owner retains field segments and rejects inherited access. */
  const path = parseObjectPath(filter.field).map(String)
  if ('eq' in filter) return { kind: 'field', path, operator: QueryOperator.eq, value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: QueryOperator.in, value: filter.in }
  /** Two range operands remain one conjunction rather than a second evaluator. */
  const conditions: IQueryCondition[] = []
  if (filter.gte !== undefined)
    conditions.push({ kind: 'field', path, operator: QueryOperator.gte, value: filter.gte })
  if (filter.lte !== undefined)
    conditions.push({ kind: 'field', path, operator: QueryOperator.lte, value: filter.lte })
  return { kind: 'and', conditions }
}

/** One canonical tuple identifies the same vector row, revision, deadline and lock point. */
export function vectorKey<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  collection: string,
  id: string
): readonly [string, string] {
  return [collection, id]
}

/** Native IDs detach through the original key batch capture before any policy may wait. */
function vectorIds<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ids: readonly string[]
): readonly string[] {
  /** The existing batch owner rejects malformed arrays without a second parser. */
  const facts = snapshotStorageBatchKeys(ids, STORAGE_MEMORY_BACKEND)
  /** Only first occurrences enter physical admission; repeated public IDs remain harmless. */
  const result: string[] = []
  for (const [index, fact] of facts.entries()) {
    assertStringStorageKey(fact.key, STORAGE_MEMORY_BACKEND)
    if (fact.firstIndex === index) result.push(fact.key)
  }
  return result
}

/** Physical deletion includes lazy-expired rows and changes the original revision once. */
function removeVector<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  collection: string,
  id: string
): boolean {
  /** Each prepared ID uses the original key encoding without a new point registry. */
  const encoded = encodeFlatStorageKey(vectorKey(namespaceContext, collection, id))
  /** The actual physical row determines whether this delete contributes to the result. */
  const current = namespaceContext.data.vector.get(encoded)
  if (current === undefined) return false
  deletePhysical(namespaceContext, 'vector', encoded)
  return true
}

/** A collection descriptor borrows namespace rows and keeps its validated query metadata. */
type IMemoryVectorContext<T> = {
  /** Namespace ports and physical rows remain owned by the original namespace. */ namespaceContext: IMemoryNamespaceContext<T>

  /** Optional configuration capture performs no lookup or native operation by itself. */
  captured: ReturnType<typeof snapshotStorageVectorCollection>

  /** Repeated descriptors resolve the same metadata, while incompatible declarations reject. */
  existing: IStorageVectorConfiguration | undefined

  /** New collections require real dimensions and never infer them from a later write. */
  configuration: IStorageVectorConfiguration

  /** Prefix bytes localize only this collection in the existing physical vector radix. */
  bounds: ReturnType<typeof snapshotStorageKeyPrefix>
}
/** Resolve collection metadata once without creating a second physical owner. */
function createMemoryVectorCollection<T, TPayload>(
  namespaceContext: IMemoryNamespaceContext<T>,
  name: string,
  options?: IStorageVectorConfiguration
): IVectorCollection<TPayload> {
  /** Initialization completes before the collection API publishes these facts. */
  const vectorContext = { namespaceContext } as IMemoryVectorContext<T>

  vectorContext.namespaceContext.controller.assertLive()

  /** Optional configuration capture performs no lookup or native operation by itself. */
  vectorContext.captured = snapshotStorageVectorCollection(name, options, STORAGE_MEMORY_BACKEND)

  /** Repeated descriptors resolve the same metadata, while incompatible declarations reject. */
  vectorContext.existing = vectorContext.namespaceContext.vectorCollections.get(
    vectorContext.captured.name
  )

  /** New collections require real dimensions and never infer them from a later write. */
  const configuration = vectorContext.existing ?? vectorContext.captured.options

  if (
    configuration === undefined ||
    (vectorContext.existing !== undefined &&
      vectorContext.captured.options !== undefined &&
      (vectorContext.existing.dimensions !== vectorContext.captured.options.dimensions ||
        vectorContext.existing.metric !== vectorContext.captured.options.metric))
  )
    invalidVector()

  vectorContext.configuration = configuration

  vectorContext.namespaceContext.vectorCollections.set(
    vectorContext.captured.name,
    vectorContext.configuration
  )

  /** Prefix bytes localize only this collection in the existing physical vector radix. */
  vectorContext.bounds = snapshotStorageKeyPrefix(
    [vectorContext.captured.name],
    STORAGE_MEMORY_BACKEND
  )
  return {
    near: (...args) => memoryVectorCollectionNear<T, TPayload>(vectorContext, ...args),
    similarTo: (...args) => memoryVectorCollectionSimilarTo<T, TPayload>(vectorContext, ...args),
    recommend: (...args) => memoryVectorCollectionRecommend<T, TPayload>(vectorContext, ...args),
    upsert: (...args) => memoryVectorCollectionUpsert<T, TPayload>(vectorContext, ...args),
    delete: (...args) => memoryVectorCollectionDelete<T, TPayload>(vectorContext, ...args),
    deleteWhere: (...args) =>
      memoryVectorCollectionDeleteWhere<T, TPayload>(vectorContext, ...args),
    search: (...args) => memoryVectorCollectionSearch<T, TPayload>(vectorContext, ...args)
  }
}

/** Stored point values are canonical snapshots and remain inaccessible to application code. */
function memoryVectorPoint<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  id: string
): IStorageVectorPoint<TPayload> | undefined {
  const encoded = encodeFlatStorageKey(
    vectorKey(vectorContext.namespaceContext, vectorContext.captured.name, id)
  )
  const entry = liveEntry(vectorContext.namespaceContext, 'vector', encoded)
  if (entry !== undefined)
    vectorContext.namespaceContext.capacityIndex?.touch(
      identity(vectorContext.namespaceContext, 'vector', encoded)
    )
  return entry?.value as IStorageVectorPoint<TPayload> | undefined
}

/** Search removes expired rows before filtering/scoring; physical deleteWhere retains them. */
function* memoryVectorPoints<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  physical = false
): IterableIterator<IStorageVectorPoint<TPayload>> {
  /** The original radix locates this collection without retaining all candidate references. */
  let leaf = vectorContext.namespaceContext.ordered.vector.lowerBound(vectorContext.bounds.lower)
  while (leaf !== undefined && compareRecordIndexKeys(leaf.key, vectorContext.bounds.upper) < 0) {
    /** Expiry or a caller delete can unlink this leaf before the generator resumes. */
    const next = leaf.next
    /** Physical deletion includes expired matches; ranking reclaims them before scoring. */
    const entry = physical
      ? leaf.value
      : liveEntry(vectorContext.namespaceContext, 'vector', encodeFlatStorageKey(leaf.value.key))
    if (entry !== undefined) {
      if (!physical)
        vectorContext.namespaceContext.capacityIndex?.touch(
          identity(vectorContext.namespaceContext, 'vector', encodeFlatStorageKey(entry.key))
        )
      yield entry.value as IStorageVectorPoint<TPayload>
    }
    leaf = next
  }
}

/** Output payloads/vectors detach only for selected native hits, preserving bounded work. */
function memoryVectorOutput<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  hit: ReturnType<typeof rankMemoryVectors<TPayload>>[number],
  withVector: boolean,
  withPayload: boolean
): IVectorHit<TPayload, boolean> {
  return {
    id: hit.point.id,
    score: hit.score,
    ...(withPayload && hit.point.payload !== undefined
      ? { payload: clone(vectorContext.namespaceContext, hit.point.payload) }
      : {}),
    ...(withVector ? { vector: [...hit.point.vector] } : {})
  }
}

/** A source keeps one immutable resolver; canonical query nodes still own every refinement. */
function memoryVectorQuery<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  resolve: (lookup: (id: string) => IStorageVectorPoint<TPayload> | undefined) => {
    query: readonly number[]
    exclude: ReadonlySet<string>
  },
  metric: IStorageVectorConfiguration['metric'],
  origin: IVectorQueryOrigin
) {
  /** Native ranking is shared verbatim by reads and this original transaction draft. */
  const select: IMemoryVectorSelection<TPayload> = (input, values, lookup) => {
    /** Samples resolve once inside the actual read or write attempt. */
    const selected = resolve(lookup)
    if (input.topK === 0) return []
    /** Canonical conditions retain the sole compiler and original membership Sets. */
    const predicates = input.conditions.map((condition) =>
      compileStorageQueryCondition<TPayload | undefined>(condition)
    )
    return rankMemoryVectors(
      values,
      selected.query,
      metric,
      input.topK,
      input.minScore,
      (point) =>
        !selected.exclude.has(point.id) && predicates.every((predicate) => predicate(point.payload))
    ).map((hit): readonly [IStorageKey, IVectorHit<TPayload, boolean>] => [
      hit.point.id,
      memoryVectorOutput<T, TPayload>(vectorContext, hit, input.withVector, true)
    ])
  }
  return createVectorQuery<TPayload>(
    {
      asyncDisposeKey,
      exact: true,
      origin,
      beginOperation: () => vectorContext.namespaceContext.controller.beginMutation(),
      watch: ({ ctx }) => watchChanges(vectorContext.namespaceContext, 'all', ctx),
      mutate: (request, run) =>
        atomicEntry(
          vectorContext.namespaceContext,
          MemoryOperation.vectorQueryDelete,
          () => ({ ...request }),
          { ...request.ctx, concurrency: request.concurrency },
          (input) => ({
            invoke: (scope) =>
              scope[queryDraft].vector(vectorContext.captured.name, input, run, select)
          })
        ),
      pushdown: {
        source: MemoryState.querySource,
        operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
        operators: Object.values(QueryOperator)
      },
      execute: (input) => {
        vectorContext.namespaceContext.controller.assertLive()
        return nativeIterator(
          vectorContext.namespaceContext,
          MemoryOperation.vectorSearch,
          input.ctx,
          () =>
            select(input, memoryVectorPoints<T, TPayload>(vectorContext), (id: string) =>
              memoryVectorPoint<T, TPayload>(vectorContext, id)
            ),
          (row) => row,
          () => vectorContext.namespaceContext.controller.assertLive()
        )
      }
    },
    vectorContext.namespaceContext.core.getChainMethods('vector')
  )
}
/** Execute the collection's original near against explicit collection facts. */
function memoryVectorCollectionNear<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['near']>
): ReturnType<IVectorCollection<TPayload>['near']> {
  const [input, options] = args
  vectorContext.namespaceContext.controller.assertLive()
  return (() => {
    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    )
      invalidVector()
    /** Optional request fields are read once before the immutable source captures them. */
    const inputMetric = options?.metric
    const metric = inputMetric === undefined ? vectorContext.configuration.metric : inputMetric
    /** Memory is exact for either request; malformed explicit options still reject. */
    const exact = options?.exact
    if (exact !== undefined && typeof exact !== 'boolean') invalidVector()
    /** The original component owner snapshots the query and the requested metric. */
    const components = snapshotStorageVector(
      input,
      { dimensions: vectorContext.configuration.dimensions, metric },
      STORAGE_MEMORY_BACKEND
    )
    return memoryVectorQuery<T, TPayload>(
      vectorContext,
      () => ({ query: components, exclude: new Set<string>() }),
      metric,
      {
        kind: VectorQueryOriginKind.near,
        vector: components
      }
    )
  })()
}
/** Execute the collection's original similarTo against explicit collection facts. */
function memoryVectorCollectionSimilarTo<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['similarTo']>
): ReturnType<IVectorCollection<TPayload>['similarTo']> {
  const [id] = args
  vectorContext.namespaceContext.controller.assertLive()
  assertStringStorageKey(id, STORAGE_MEMORY_BACKEND)
  return memoryVectorQuery<T, TPayload>(
    vectorContext,
    (lookup) => {
      /** A missing/expired sample is rejected before native candidates are ranked. */
      const sample = lookup(id)
      if (sample === undefined) invalidVector()
      return {
        query: snapshotStorageVector(
          sample.vector,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        ),
        exclude: new Set([id])
      }
    },
    vectorContext.configuration.metric,
    { kind: VectorQueryOriginKind.similarTo, id }
  )
}
/** Execute the collection's original recommend against explicit collection facts. */
function memoryVectorCollectionRecommend<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['recommend']>
): ReturnType<IVectorCollection<TPayload>['recommend']> {
  const [input] = args
  vectorContext.namespaceContext.controller.assertLive()
  /** The original key batch owner detaches ID arrays before their asynchronous use. */
  const samples = (() => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) invalidVector()
    const { positive, negative } = input
    const positiveIds = vectorIds(vectorContext.namespaceContext, positive)
    const negativeIds = vectorIds(
      vectorContext.namespaceContext,
      negative === undefined ? [] : negative
    )
    if (positiveIds.length === 0) invalidVector()
    const exclude = new Set([...positiveIds, ...negativeIds])
    if (exclude.size !== positiveIds.length + negativeIds.length) invalidVector()
    return { positiveIds, negativeIds, exclude }
  })()
  return memoryVectorQuery<T, TPayload>(
    vectorContext,
    (lookup) => {
      /** Every requested sample resolves against this collection and immutable organization. */
      const load = (id: string): readonly number[] => {
        const sample = lookup(id)
        if (sample === undefined) invalidVector()
        return sample.vector
      }
      const positive = samples.positiveIds.map(load)
      const negative = samples.negativeIds.map(load)
      const combined = recommendStorageVector(
        positive as [readonly number[], ...(readonly number[])[]],
        negative
      )
      return {
        query: snapshotStorageVector(combined, vectorContext.configuration, STORAGE_MEMORY_BACKEND),
        exclude: samples.exclude
      }
    },
    vectorContext.configuration.metric,
    {
      kind: VectorQueryOriginKind.recommend,
      positive: samples.positiveIds,
      negative: samples.negativeIds
    }
  )
}
/** Execute the collection's original upsert against explicit collection facts. */
function memoryVectorCollectionUpsert<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['upsert']>
): ReturnType<IVectorCollection<TPayload>['upsert']> {
  const [points, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorUpsert,
      points,
      ctx,
      (input, context) => {
        /** Full-batch capture occurs before any original lock wait or physical mutation. */
        const prepared = snapshotStorageVectorUpsert(
          input,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        )
        /** Complete canonical payload encoding also finishes before the first native put. */
        const sizes = prepared.map((point) =>
          entryBytes(vectorContext.namespaceContext, 'vector', point)
        )
        /** Extension fields came from the original concurrency snapshot, never a second raw read. */
        const ttlMs = Reflect.get(context, 'ttlMs') as number | undefined
        if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, STORAGE_MEMORY_BACKEND)
        return {
          keys: prepared.map((point) => lockKey.vector(vectorContext.captured.name, point.id)),
          invoke: (draft) =>
            draft.upsertVector(vectorContext.captured.name, prepared, sizes, ttlMs),
          capacityChanges:
            vectorContext.namespaceContext.capacity === undefined
              ? undefined
              : () =>
                  prepared.map((point, index) => {
                    const key = vectorKey(
                      vectorContext.namespaceContext,
                      vectorContext.captured.name,
                      point.id
                    )
                    const deadline =
                      ttlMs === undefined
                        ? vectorContext.namespaceContext.deadlines.get(
                            identity(
                              vectorContext.namespaceContext,
                              'vector',
                              encodeFlatStorageKey(key)
                            )
                          )
                        : vectorContext.namespaceContext.scheduler.now() + ttlMs
                    return capacityFact(
                      vectorContext.namespaceContext,
                      'vector',
                      key,
                      ttlMs !== undefined &&
                        deadline !== undefined &&
                        deadline <= vectorContext.namespaceContext.scheduler.now()
                        ? undefined
                        : sizes[index]
                    )
                  }),
          run: () => {
            /** One monotonic clock observation applies to this synchronous admitted batch. */
            const now = vectorContext.namespaceContext.scheduler.now()
            for (const [index, point] of prepared.entries()) {
              const key = vectorKey(
                vectorContext.namespaceContext,
                vectorContext.captured.name,
                point.id
              )
              const encoded = encodeFlatStorageKey(key)
              const current = liveEntry(vectorContext.namespaceContext, 'vector', encoded)
              const orderedKey =
                current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND)
              const deadline =
                ttlMs === undefined
                  ? vectorContext.namespaceContext.deadlines.get(
                      identity(vectorContext.namespaceContext, 'vector', encoded)
                    )
                  : now + ttlMs
              if (deadline !== undefined && deadline <= now) {
                removeVector(vectorContext.namespaceContext, vectorContext.captured.name, point.id)
                continue
              }
              const entry = { key, ordered: orderedKey, value: point, bytes: sizes[index] }
              vectorContext.namespaceContext.data.vector.set(encoded, entry)
              vectorContext.namespaceContext.ordered.vector.set(orderedKey, entry)
              setDeadline(vectorContext.namespaceContext, 'vector', encoded, deadline)
              vectorContext.namespaceContext.capacityIndex?.put({
                ...capacityFact(vectorContext.namespaceContext, 'vector', key),
                bytes: sizes[index]!
              })
              bump(vectorContext.namespaceContext, 'vector', encoded)
            }
            if (prepared.length > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
          }
        }
      }
    )
  )
}
/** Execute the collection's original delete against explicit collection facts. */
function memoryVectorCollectionDelete<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['delete']>
): ReturnType<IVectorCollection<TPayload>['delete']> {
  const [ids, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorDelete,
      ids,
      ctx,
      (input) => {
        const capturedIds = vectorIds(vectorContext.namespaceContext, input)
        return {
          keys: capturedIds.map((id) => lockKey.vector(vectorContext.captured.name, id)),
          invoke: (draft) => {
            for (const id of capturedIds)
              draft.remove(
                'vector',
                vectorKey(vectorContext.namespaceContext, vectorContext.captured.name, id)
              )
          },
          run: () => {
            let count = 0
            for (const id of capturedIds)
              if (removeVector(vectorContext.namespaceContext, vectorContext.captured.name, id))
                count++
            if (count > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
          }
        }
      }
    )
  )
}
/** Execute the collection's original deleteWhere against explicit collection facts. */
function memoryVectorCollectionDeleteWhere<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['deleteWhere']>
): ReturnType<IVectorCollection<TPayload>['deleteWhere']> {
  const [where, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    mutationEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorDeleteWhere,
      where,
      ctx,
      (input, context) => {
        const count = Reflect.get(context, 'count')
        if (
          count !== undefined &&
          count !== DeleteCountMode.precount &&
          count !== DeleteCountMode.scroll
        )
          invalidVector()
        const predicate = compileStorageWhere<TPayload | undefined>(input)
        return {
          keys: [],
          invoke: (draft) =>
            draft.deleteVector(vectorContext.captured.name, (point) =>
              predicate(point.payload as TPayload | undefined)
            ),
          ranges: [
            {
              channel: 'vector',
              ...snapshotConcurrencyLockRange({ channel: 'vector' }, STORAGE_MEMORY_BACKEND)
            }
          ],
          run: () => {
            let count = 0
            for (const point of memoryVectorPoints<T, TPayload>(vectorContext, true))
              if (
                predicate(point.payload) &&
                removeVector(vectorContext.namespaceContext, vectorContext.captured.name, point.id)
              )
                count++
            if (count > 0) publish(vectorContext.namespaceContext, 'vector', 'batch')
            return count
          }
        }
      }
    )
  )
}
/** Execute the collection's original search against explicit collection facts. */
function memoryVectorCollectionSearch<T, TPayload>(
  vectorContext: IMemoryVectorContext<T>,
  ...args: Parameters<IVectorCollection<TPayload>['search']>
): ReturnType<IVectorCollection<TPayload>['search']> {
  const [query, options, ctx] = args
  return vectorOperation(vectorContext.namespaceContext, () =>
    asyncEntry(
      vectorContext.namespaceContext,
      MemoryOperation.vectorSearch,
      { query, options },
      ctx,
      (input) => {
        vectorContext.namespaceContext.controller.assertLive()
        const request = snapshotStorageVectorSearch(
          input.query,
          input.options,
          vectorContext.configuration,
          STORAGE_MEMORY_BACKEND
        )
        if (request.options.k === 0) return []
        const filter =
          request.options.filter === undefined
            ? undefined
            : compileStorageQueryCondition<TPayload | undefined>(
                vectorCondition(request.options.filter)
              )
        return rankMemoryVectors(
          memoryVectorPoints<T, TPayload>(vectorContext),
          request.query,
          vectorContext.configuration.metric,
          request.options.k,
          undefined,
          (point) => filter === undefined || filter(point.payload)
        ).map((hit) =>
          memoryVectorOutput<T, TPayload>(vectorContext, hit, false, request.options.withPayload)
        )
      }
    )
  )
}
export function createMemoryNamespaceVectors<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['vectors'] {
  return {
    collection: <TPayload>(
      name: string,
      options?: IStorageVectorConfiguration
    ): IVectorCollection<TPayload> => createMemoryVectorCollection(namespaceContext, name, options)
  }
}
