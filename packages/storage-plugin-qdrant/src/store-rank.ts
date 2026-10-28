// Rank sources, rescoring and native feature port for the Qdrant store (see ./store.ts).
import { snapshotStorageWhere, createStorageIteratorLifetime } from '@migaia/storage-host/sdk'
import {
  assertStorageVector,
  type IVectorQueryOrigin,
  QueryOperation,
  QueryOperator,
  type IOperationContext,
  type IStorageVectorConfiguration,
  type IVectorHit,
  type IVectorQueryInput,
  type IStorageIterator,
  type IStorageKey,
  type IWhere,
  type IQueryCondition
} from '@migaia/storage-contract'
import { QdrantRoute, QdrantText, QdrantManagedVectorName } from './constants.ts'
import { invalidArgument, qdrantError } from './errors.ts'
import { QdrantErrorCode } from '@migaia/storage-contract/error-code'
import { nativeId } from './id.ts'
import { nativeCondition, orgFilter, type IQdrantFilter } from './filter.ts'
import { snapshotRescoreVector, snapshotRescorePoints } from './feature-input.ts'
import type { IQdrantRescoreVector, IQdrantRescorePoint } from './feature-types.ts'
import type { IQdrantNativeFeaturePort } from './native-feature.ts'
import type { IQdrantHttp, IQdrantOperationName } from './types.ts'
import type { IQdrantQueryRow } from './store-collection.ts'
import {
  report,
  run,
  rescoreSlot,
  unsupported,
  admitRescore,
  resolveCollection,
  requireRescore,
  send,
  decode,
  sample,
  operationResult
} from './store.ts'
import type { IQdrantOrganizationContext, ICollectionState } from './store.ts'

