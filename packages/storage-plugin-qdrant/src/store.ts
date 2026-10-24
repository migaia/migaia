import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  vector,
  ttl,
  implement,
  provideCapabilities,
  createTransactionOwner,
  runWithConcurrency,
  resolveConcurrencyPolicy,
  snapshotOperationContext,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch,
  snapshotStorageVectorIds,
  snapshotStorageDeleteCountMode,
  assertStringStorageKey,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  createVectorQuery,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  createStorageIteratorLifetime,
  compileStorageQueryCondition,
  snapshotStorageWhere,
  QueryOperation,
  QueryOperator,
  DeleteCountMode,
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IOperationContext,
  type IStorageVectorConfiguration,
  type IVectorApi,
  type IVectorCollection,
  type IVectorHit,
  type IVectorQueryInput,
  type IStorageIterator,
  type IStorageKey,
  type IWhere,
  type ITtlApi,
  type IQueryCondition
} from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { Schemas } from '@qdrant/js-client-rest'
import type { IStoragePluginCore } from '@migaia/storage-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/authoring/backend'
import { recommendStorageVector } from '@migaia/storage-host/authoring/vector'
import {
  QdrantRoute,
  QdrantText,
  QdrantManagedVectorName,
  QdrantRequiredOperations
} from './constants.js'
import {
  capture,
  invalidArgument,
  normalizeQdrantError,
  normalizeOperationError,
  qdrantError,
  responseStatus
} from './errors.js'
import { QdrantErrorCode } from './error-code.js'
import { nativeId } from './id.js'
import { encodePointPayload, decodePointPayload, assertPointPayload } from './envelope.js'
import { nativeCondition, orgFilter, type IQdrantFilter } from './filter.js'
import { collectionVectors, readCollectionConfiguration } from './schema.js'
import { nativeFeaturePort, type IQdrantNativeFeaturePort } from './native-feature.js'
import type {
  IQdrantBase,
  IQdrantStore,
  IQdrantOptions,
  IQdrantHttp,
  IQdrantOperationName,
  IQdrantUpdateResult
} from './types.js'
import type {} from './hooks.js'
/** A descriptor borrows one resolved physical schema across every organization. */
type ICollectionState = {
  readonly name: string
  configuration?: IStorageVectorConfiguration
  resolved?: Promise<{ name: string; configuration: IStorageVectorConfiguration }>
}
/** Genuine missing native methods never become a fabricated fallback transport. */
function unsupported(): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: QdrantText.backend
  })
}
/** Shared capture owns admission; native deletion and recommendation retain first-occurrence IDs. */
function idsOf(ids: readonly string[]): string[] {
  return [...new Set(snapshotStorageVectorIds(ids, QdrantText.backend))]
}
/** One native operation record is not a count, including acknowledged asynchronous writes. */
function operationResult(result: Schemas['UpdateResult']): IQdrantUpdateResult {
  if (
    !Number.isSafeInteger(result?.operation_id) ||
    (result.status !== 'completed' && result.status !== 'acknowledged')
  )
    throw qdrantError(QdrantErrorCode.responseInvalid)
  return { operationId: result.operation_id!, status: result.status }
}
/** Adapt the admitted vector filter shape to the sole canonical query condition vocabulary. */
function vectorCondition(
  filter: import('@migaia/storage-contract').IVectorFilter
): IQueryCondition {
  if ('all' in filter) return { kind: 'and', conditions: filter.all.map(vectorCondition) }
  if ('any' in filter) return { kind: 'or', conditions: filter.any.map(vectorCondition) }
  if ('not' in filter) return { kind: 'not', condition: vectorCondition(filter.not) }
  const path = parseObjectPath(filter.field).map(String)
  if ('eq' in filter) return { kind: 'field', path, operator: QueryOperator.eq, value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: QueryOperator.in, value: filter.in }
  return {
    kind: 'and',
    conditions: [
      ...(filter.gte === undefined
        ? []
        : [{ kind: 'field' as const, path, operator: QueryOperator.gte, value: filter.gte }]),
      ...(filter.lte === undefined
        ? []
        : [{ kind: 'field' as const, path, operator: QueryOperator.lte, value: filter.lte }])
    ]
  }
}
/** Install the existing controller, lifecycle and immutable organization projection owners. */
export function createQdrantBackend(
  options: IQdrantOptions & { readonly http: IQdrantHttp; readonly collectionPrefix: string },
  core: IStoragePluginCore
) {
  const resources = createLifecycleScope(),
    collections = new Map<string, ICollectionState>(),
    stores = new Map<
      string,
      { store: IQdrantStore; installer: ICapabilityInstallPort; drop: () => Promise<void> }
    >(),
    http = options.http,
    namespace = nativeId([options.collectionPrefix]).then((hash) => QdrantText.prefix + hash + '_')
  let detected = false,
    symbolic: Promise<void> | undefined
  const report = (error: unknown): void => {
    core.stageBindings.backendStages.report(error)
  }
  const controller = core.createChangeController({
    backend: QdrantText.backend,
    finalize: async () => {
      try {
        await resources.dispose()
      } finally {
        stores.clear()
        collections.clear()
      }
    }
  })
  /**
   * Organization wrappers never create another native client, collection registry or disposal
   * right.
   */
  const forOrg = (orgId: string) => {
    controller.assertLive()
    const previous = stores.get(orgId)
    if (previous) return previous
    const ports = core.getOrgContext(orgId),
      identity = { backendId: core.getBackendId(), backend: QdrantText.backend, orgId }
    let store!: IQdrantStore, installer!: ICapabilityInstallPort
    const base: IQdrantBase = {
      backend: QdrantText.backend,
      capabilities: Object.freeze({
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      }),
      dispose: () => controller.dispose(),
      [Symbol.asyncDispose]: () => (symbolic ??= controller.dispose().then(undefined, report))
    }
    /** Every actual wire call contributes sanitized route statistics to the original hook registry. */
    const send = async <K extends IQdrantOperationName>(
      operation: K,
      args: readonly unknown[],
      ctx: IOperationContext
    ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
      throwIfAborted(ctx.signal)
      const route = QdrantRoute[operation],
        start = systemScheduler.now()
      let status: number | undefined
      try {
        const method = http[operation]
        if (typeof method !== 'function') unsupported()
        const value = await Reflect.apply(method, http, [...args, ctx])
        return value as Awaited<ReturnType<IQdrantHttp[K]>>
      } catch (error) {
        status = responseStatus(error)
        throw normalizeQdrantError(error)
      } finally {
        core.emit(QdrantText.onHttpRequest, () => ({
          ...identity,
          method: route.method,
          path: '/' + route.path.replace(':collection', encodeURIComponent(String(args[0]))),
          status,
          elapsedMs: systemScheduler.now() - start
        }))
      }
    }
    /** One public terminal retains one original admission lease until real native work settles. */
    const run = <I, T>(
      operation: string,
      input: I,
      ctx: IOperationContext | undefined,
      write: boolean,
      invoke: (input: I, ctx: IOperationContext) => Promise<T>,
      policy?: import('@migaia/storage-contract').IConcurrencyPolicy
    ): Promise<T> => {
      controller.assertLive()
      if (!detected) unsupported()
      const captured = snapshotOperationContext(ctx) ?? {}
      if (policy !== undefined) {
        resolveConcurrencyPolicy(base, policy)
        unsupported()
      }
      if (Reflect.get(ctx ?? {}, 'lock') !== undefined) unsupported()
      const release = controller.beginMutation(),
        cancellation = createAbortController(),
        stops: (() => void)[] = []
      try {
        stops.push(
          subscribeToAbort(
            captured.signal,
            () => cancellation.abort(readAbortReason(captured.signal)),
            report
          )
        )
        stops.push(
          subscribeToAbort(
            controller.closingSignal,
            () => cancellation.abort(readAbortReason(controller.closingSignal)),
            report
          )
        )
      } catch (error) {
        for (const stop of stops) stop()
        release()
        throw error
      }
      const context = { ...captured, orgId, signal: cancellation.signal }
      let prepared = input
      return observeStorageBatch(
        ports.stageBindings.operationStages(store),
        systemScheduler,
        operation,
        undefined,
        () =>
          runWithConcurrency<T>(
            {
              store: base,
              options: context,
              execute: (actual, loop) =>
                ports.execution.run({ operation, input, ctx: actual }, (next) => {
                  prepared = next
                  return loop()
                })
            },
            {
              attempt: async (actual) => ({
                status: 'committed',
                value: await invoke(prepared, actual)
              })
            }
          )
      )
        .catch((error) => {
          throw normalizeOperationError(error, operation)
        })
        .finally(() => {
          for (const stop of stops) stop()
          release()
        })
    }
    /** A single schema promise serializes only first configuration; it is never a point-write queue. */
    const resolveCollection = (state: ICollectionState, ctx: IOperationContext) =>
      (state.resolved ??= (async () => {
        const name = (await namespace) + (await nativeId([options.collectionPrefix, state.name]))
        let info: Awaited<ReturnType<IQdrantHttp['getCollection']>>
        try {
          info = await send(QdrantRoute.getCollection.name, [name], ctx)
        } catch (error) {
          if (responseStatus(error) !== 404 || !state.configuration) throw error
          try {
            await send(
              'createCollection',
              [name, { vectors: collectionVectors(state.configuration) }],
              ctx
            )
          } catch (cause) {
            if (responseStatus(cause) !== 409) throw cause
          }
          info = await send(QdrantRoute.getCollection.name, [name], ctx)
        }
        const configuration = readCollectionConfiguration(info, state.configuration)
        state.configuration = configuration
        const orgIndex =
            info.payload_schema?.[JSON.stringify(QdrantText.org)] ??
            info.payload_schema?.[QdrantText.org],
          expiryIndex =
            info.payload_schema?.[JSON.stringify(QdrantText.expiresAt)] ??
            info.payload_schema?.[QdrantText.expiresAt]
        if (orgIndex) {
          const params = orgIndex.params
          if (
            orgIndex.data_type !== 'keyword' ||
            !params ||
            !('is_tenant' in params) ||
            params.is_tenant !== true
          )
            throw invalidArgument()
        } else
          await send(
            'createPayloadIndex',
            [
              name,
              {
                field_name: JSON.stringify(QdrantText.org),
                field_schema: { type: 'keyword', is_tenant: true },
                wait: true
              }
            ],
            ctx
          )
        if (expiryIndex) {
          if (expiryIndex.data_type !== 'datetime') throw invalidArgument()
        } else
          await send(
            'createPayloadIndex',
            [
              name,
              {
                field_name: JSON.stringify(QdrantText.expiresAt),
                field_schema: 'datetime',
                wait: true
              }
            ],
            ctx
          )
        return { name, configuration }
      })().catch((error) => {
        state.resolved = undefined
        throw error
      }))
    /** Canonical envelopes and native UUIDs are cross-checked before any logical row is exposed. */
    const decode = async (point: Schemas['Record'] | Schemas['ScoredPoint']) => {
      const value = decodePointPayload(point.payload, orgId)
      if (point.id !== (await nativeId([orgId, value.id])))
        throw qdrantError(QdrantErrorCode.responseInvalid)
      return { ...value, point }
    }
    /** Source slots remain engine float32 values; no payload vector or scoring fallback exists. */
    const sample = (
      point: Schemas['Record'] | Schemas['ScoredPoint'],
      configuration: IStorageVectorConfiguration
    ): readonly number[] => {
      const vector = point.vector,
        name =
          configuration.metric === 'cosine'
            ? QdrantManagedVectorName.source
            : QdrantManagedVectorName.search
      if (
        !vector ||
        typeof vector !== 'object' ||
        Array.isArray(vector) ||
        !Array.isArray(Reflect.get(vector, name))
      )
        throw qdrantError(QdrantErrorCode.responseInvalid)
      const components = Reflect.get(vector, name) as readonly number[]
      try {
        return snapshotStorageVector(components, configuration, QdrantText.backend)
      } catch (error) {
        throw qdrantError(QdrantErrorCode.responseInvalid, error)
      }
    }
    const retrieve = async (
      name: string,
      ids: readonly string[],
      ctx: IOperationContext,
      configuration?: IStorageVectorConfiguration
    ) => {
      const physical = await Promise.all(ids.map((id) => nativeId([orgId, id]))),
        rows = await send(
          'retrieve',
          [
            name,
            {
              ids: physical,
              with_payload: true,
              with_vector: configuration
                ? [
                    configuration.metric === 'cosine'
                      ? QdrantManagedVectorName.source
                      : QdrantManagedVectorName.search
                  ]
                : false
            }
          ],
          ctx
        )
      if (!Array.isArray(rows)) throw qdrantError(QdrantErrorCode.responseInvalid)
      return Promise.all(rows.map(decode))
    }
    /** Public numeric deletion owns its original count strategy and never adds an expiry predicate. */
    const deleteWhere = async (
      physical: ICollectionState | string,
      condition: IQueryCondition,
      count: DeleteCountMode,
      ctx: IOperationContext
    ): Promise<number> => {
      const expression = nativeCondition(condition),
        predicate = compileStorageQueryCondition<ICodecValue | undefined>(condition)
      if (count === DeleteCountMode.precount && expression === undefined) unsupported()
      const name =
          typeof physical === 'string' ? physical : (await resolveCollection(physical, ctx)).name,
        filter = orgFilter(orgId, expression === undefined ? [] : [expression])
      if (count === DeleteCountMode.precount) {
        const counted = await send(QdrantRoute.count.name, [name, { filter, exact: true }], ctx)
        if (!Number.isSafeInteger(counted?.count) || counted.count < 0)
          throw qdrantError(QdrantErrorCode.responseInvalid)
        await send(QdrantRoute.delete.name, [name, { filter, wait: true }], ctx)
        return counted.count
      }
      const collected = new Set<string>()
      let offset: string | number | undefined
      do {
        const page = await send(
          'scroll',
          [name, { filter, limit: 256, offset, with_payload: true, with_vector: false }],
          ctx
        )
        if (!Array.isArray(page?.points)) throw qdrantError(QdrantErrorCode.responseInvalid)
        for (const point of page.points) {
          const row = await decode(point)
          if (predicate(row.payload)) {
            if (typeof point.id !== 'string') throw qdrantError(QdrantErrorCode.responseInvalid)
            collected.add(point.id)
          }
        }
        const next = page.next_page_offset
        if (next === offset && next != null) throw qdrantError(QdrantErrorCode.responseInvalid)
        if (
          next !== null &&
          next !== undefined &&
          typeof next !== 'string' &&
          typeof next !== 'number'
        )
          throw qdrantError(QdrantErrorCode.responseInvalid)
        offset = next ?? undefined
      } while (offset !== undefined)
      const ids = [...collected]
      let committed = 0
      for (let start = 0; start < ids.length; start += 256) {
        const batch = ids.slice(start, start + 256)
        await send(QdrantRoute.delete.name, [name, { points: batch, wait: true }], ctx)
        committed += batch.length
      }
      return committed
    }
    /**
     * The original query reader owns chain operations; this iterator performs one bounded native
     * rank.
     */
    const query = <TPayload>(
      state: ICollectionState,
      resolve: (
        name: string,
        configuration: IStorageVectorConfiguration,
        ctx: IOperationContext,
        now: number
      ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>,
      exact: boolean,
      metric?: IStorageVectorConfiguration['metric'],
      initialConditions: readonly IQueryCondition[] = [],
      origin?: IVectorQueryOrigin
    ) =>
      createVectorQuery<TPayload, true>(
        {
          exact,
          origin,
          beginOperation: () => controller.beginMutation(),
          groupBy: true,
          pushdown: {
            source: QdrantText.backend,
            operators: Object.values(QueryOperator),
            operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
            canPushCondition: (condition) => nativeCondition(condition) !== undefined
          },
          execute: (input: IVectorQueryInput) => {
            controller.assertLive()
            let rows:
                | readonly (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[]
                | undefined,
              index = 0,
              loading: Promise<typeof rows> | undefined
            let iterator!: IStorageIterator<readonly [IStorageKey, IVectorHit<TPayload, boolean>]>
            const lifetime = createStorageIteratorLifetime<
              readonly [IStorageKey, IVectorHit<TPayload, boolean>]
            >({
              close: async () => {
                rows = undefined
                loading = undefined
              },
              report,
              onSettled: () => {
                resources.release(iterator)
              }
            })
            const load = () =>
              run(QdrantText.search, input, input.ctx, false, async (next, context) => {
                const { name, configuration } = await resolveCollection(state, context)
                if (metric !== undefined && metric !== configuration.metric) unsupported()
                const now = Date.now(),
                  selected = await resolve(name, configuration, context, now)
                if (next.topK === 0) return []
                const conditions = [...initialConditions, ...next.conditions].map(nativeCondition)
                if (conditions.some((condition) => condition === undefined)) unsupported()
                const exclude = await Promise.all(
                    selected.exclude.map((id) => nativeId([orgId, id]))
                  ),
                  filter = orgFilter(orgId, conditions as IQdrantFilter[], now)
                if (exclude.length) filter.must_not = [{ has_id: exclude }]
                const direction = snapshotStorageVector(
                    selected.query,
                    configuration,
                    QdrantText.backend
                  ),
                  result = await send(
                    'query',
                    [
                      name,
                      {
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
                    ],
                    context
                  )
                if (!Array.isArray(result?.points))
                  throw qdrantError(QdrantErrorCode.responseInvalid)
                const hits: (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] = []
                for (const point of result.points) {
                  const row = await decode(point)
                  if (typeof point.score !== 'number' || !Number.isFinite(point.score))
                    throw qdrantError(QdrantErrorCode.responseInvalid)
                  hits.push([
                    row.id,
                    {
                      id: row.id,
                      score: configuration.metric === 'euclid' ? -point.score : point.score,
                      ...(row.payload === undefined ? {} : { payload: row.payload as TPayload }),
                      ...(next.withVector ? { vector: sample(point, configuration) } : {})
                    }
                  ])
                }
                return hits
              })
            iterator = {
              next: () => {
                controller.assertLive()
                if (lifetime.isClosing()) return Promise.resolve({ done: true, value: undefined })
                return lifetime.advance(async () => {
                  rows ??= await (loading ??= load())
                  const row = rows![index++]
                  return row === undefined
                    ? { done: true, value: undefined }
                    : { done: false, value: row }
                })
              },
              return: lifetime.returned,
              dispose: lifetime.dispose,
              [Symbol.asyncDispose]: lifetime.symbolic,
              [Symbol.asyncIterator]() {
                return this
              }
            }
            resources.own(iterator, { force: () => iterator.dispose() })
            return iterator
          }
        },
        core.getChainMethods('vector') as Record<never, never> | undefined
      )
    const vectorApi: IVectorApi<true> = {
      collection: <TPayload>(
        name: string,
        options?: IStorageVectorConfiguration
      ): IVectorCollection<TPayload, true> => {
        controller.assertLive()
        const captured = snapshotStorageVectorCollection(name, options, QdrantText.backend)
        let state = collections.get(name)
        if (state) {
          if (
            captured.options &&
            state.configuration &&
            (captured.options.metric !== state.configuration.metric ||
              captured.options.dimensions !== state.configuration.dimensions)
          )
            throw invalidArgument()
          state.configuration ??= captured.options
        } else {
          state = { name, configuration: captured.options }
          collections.set(name, state)
        }
        const current = state
        return {
          near: (input, options) =>
            capture(() => {
              controller.assertLive()
              const exact = options?.exact ?? false,
                metric = options?.metric
              if (typeof exact !== 'boolean') throw invalidArgument()
              if (
                metric !== undefined &&
                current.configuration &&
                metric !== current.configuration.metric
              )
                unsupported()
              const direction = snapshotStorageVector(
                input,
                current.configuration,
                QdrantText.backend
              )
              return query<TPayload>(
                current,
                async () => ({ query: direction, exclude: [] }),
                exact,
                metric,
                [],
                { kind: VectorQueryOriginKind.near, vector: direction }
              )
            }),
          similarTo: (id) => {
            assertStringStorageKey(id, QdrantText.backend)
            return query<TPayload>(
              current,
              async (name, configuration, ctx, now) => {
                const row = (await retrieve(name, [id], ctx, configuration))[0]
                if (!row || (row.expiresAt !== undefined && row.expiresAt <= now))
                  throw invalidArgument()
                return { query: sample(row.point, configuration), exclude: [id] }
              },
              false,
              undefined,
              [],
              { kind: VectorQueryOriginKind.similarTo, id }
            )
          },
          recommend: (examples) => {
            const captured = capture(() => {
              const { positive, negative } = examples,
                pos = idsOf(positive),
                neg = idsOf(negative ?? [])
              if (!pos.length || new Set([...pos, ...neg]).size !== pos.length + neg.length)
                throw invalidArgument()
              return { pos, neg }
            })
            return query<TPayload>(
              current,
              async (name, configuration, ctx, now) => {
                const rows = await retrieve(
                    name,
                    [...captured.pos, ...captured.neg],
                    ctx,
                    configuration
                  ),
                  byId = new Map(rows.map((row) => [row.id, row]))
                const load = (id: string) => {
                  const row = byId.get(id)
                  if (!row || (row.expiresAt !== undefined && row.expiresAt <= now))
                    throw invalidArgument()
                  return sample(row.point, configuration)
                }
                return {
                  query: recommendStorageVector(
                    captured.pos.map(load) as [readonly number[], ...(readonly number[])[]],
                    captured.neg.map(load)
                  ),
                  exclude: [...captured.pos, ...captured.neg]
                }
              },
              false,
              undefined,
              [],
              {
                kind: VectorQueryOriginKind.recommend,
                positive: captured.pos,
                negative: captured.neg
              }
            )
          },
          upsert: (points, ctx) => {
            const configuration = current.configuration
            const captured = snapshotStorageVectorUpsert(points, configuration, QdrantText.backend),
              options = capture(() => ({ ttlMs: ctx?.ttlMs, policy: ctx?.concurrency }))
            if (options.ttlMs !== undefined)
              assertStorageTtlDuration(options.ttlMs, QdrantText.backend)
            for (const point of captured)
              assertPointPayload(point.payload as ICodecValue | undefined)
            return run(
              QdrantText.upsert,
              captured,
              ctx,
              true,
              async (input, context) => {
                const prepared = snapshotStorageVectorUpsert(
                    input,
                    current.configuration,
                    QdrantText.backend
                  ),
                  facts = prepared.map((point) => ({
                    point,
                    payload: encodePointPayload(
                      orgId,
                      point.id,
                      point.payload as ICodecValue | undefined
                    )
                  }))
                const { name, configuration } = await resolveCollection(current, context),
                  now = Date.now(),
                  ids = await Promise.all(prepared.map((point) => nativeId([orgId, point.id]))),
                  previous =
                    options.ttlMs === undefined && ids.length
                      ? await retrieve(
                          name,
                          prepared.map((point) => point.id),
                          context
                        )
                      : [],
                  expiries = new Map(
                    previous
                      .filter((point) => point.expiresAt !== undefined && point.expiresAt > now)
                      .map((point) => [point.id, point.expiresAt!])
                  )
                for (const point of prepared)
                  snapshotStorageVector(point.vector, configuration, QdrantText.backend)
                const native = facts.map(({ point, payload: encoded }, index) => {
                  const expiry =
                    options.ttlMs === undefined ? expiries.get(point.id) : now + options.ttlMs
                  const payload = {
                    ...encoded,
                    ...(expiry === undefined
                      ? {}
                      : { [QdrantText.expiresAt]: new Date(expiry).toISOString() })
                  }
                  return {
                    id: ids[index]!,
                    vector: {
                      [QdrantManagedVectorName.search]: [...point.vector],
                      ...(configuration.metric === 'cosine'
                        ? { [QdrantManagedVectorName.source]: [...point.vector] }
                        : {})
                    },
                    payload
                  }
                })
                if (native.length)
                  await send(
                    QdrantRoute.upsert.name,
                    [name, { points: native, wait: true }],
                    context
                  )
              },
              options.policy
            )
          },
          delete: (ids, ctx) => {
            const captured = idsOf(ids),
              policy = capture(() => ctx?.concurrency)
            return run(
              QdrantText.delete,
              captured,
              ctx,
              true,
              async (input, context) => {
                const { name } = await resolveCollection(current, context),
                  physical = await Promise.all(input.map((id) => nativeId([orgId, id])))
                if (physical.length)
                  await send(
                    'delete',
                    [
                      name,
                      { filter: orgFilter(orgId, [{ must: [{ has_id: physical }] }]), wait: true }
                    ],
                    context
                  )
              },
              policy
            )
          },
          deleteWhere: (where, ctx) => {
            const condition = snapshotStorageWhere(where),
              options = capture(() => ({
                count: snapshotStorageDeleteCountMode(ctx?.count ?? undefined, QdrantText.backend),
                policy: ctx?.concurrency
              }))
            if (
              options.count === DeleteCountMode.precount &&
              nativeCondition(condition) === undefined
            )
              unsupported()
            return run(
              QdrantText.deleteWhere,
              condition,
              ctx,
              true,
              (input, context) => deleteWhere(current, input, options.count, context),
              options.policy
            )
          },
          search: async (input, options, ctx) => {
            const configuration = current.configuration
            const captured = snapshotStorageVectorSearch(
              input,
              options,
              configuration,
              QdrantText.backend
            )
            if (captured.options.k === 0)
              return run(QdrantText.search, captured, ctx, false, async (input, context) => {
                const { configuration } = await resolveCollection(current, context)
                snapshotStorageVector(input.query, configuration, QdrantText.backend)
                return []
              })
            // Public search delegates to the exact same immutable query source and terminal owner.
            const chain = query<TPayload>(
              current,
              async () => ({ query: captured.query, exclude: [] }),
              captured.options.exact,
              undefined,
              captured.options.filter ? [vectorCondition(captured.options.filter)] : []
            )
            const hits = await chain.topK(captured.options.k).all(ctx)
            return hits.map((hit) => ({
              id: hit.id,
              score: hit.score,
              ...(captured.options.withPayload && hit.payload !== undefined
                ? { payload: hit.payload }
                : {})
            }))
          }
        }
      }
    }
    /** TTL addresses the same canonical point and never creates a per-point scheduler. */
    const ttlOperation = (
      target: Parameters<ITtlApi['remaining']>[0],
      ctx: IOperationContext | undefined,
      mode: 'expire' | 'persist' | 'remaining',
      ms?: number
    ) => {
      const captured = snapshotStorageTtlTarget(target, QdrantText.backend)
      if (captured.channel !== 'vector') unsupported()
      if (ms !== undefined) assertStorageTtlDuration(ms, QdrantText.backend)
      const policy = capture(() => Reflect.get(ctx ?? {}, 'concurrency'))
      return run(
        QdrantText.ttl + mode,
        captured,
        ctx,
        mode !== 'remaining',
        async (input, context) => {
          if (input.channel !== 'vector') unsupported()
          const state = collections.get(input.collection) ?? { name: input.collection },
            resolved = await resolveCollection(state, context),
            now = Date.now(),
            row = (await retrieve(resolved.name, [input.id], context))[0]
          if (!row || (row.expiresAt !== undefined && row.expiresAt <= now))
            return mode === 'remaining' ? undefined : false
          if (mode === 'remaining')
            return row.expiresAt === undefined ? undefined : Math.max(0, row.expiresAt - now)
          const id = await nativeId([orgId, input.id])
          if (mode === 'expire')
            await send(
              'setPayload',
              [
                resolved.name,
                {
                  points: [id],
                  payload: { [QdrantText.expiresAt]: new Date(now + ms!).toISOString() },
                  wait: true
                }
              ],
              context
            )
          else
            await send(
              'deletePayload',
              [
                resolved.name,
                { points: [id], keys: [JSON.stringify(QdrantText.expiresAt)], wait: true }
              ],
              context
            )
          return true
        },
        policy
      )
    }
    const ttlApi: ITtlApi = {
      expire: (target, ms, ctx) => ttlOperation(target, ctx, 'expire', ms) as Promise<boolean>,
      remaining: (target, ctx) =>
        ttlOperation(target, ctx, 'remaining') as Promise<number | undefined>,
      persist: (target, ctx) => ttlOperation(target, ctx, 'persist') as Promise<boolean>
    }
    Object.defineProperty(base, nativeFeaturePort, {
      value: {
        run: <K extends IQdrantOperationName>(
          operation: K,
          args: readonly unknown[],
          ctx: IOperationContext | undefined,
          write: boolean,
          validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
        ) => {
          if (orgId !== core.defaultOrgId) unsupported()
          return run<readonly unknown[], Awaited<ReturnType<IQdrantHttp[K]>>>(
            operation,
            args,
            ctx,
            write,
            async (input, context): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
              if (validate)
                validate(await send(QdrantRoute.getCollection.name, [input[0]], context))
              return await send(operation, input, context)
            }
          )
        },
        managedDelete: <TPayload>(
          collection: string,
          where: IWhere<TPayload> | undefined,
          options: { wait?: boolean; ordering?: 'weak' | 'medium' | 'strong' } | undefined,
          ctx: IOperationContext | undefined,
          purge: boolean
        ) => {
          const condition = where === undefined ? undefined : snapshotStorageWhere(where),
            expression = condition === undefined ? undefined : nativeCondition(condition)
          if (condition !== undefined && expression === undefined) unsupported()
          const captured = capture(() => ({
            wait: options?.wait ?? true,
            ordering: options?.ordering,
            policy: Reflect.get(ctx ?? {}, 'concurrency')
          }))
          if (
            typeof captured.wait !== 'boolean' ||
            (captured.ordering !== undefined &&
              !['weak', 'medium', 'strong'].includes(captured.ordering))
          )
            throw invalidArgument()
          const state = collections.get(collection) ?? { name: collection }
          return run(
            purge ? QdrantText.purgeExpired : QdrantText.deleteByFilter,
            undefined,
            ctx,
            true,
            async (_input, context) => {
              const { name } = await resolveCollection(state, context),
                filter = orgFilter(
                  orgId,
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
      } satisfies IQdrantNativeFeaturePort
    })
    store = provideCapabilities(
      base,
      [implement(vector, vectorApi), implement(ttl, ttlApi)] as const,
      {
        onInstaller: (port) => {
          installer = port
        }
      }
    )
    createTransactionOwner(base, (error) => normalizeQdrantError(error) as never, {
      concurrencyStages: ports.stageBindings.concurrencyStages(store)
    })
    const drop = () =>
      run(QdrantText.dropOrg, undefined, undefined, true, async (_input, context) => {
        const prefix = await namespace,
          result = await send(QdrantRoute.getCollections.name, [], context)
        if (!Array.isArray(result?.collections)) throw qdrantError(QdrantErrorCode.responseInvalid)
        for (const collection of result.collections) {
          if (typeof collection.name !== 'string')
            throw qdrantError(QdrantErrorCode.responseInvalid)
          if (collection.name.startsWith(prefix))
            await deleteWhere(
              collection.name,
              snapshotStorageWhere({}),
              DeleteCountMode.precount,
              context
            )
        }
      })
    const result = { store, installer, drop }
    stores.set(orgId, result)
    return result
  }
  const root = forOrg(core.defaultOrgId)
  return {
    ...root,
    controller,
    orgBinding: {
      backend: (orgId: string) => forOrg(orgId).store,
      drop: (orgId: string) => forOrg(orgId).drop()
    },
    detect: async (signal: import('@migaia/utils/promise').INativeAbortSignal) => {
      controller.assertLive()
      for (const operation of QdrantRequiredOperations)
        if (typeof http[operation] !== 'function') unsupported()
      if (typeof http.getVersion !== 'function') unsupported()
      const version = await http.getVersion({ signal }),
        parts = version.split('.').map(Number)
      if (parts[0] !== 1 || !Number.isInteger(parts[1]) || parts[1]! < 11) unsupported()
      detected = true
    }
  }
}