/** One accepted query retains its source selection and immutable query options across native awaits. */
type IQdrantQueryContext = {
  readonly organizationContext: IQdrantOrganizationContext
  readonly state: ICollectionState
  readonly resolve: (
    name: string,
    configuration: IStorageVectorConfiguration,
    ctx: IOperationContext,
    now: number
  ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>
  readonly exact: boolean
  readonly metric?: IStorageVectorConfiguration['metric']
  readonly initialConditions: readonly IQueryCondition[]
  readonly origin?: IVectorQueryOrigin
}
/** The query source borrows the original backend and creates an independent native-rank iterator. */
export class QdrantRankSource<TPayload> {
  /** Fixed query options route every terminal through the same organization and collection. */
  readonly #context: IQdrantQueryContext
  /** Exact selection is public query planning metadata, not a native fallback. */
  readonly exact: boolean
  /** Original origin permits installed rescore refinement without replacing its vector source. */
  readonly origin: IVectorQueryOrigin | undefined
  /** Native refinement is advertised only for the existing configured rescore slot. */
  declare readonly native?: true
  /** Native rank results already support the existing grouped query reader. */
  readonly groupBy = true
  /** Only native-supported operators and terminals can be pushed down. */
  readonly pushdown = {
    source: QdrantText.backend,
    operators: Object.values(QueryOperator),
    operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
    canPushCondition: (condition: IQueryCondition) => nativeCondition(condition) !== undefined
  }
  /** Retain the accepted query facts without opening native resources. */
  constructor(context: IQdrantQueryContext) {
    this.#context = context
    this.exact = context.exact
    this.origin = context.origin
    if (context.organizationContext.backendContext.rescore !== undefined) this.native = true
  }
  /** The original change controller owns admission leases. */
  beginOperation = () => this.#context.organizationContext.backendContext.controller.beginMutation()
  /** One execution gets one named iterator and original resource lease. */
  execute = (input: IVectorQueryInput): IStorageIterator<IQdrantQueryRow<TPayload>> => {
    this.#context.organizationContext.backendContext.controller.assertLive()
    return new QdrantRankIterator<TPayload>(this.#context, input)
  }
}
/** One native-rank iterator owns loading, row position and its original iterator lifetime. */
class QdrantRankIterator<TPayload> implements IStorageIterator<IQdrantQueryRow<TPayload>> {
  /** Source facts are fixed before this cursor becomes visible. */
  readonly #context: IQdrantQueryContext
  /** Original pipeline input owns conditions, topK and cancellation for this execution. */
  readonly #input: IVectorQueryInput
  /** Native rows remain local to this cursor until close. */
  #rows: readonly IQdrantQueryRow<TPayload>[] | undefined
  /** The next native row position advances only inside the original lifetime. */
  #index = 0
  /** Concurrent next calls share the one accepted native ranking promise. */
  #loading: Promise<readonly IQdrantQueryRow<TPayload>[]> | undefined
  /** Existing shared iterator lifecycle owns close, return and failure reporting. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<IQdrantQueryRow<TPayload>>>
  /** Register this cursor with the existing resource owner after its lifetime is allocated. */
  constructor(context: IQdrantQueryContext, input: IVectorQueryInput) {
    this.#context = context
    this.#input = input
    this.#lifetime = createStorageIteratorLifetime<IQdrantQueryRow<TPayload>>({
      close: async () => {
        this.#rows = undefined
        this.#loading = undefined
      },
      report: (error) => report(context.organizationContext.backendContext, error),
      onSettled: () => {
        context.organizationContext.backendContext.resources.release(this)
      }
    })
    context.organizationContext.backendContext.resources.own(this, { force: () => this.dispose() })
  }
  /** Preserve closed-cursor and original store-disposal behavior before advancing. */
  next = () => {
    this.#context.organizationContext.backendContext.controller.assertLive()
    if (this.#lifetime.isClosing())
      return Promise.resolve({ done: true as const, value: undefined })
    return this.#lifetime.advance(() => this.#advance())
  }
  /** Load at most once and retain the native rank's original row ordering. */
  async #advance(): Promise<IteratorResult<IQdrantQueryRow<TPayload>>> {
    this.#rows ??= await (this.#loading ??= loadQdrantRank<TPayload>(this.#context, this.#input))
    const row = this.#rows[this.#index++]
    return row === undefined ? { done: true, value: undefined } : { done: false, value: row }
  }
  /** Return uses the same cached lifetime close promise. */
  return = (value?: unknown) => this.#lifetime.returned(value)
  /** Ordinary disposal retains the exact original shared promise. */
  dispose = () => this.#lifetime.dispose();
  /** Symbol disposal retains the original one-report cleanup behavior. */
  [Symbol.asyncDispose] = () => this.#lifetime.symbolic();
  /** Iteration never creates another cursor or resource. */
  [Symbol.asyncIterator]() {
    return this
  }
}
/** Enter original operation admission before native schema reads and rank execution. */
function loadQdrantRank<TPayload>(
  queryContext: IQdrantQueryContext,
  input: IVectorQueryInput
): Promise<readonly IQdrantQueryRow<TPayload>[]> {
  return run(
    queryContext.organizationContext,
    QdrantText.search,
    input,
    input.ctx,
    false,
    (next, context) => executeQdrantRank<TPayload>(queryContext, next, context)
  )
}
/**
 * Resolve and execute one bounded native rank, keeping logical payload and score conversion
 * together.
 */
async function executeQdrantRank<TPayload>(
  queryContext: IQdrantQueryContext,
  next: IVectorQueryInput,
  context: IOperationContext
): Promise<readonly IQdrantQueryRow<TPayload>[]> {
  const { organizationContext, state, resolve, exact, metric, initialConditions } = queryContext

  /** Pipeline replacements are captured before schema reads or native ranking. */
  const refinement = next.native
  const native =
    refinement === undefined
      ? undefined
      : (function readAcceptedInput() {
          const { kind, query, topN } = refinement as {
            kind: unknown
            query: IQdrantRescoreVector
            topN: number
          }
          if (
            kind !== QdrantText.rescore ||
            !Number.isSafeInteger(topN) ||
            topN < 1 ||
            topN > next.topK
          )
            throw invalidArgument()
          const selected = rescoreSlot(organizationContext.backendContext, state.name)
          if (!selected) unsupported()
          return {
            query: admitRescore(
              organizationContext.backendContext,
              snapshotRescoreVector(query),
              selected
            ),
            topN
          }
        })()
  const {
    name,
    configuration,
    rescore: actualSlot
  } = await resolveCollection(organizationContext, state, context)
  const extra =
    native === undefined
      ? undefined
      : requireRescore(organizationContext.backendContext, state.name, actualSlot)
  if (metric !== undefined && metric !== configuration.metric) unsupported()
  const now = Date.now(),
    selected = await resolve(name, configuration, context, now)
  if (next.topK === 0) return []
  const conditions = [...initialConditions, ...next.conditions].map(nativeCondition)
  if (conditions.some((condition) => condition === undefined)) unsupported()
  const exclude = await Promise.all(
      selected.exclude.map((id) => nativeId([organizationContext.orgId, id]))
    ),
    filter = orgFilter(organizationContext.orgId, conditions as IQdrantFilter[], now)
  if (exclude.length) filter.must_not = [{ has_id: exclude }]
  assertStorageVector(selected.query, configuration, QdrantText.backend)
  const direction = selected.query,
    result = await send(
      organizationContext,
      'query',
      [name, qdrantRankParameters(native, direction, filter, exact, next, configuration)],
      context
    )
  if (!Array.isArray(result?.points)) throw qdrantError(QdrantErrorCode.responseInvalid)
  const hits: (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] = []
  for (const point of result.points) {
    const row = await decode(organizationContext, point)
    if (typeof point.score !== 'number' || !Number.isFinite(point.score))
      throw qdrantError(QdrantErrorCode.responseInvalid)
    hits.push([
      row.id,
      {
        id: row.id,
        score: (extra?.metric ?? configuration.metric) === 'euclid' ? -point.score : point.score,
        ...(row.payload === undefined ? {} : { payload: row.payload as TPayload }),
        ...(next.withVector ? { vector: sample(organizationContext, point, configuration) } : {})
      }
    ])
  }
  return hits
}

/** Execute the original updateRescoreVectors feature job with explicit organization context. */
function updateQdrantRescoreVectors(
  organizationContext: IQdrantOrganizationContext,
  collection: string,
  points: readonly IQdrantRescorePoint[],
  ctx?: IOperationContext
) {
  if (typeof organizationContext.backendContext.http[QdrantRoute.updateVectors.name] !== 'function')
    unsupported()
  const selected = rescoreSlot(organizationContext.backendContext, collection)
  if (!selected) unsupported()
  for (const point of points)
    admitRescore(organizationContext.backendContext, point.vector, selected)
  return run(organizationContext, QdrantText.rescore, points, ctx, true, async (input, context) => {
    const prepared = snapshotRescorePoints(input)
    const vectors = prepared.map((point) =>
      admitRescore(organizationContext.backendContext, point.vector, selected)
    )
    const state = organizationContext.backendContext.collections.get(collection) ?? {
      name: collection
    }
    const resolved = await resolveCollection(organizationContext, state, context)
    requireRescore(organizationContext.backendContext, collection, resolved.rescore)
    return send(
      organizationContext,
      QdrantRoute.updateVectors.name,
      [
        resolved.name,
        {
          points: await Promise.all(
            prepared.map(async (point, index) => ({
              id: await nativeId([organizationContext.orgId, point.id]),
              vector: { [QdrantManagedVectorName.rescore]: vectors[index]! }
            }))
          ),
          wait: true
        }
      ],
      context
    )
  })
}

/** Execute the original run feature job with explicit organization context. */
function runQdrantNativeOperation<K extends IQdrantOperationName>(
  organizationContext: IQdrantOrganizationContext,
  operation: K,
  args: readonly unknown[],
  ctx: IOperationContext | undefined,
  write: boolean,
  validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
) {
  if (organizationContext.orgId !== organizationContext.backendContext.core.defaultOrgId)
    unsupported()
  return run<readonly unknown[], Awaited<ReturnType<IQdrantHttp[K]>>>(
    organizationContext,
    operation,
    args,
    ctx,
    write,
    async (input, context): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
      if (validate)
        validate(
          await send(organizationContext, QdrantRoute.getCollection.name, [input[0]], context)
        )
      return await send(organizationContext, operation, input, context)
    }
  )
}

/** Execute the original managedDelete feature job with explicit organization context. */
function deleteQdrantManagedPoints<TPayload>(
  organizationContext: IQdrantOrganizationContext,
  collection: string,
  where: IWhere<TPayload> | undefined,
  options: { wait?: boolean; ordering?: 'weak' | 'medium' | 'strong' } | undefined,
  ctx: IOperationContext | undefined,
  purge: boolean
) {
  const condition = where === undefined ? undefined : snapshotStorageWhere(where),
    expression = condition === undefined ? undefined : nativeCondition(condition)
  if (condition !== undefined && expression === undefined) unsupported()
  const captured = {
    wait: options?.wait ?? true,
    ordering: options?.ordering,
    policy: (
      ctx as
        | (IOperationContext & {
            readonly concurrency?: import('@migaia/storage-contract').IConcurrencyPolicy
          })
        | undefined
    )?.concurrency
  }
  if (
    typeof captured.wait !== 'boolean' ||
    (captured.ordering !== undefined && !['weak', 'medium', 'strong'].includes(captured.ordering))
  )
    throw invalidArgument()
  const state = organizationContext.backendContext.collections.get(collection) ?? {
    name: collection
  }
  return run(
    organizationContext,
    purge ? QdrantText.purgeExpired : QdrantText.deleteByFilter,
    undefined,
    ctx,
    true,
    async (_input, context) => {
      const { name } = await resolveCollection(organizationContext, state, context),
        filter = orgFilter(
          organizationContext.orgId,
          purge
            ? [
                {
                  must: [
                    {
                      key: JSON.stringify(QdrantText.expiresAt),
                      range: { lt: new Date(Date.now()).toISOString() }
                    }
                  ]
                }
              ]
            : expression === undefined
              ? []
              : [expression]
        )
      return operationResult(
        await send(
          organizationContext,
          'delete',
          [
            name,
            {
              filter,
              wait: captured.wait,
              ...(captured.ordering === undefined ? {} : { ordering: captured.ordering })
            }
          ],
          context
        )
      )
    },
    captured.policy
  )
}

/**
 * Assemble finite native Feature ports; each short adapter passes explicit organization state to
 * its job.
 */
export function createQdrantNativeFeaturePort(
  organizationContext: IQdrantOrganizationContext
): IQdrantNativeFeaturePort {
  return {
    updateRescoreVectors: (
      collection: string,
      points: readonly IQdrantRescorePoint[],
      ctx?: IOperationContext
    ) => updateQdrantRescoreVectors(organizationContext, collection, points, ctx),
    run: <K extends IQdrantOperationName>(
      operation: K,
      args: readonly unknown[],
      ctx: IOperationContext | undefined,
      write: boolean,
      validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
    ) => runQdrantNativeOperation<K>(organizationContext, operation, args, ctx, write, validate),
    managedDelete: <TPayload>(
      collection: string,
      where: IWhere<TPayload> | undefined,
      options: { wait?: boolean; ordering?: 'weak' | 'medium' | 'strong' } | undefined,
      ctx: IOperationContext | undefined,
      purge: boolean
    ) =>
      deleteQdrantManagedPoints<TPayload>(
        organizationContext,
        collection,
        where,
        options,
        ctx,
        purge
      )
  } satisfies IQdrantNativeFeaturePort
}

/** Encode one native rank request, keeping prefetch and score conventions in the same wire owner. */
function qdrantRankParameters(
  native: { query: IQdrantRescoreVector; topN: number } | undefined,
  direction: readonly number[],
  filter: IQdrantFilter,
  exact: boolean,
  next: IVectorQueryInput,
  configuration: IStorageVectorConfiguration
) {
  return {
    query: native?.query ?? [...direction],
    using: native === undefined ? QdrantManagedVectorName.search : QdrantManagedVectorName.rescore,
    filter,
    params: { exact: native === undefined ? exact : true },
    limit: native?.topN ?? next.topK,
    ...(native === undefined
      ? {}
      : {
          prefetch: {
            query: [...direction],
            using: QdrantManagedVectorName.search,
            filter,
            params: { exact },
            limit: next.topK,
            ...(next.minScore === undefined
              ? {}
              : {
                  score_threshold:
                    configuration.metric === 'euclid' ? -next.minScore : next.minScore
                })
          }
        }),
    ...(native !== undefined || next.minScore === undefined
      ? {}
      : {
          score_threshold: configuration.metric === 'euclid' ? -next.minScore : next.minScore
        }),
    with_payload: true,
    with_vector: next.withVector
      ? [
          configuration.metric === 'cosine'
            ? QdrantManagedVectorName.source
            : QdrantManagedVectorName.search
        ]
      : false
  }
}
