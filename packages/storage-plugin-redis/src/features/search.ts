import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  vector,
  implement,
  createVectorQuery,
  createStorageIteratorLifetime,
  snapshotStorageVector,
  snapshotStorageVectorCollection,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorIds,
  snapshotStorageVectorSearch,
  snapshotStorageWhere,
  snapshotStorageDeleteCountMode,
  snapshotOperationContext,
  assertStorageTtlDuration,
  QueryOperator,
  QueryOperation,
  type ICapabilityImpl,
  type IVectorApi,
  type IVectorCollection,
  type IStorageVectorConfiguration,
  type IStorageVectorPoint,
  type IQueryCondition,
  type IStorageIterator,
  type IStorageKey,
  type IVectorHit,
  type IVectorFilter,
  type ILockKey
} from '@migaia/storage-contract'
import { asyncDisposeKey, throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { recommendStorageVector } from '@migaia/storage-host/authoring/vector'
import { parseObjectPath } from '@migaia/utils/object'
import type { ICodecValue } from '@migaia/serialize/codec'
import { redisBackendKind } from '../plugin.js'
import {
  readNativeFeaturePort,
  type IRedisNativeFeaturePort,
  type IRedisVectorBinding
} from '../native-feature.js'
import { RedisCommand, RedisText, RedisOperation } from '../constants.js'
import {
  RedisVector,
  vectorNames,
  vectorText,
  vectorBytes,
  vectorValues,
  vectorProjection,
  vectorString,
  vectorSample,
  payloadBytes,
  vectorPoint,
  resolveVectorSchema,
  registerVectorFields,
  vectorCondition,
  vectorSend,
  vectorRows,
  vectorExpiry
} from '../vector-protocol.js'
import { readRedisHash, type RedisDraft } from '../transaction.js'
import { replyInteger, replyRevision } from '../layout.js'
import { invalidArgument, unsupported, redisError } from '../errors.js'
import { RedisErrorCode } from '../error-code.js'
import type { IRedisStore } from '../types.js'
import type { IRedisConnection } from '../driver.js'
/**
 * Only this selected Feature installs standard vector methods; no native duplicate query API
 * exists.
 */
export type IRedisVectorFeatureOutput = IStorageFeatureOutput<
  readonly [ICapabilityImpl<typeof vector, IVectorApi<false, true>>],
  {},
  { readonly store: {}; readonly transaction: {} }
>
/** Detect the actual module and genuine binary connection before admitting selected vector work. */
export function rediSearchVectorFeature() {
  return defineFeature<typeof redisBackendKind, {}, IRedisVectorFeatureOutput>(
    redisBackendKind,
    (core) => {
      const binding = createRedisVectorBinding(() =>
        readNativeFeaturePort(core.featureExpose.getStore())
      )
      const create = (store: IRedisStore) =>
        store === core.featureExpose.getStore()
          ? binding
          : createRedisVectorBinding(() => readNativeFeaturePort(store))
      core.featureExpose.registerDetect(async () => {
        const port = readNativeFeaturePort(core.featureExpose.getStore())
        try {
          await port.driver.withConnection(async (connection) => {
            if (
              typeof connection.binaryCommand !== 'function' ||
              typeof connection.exec !== 'function'
            )
              unsupported()
            const result = await connection.command([RedisVector.list])
            if (!Array.isArray(result)) unsupported()
          })
        } catch (cause) {
          unsupported(cause)
        }
        port.enableVector(create)
      })
      return {
        capabilities: [implement(vector, binding.api)] as const,
        chain: {},
        api: { store: {}, transaction: {} }
      }
    }
  )
}
/** Native legacy filter syntax is projected into the one canonical condition AST before translation. */
function filterCondition(filter: IVectorFilter): IQueryCondition {
  if ('all' in filter) return { kind: 'and', conditions: filter.all.map(filterCondition) }
  if ('any' in filter) return { kind: 'or', conditions: filter.any.map(filterCondition) }
  if ('not' in filter) return { kind: 'not', condition: filterCondition(filter.not) }
  const path = parseObjectPath(filter.field).map(String)
  if ('eq' in filter) return { kind: 'field', path, operator: QueryOperator.eq, value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: QueryOperator.in, value: filter.in }
  return {
    kind: 'and',
    conditions: [
      ...(filter.gte === undefined
        ? []
        : [{ kind: 'field', path, operator: QueryOperator.gte, value: filter.gte } as const]),
      ...(filter.lte === undefined
        ? []
        : [{ kind: 'field', path, operator: QueryOperator.lte, value: filter.lte } as const])
    ]
  }
}
/** Same canonical vector key authorizes both explicit locks and implicit native HASH writes. */
function lock(collection: string, id: string): Extract<ILockKey, { channel: 'vector' }> {
  return { channel: 'vector', collection, id }
}
/** One exact native configuration is retained only as caller data; FT.INFO owns persistent schema. */
type ICollection = { readonly name: string; configuration: IStorageVectorConfiguration | undefined }
/**
 * Each original organization projection closes over its own original ports and physical key
 * mapping.
 */
function createRedisVectorBinding(resolve: () => IRedisNativeFeaturePort): IRedisVectorBinding {
  const collections = new Map<string, ICollection>()
  const hash = async (draft: RedisDraft, collection: string, id: string) =>
    draft.hash(vectorNames(draft.layout, collection).point(id), lock(collection, id))
  /** Native expiry and its index projection are changed only through the same original Redis draft. */
  const expire: IRedisVectorBinding['expire'] = async (draft, target, ms) => {
    await draft.guardVector(target)
    const point = await hash(draft, target.collection, target.id)
    if (!point.fields.size || (ms === undefined && point.deadline === 0)) return false
    point.deadline = ms === undefined ? 0 : (await draft.now()) + Math.ceil(ms)
    if (ms === 0) point.fields = new Map()
    else point.fields = vectorExpiry(point.fields, point.deadline)
    point.changed = true
    return true
  }
  /** Exact physical HASH TTL remains authoritative even when projection fields are malformed. */
  const remaining: IRedisVectorBinding['remaining'] = async (draft, target) => {
    const point = await hash(draft, target.collection, target.id)
    return !point.fields.size || point.deadline === 0
      ? undefined
      : Math.max(0, point.deadline - (await draft.now()))
  }
  /** All query chains use the shared reader; this source performs one bounded native FT ranking. */
  const query = <TPayload>(
    state: ICollection,
    direction: (
      connection: IRedisConnection,
      configuration: IStorageVectorConfiguration
    ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>,
    exact: boolean,
    metric?: IStorageVectorConfiguration['metric'],
    initial: readonly IQueryCondition[] = []
  ) => {
    const port = resolve()
    return createVectorQuery<TPayload, false>(
      {
        asyncDisposeKey,
        exact,
        pushdown: {
          source: RedisText.backend,
          operators: Object.values(QueryOperator),
          operations: [QueryOperation.where, QueryOperation.topK],
          canPushCondition: (condition) => vectorCondition(condition) !== undefined
        },
        watch: ({ ctx }) => port.watch(ctx),
        execute(input) {
          port.assertLive()
          let rows: readonly (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] | undefined,
            index = 0,
            loading: Promise<typeof rows> | undefined,
            release: (() => void) | undefined
          const lifetime = createStorageIteratorLifetime<
            readonly [IStorageKey, IVectorHit<TPayload, boolean>]
          >({
            close: async () => {
              rows = undefined
              loading = undefined
            },
            report: port.report,
            onSettled: () => release?.()
          })
          const iterator: IStorageIterator<readonly [IStorageKey, IVectorHit<TPayload, boolean>]> =
            {
              next: () => {
                port.assertLive()
                if (lifetime.isClosing()) return Promise.resolve({ done: true, value: undefined })
                return lifetime.advance(async () => {
                  rows ??= await (loading ??= port.run(
                    RedisOperation.vectorSearch,
                    input,
                    input.ctx,
                    false,
                    async (actual, connection, layout, signal) => {
                      const schema = await resolveVectorSchema(
                        connection,
                        layout,
                        state.name,
                        state.configuration
                      )
                      state.configuration = schema.configuration
                      if (metric !== undefined && metric !== schema.configuration.metric)
                        unsupported()
                      const selected = await direction(connection, schema.configuration)
                      const components = snapshotStorageVector(
                          selected.query,
                          schema.configuration,
                          RedisText.backend
                        ),
                        bytes = vectorBytes(components)
                      snapshotStorageVector(
                        vectorValues(bytes, schema.configuration.dimensions),
                        schema.configuration,
                        RedisText.backend
                      )
                      if (!actual.topK) return []
                      const conditions = [...initial, ...actual.conditions].map((condition) =>
                        vectorCondition(condition, schema.fields)
                      )
                      if (conditions.some((condition) => condition === undefined)) unsupported()
                      const time = await connection.command([RedisCommand.time])
                      if (!Array.isArray(time) || time.length !== 2)
                        throw redisError(RedisErrorCode.decodeFailed, time)
                      const now =
                        replyRevision(time[0]) * 1000 + Math.floor(replyRevision(time[1]) / 1000)
                      if (!Number.isSafeInteger(now) || replyRevision(time[1]) > 999999)
                        throw redisError(RedisErrorCode.decodeFailed, time)
                      // Exclusions are exact managed native document keys, avoiding assumptions about user ID syntax.
                      const names = vectorNames(layout, state.name),
                        excluded = new Set(selected.exclude.map(names.point))
                      const filter = [
                        '@' + RedisVector.org + ':{' + layout.orgId.replaceAll('-', '\\-') + '}',
                        '(@' +
                          RedisVector.expiry +
                          ':[0 0] | @' +
                          RedisVector.expiry +
                          ':[(' +
                          now +
                          ' +inf])',
                        ...conditions
                      ].join(' ')
                      // Fixed-size native sample TAGs exclude complete IDs before ranking.
                      const sampleTags = await Promise.all(selected.exclude.map(vectorSample)),
                        withoutSamples = selected.exclude.length
                          ? filter + ' -@' + RedisVector.sample + ':{' + sampleTags.join('|') + '}'
                          : filter
                      const field = exact ? RedisVector.exact : RedisVector.approximate,
                        expression =
                          '(' +
                          withoutSamples +
                          ')=>[KNN ' +
                          actual.topK +
                          ' @' +
                          field +
                          ' $query AS ' +
                          RedisVector.score +
                          ']',
                        result = await vectorSend(connection, [
                          RedisVector.search,
                          names.index,
                          expression,
                          RedisVector.params,
                          '2',
                          RedisVector.query,
                          bytes,
                          RedisVector.sortby,
                          RedisVector.score,
                          RedisVector.asc,
                          RedisCommand.limit,
                          '0',
                          String(actual.topK),
                          RedisVector.return,
                          actual.withVector ? '5' : '4',
                          RedisVector.id,
                          RedisVector.collection,
                          RedisVector.payload,
                          RedisVector.score,
                          ...(actual.withVector ? [field] : []),
                          RedisVector.dialect,
                          '2'
                        ])
                      throwIfAborted(signal)
                      const hits: (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] = []
                      for (const row of vectorRows(result)) {
                        if (excluded.has(row.key)) continue
                        const point = vectorPoint(row.fields, state.name, row.key, names),
                          distance = Number(vectorText(row.fields.get(RedisVector.score)))
                        if (!Number.isFinite(distance))
                          throw redisError(RedisErrorCode.decodeFailed, row)
                        const score =
                          schema.configuration.metric === 'euclid'
                            ? -Math.sqrt(Math.max(0, distance))
                            : 1 - distance
                        if (actual.minScore !== undefined && score < actual.minScore) continue
                        hits.push([
                          point.id,
                          {
                            id: point.id,
                            score,
                            ...(point.payload === undefined
                              ? {}
                              : { payload: point.payload as TPayload }),
                            ...(actual.withVector
                              ? {
                                  vector: vectorValues(
                                    row.fields.get(field),
                                    schema.configuration.dimensions
                                  )
                                }
                              : {})
                          }
                        ])
                      }
                      return hits.sort(
                        (left, right) =>
                          right[1].score - left[1].score ||
                          (left[1].id < right[1].id ? -1 : left[1].id > right[1].id ? 1 : 0)
                      )
                    }
                  ))
                  const row = rows![index++]
                  return row === undefined
                    ? { done: true, value: undefined }
                    : { done: false, value: row }
                })
              },
              return: lifetime.returned,
              dispose: lifetime.dispose,
              [asyncDisposeKey]: lifetime.symbolic,
              [Symbol.asyncIterator]() {
                return this
              }
            }
          release = port.own(iterator)
          return iterator
        }
      },
      port.chain()
    )
  }
  /**
   * Sample vectors are loaded by exact managed HASH key only, without scanning collection
   * candidates.
   */
  const samples = async (
    connection: IRedisConnection,
    state: ICollection,
    configuration: IStorageVectorConfiguration,
    ids: readonly string[]
  ) => {
    const port = resolve(),
      names = vectorNames(port.layout, state.name)
    const result: (readonly number[])[] = []
    for (const id of ids) {
      const fields = readRedisHash(
        await vectorSend(connection, [RedisCommand.hgetall, names.point(id)])
      )
      if (!fields.size) throw invalidArgument()
      vectorPoint(fields, state.name, names.point(id), names)
      result.push(vectorValues(fields.get(RedisVector.approximate), configuration.dimensions))
    }
    return result
  }
  const api: IVectorApi<false, true> = {
    collection<TPayload>(
      name: string,
      options?: IStorageVectorConfiguration
    ): IVectorCollection<TPayload, false, true> {
      const port = resolve()
      port.assertLive()
      const captured = snapshotStorageVectorCollection(name, options, RedisText.backend)
      let state = collections.get(captured.name)
      if (!state) {
        state = { name: captured.name, configuration: captured.options }
        collections.set(captured.name, state)
      } else if (captured.options) {
        if (
          state.configuration &&
          (captured.options.metric !== state.configuration.metric ||
            captured.options.dimensions !== state.configuration.dimensions)
        )
          throw invalidArgument()
        state.configuration ??= captured.options
      }
      const current = state
      const remove = (
        ids: readonly string[],
        ctx?: Parameters<IVectorCollection<unknown>['delete']>[1]
      ) => {
        const captured = snapshotStorageVectorIds(ids, RedisText.backend)
        return port.mutate(
          RedisOperation.vectorDelete,
          captured,
          ctx,
          (actual) => snapshotStorageVectorIds(actual, RedisText.backend),
          (actual) => actual.map((id) => lock(name, id)),
          async (draft, actual) => {
            for (const id of actual) {
              await draft.guardVector(lock(name, id))
              const point = await hash(draft, name, id)
              if (point.fields.size) {
                point.fields = new Map()
                point.changed = true
              }
            }
          },
          ctx?.concurrency
        )
      }
      return {
        near(input, options) {
          const { exact = false, metric } = options ?? {}
          if (typeof exact !== 'boolean') throw invalidArgument()
          if (metric !== undefined && !['cosine', 'dot', 'euclid'].includes(metric))
            throw invalidArgument()
          if (
            metric !== undefined &&
            current.configuration &&
            metric !== current.configuration.metric
          )
            unsupported()
          const direction = snapshotStorageVector(input, current.configuration, RedisText.backend)
          return query<TPayload>(
            current,
            async () => ({ query: direction, exclude: [] }),
            exact,
            metric
          )
        },
        similarTo(id) {
          const captured = snapshotStorageVectorIds([id], RedisText.backend)[0]!
          return query<TPayload>(
            current,
            async (connection, configuration) => ({
              query: (await samples(connection, current, configuration, [captured]))[0]!,
              exclude: [captured]
            }),
            false
          )
        },
        recommend(examples) {
          const { positive, negative } = examples,
            pos = snapshotStorageVectorIds(positive, RedisText.backend),
            neg = snapshotStorageVectorIds(negative ?? [], RedisText.backend)
          if (!pos.length || new Set([...pos, ...neg]).size !== pos.length + neg.length)
            throw invalidArgument()
          return query<TPayload>(
            current,
            async (connection, configuration) => {
              const values = await samples(connection, current, configuration, [...pos, ...neg])
              return {
                query: recommendStorageVector(
                  values.slice(0, pos.length) as [readonly number[], ...(readonly number[])[]],
                  values.slice(pos.length)
                ),
                exclude: [...pos, ...neg]
              }
            },
            false
          )
        },
        upsert(points, ctx) {
          const ttlMs = ctx?.ttlMs,
            policy = ctx?.concurrency
          if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, RedisText.backend)
          const capture = (input: readonly IStorageVectorPoint<TPayload>[]) =>
            snapshotStorageVectorUpsert(input, current.configuration, RedisText.backend).map(
              (point) => ({
                point,
                bytes: vectorBytes(point.vector),
                projection: vectorProjection(point.payload as ICodecValue | undefined),
                payload: point.payload === undefined ? undefined : payloadBytes(point.payload)
              })
            )
          const initial = snapshotStorageVectorUpsert(
            points,
            current.configuration,
            RedisText.backend
          )
          return port.mutate(
            RedisOperation.vectorUpsert,
            initial,
            ctx,
            capture,
            (actual) => actual.map(({ point }) => lock(name, point.id)),
            async (draft, actual) => {
              if (!actual.length) return
              const sampleTags = await Promise.all(
                actual.map(({ point }) => vectorSample(point.id))
              )
              const schema = await resolveVectorSchema(
                draft.connection,
                draft.layout,
                name,
                current.configuration
              )
              current.configuration = schema.configuration
              const names = vectorNames(draft.layout, name)
              /** One local batch union avoids repeated DDL for a newly observed scalar path. */
              const projections = new Map(actual.flatMap((item) => [...item.projection]))
              for (const item of actual)
                snapshotStorageVector(
                  vectorValues(item.bytes, schema.configuration.dimensions),
                  schema.configuration,
                  RedisText.backend
                )
              await registerVectorFields(draft.connection, names.index, schema, projections)
              for (const [index, { point, bytes, projection, payload }] of actual.entries()) {
                await draft.guardVector(lock(name, point.id))
                const entry = await hash(draft, name, point.id)
                if (ttlMs !== undefined) entry.deadline = (await draft.now()) + Math.ceil(ttlMs)
                const fields = new Map(projection)
                fields.set(RedisVector.org, vectorString(draft.layout.orgId))
                fields.set(RedisVector.id, payloadBytes(point.id))
                fields.set(RedisVector.collection, payloadBytes(name))
                fields.set(RedisVector.sample, vectorString(sampleTags[index]!))
                fields.set(RedisVector.approximate, bytes)
                fields.set(RedisVector.exact, bytes)
                if (payload !== undefined) fields.set(RedisVector.payload, payload)
                entry.fields = ttlMs === 0 ? new Map() : vectorExpiry(fields, entry.deadline)
                entry.changed = true
              }
            },
            policy
          )
        },
        delete: remove,
        deleteWhere(where, ctx) {
          if (typeof where === 'function') unsupported()
          const condition = snapshotStorageWhere(where),
            mode = snapshotStorageDeleteCountMode(ctx?.count, RedisText.backend)
          if (vectorCondition(condition) === undefined) unsupported()
          void mode
          return port.mutate(
            RedisOperation.vectorDeleteWhere,
            condition,
            ctx,
            (actual) => actual,
            () => [],
            async (draft, actual) => {
              const schema = await resolveVectorSchema(
                  draft.connection,
                  draft.layout,
                  name,
                  current.configuration
                ),
                names = vectorNames(draft.layout, name),
                translated = vectorCondition(actual, schema.fields)
              const ids = new Map<string, string>()
              for (let offset = 0; ; offset += 256) {
                const rows = vectorRows(
                  await vectorSend(draft.connection, [
                    RedisVector.search,
                    names.index,
                    '(@' +
                      RedisVector.org +
                      ':{' +
                      draft.layout.orgId.replaceAll('-', '\\-') +
                      '} ' +
                      translated +
                      ')',
                    RedisCommand.limit,
                    String(offset),
                    '256',
                    RedisVector.return,
                    '2',
                    RedisVector.id,
                    RedisVector.collection,
                    RedisVector.dialect,
                    '2'
                  ])
                )
                for (const row of rows) {
                  const point = vectorPoint(row.fields, name, row.key, names)
                  ids.set(row.key, point.id)
                }
                if (rows.length < 256) break
              }
              let count = 0
              for (const [physical, id] of ids) {
                await draft.guardVector(lock(name, id))
                const point = await draft.hash(physical, lock(name, id))
                if (point.fields.size) {
                  point.fields = new Map()
                  point.changed = true
                  count++
                }
              }
              return count
            },
            ctx?.concurrency
          )
        },
        async search(input, options, ctx) {
          const captured = snapshotStorageVectorSearch(
              input,
              options,
              current.configuration,
              RedisText.backend
            ),
            conditions = captured.options.filter ? [filterCondition(captured.options.filter)] : []
          if (conditions.some((condition) => vectorCondition(condition) === undefined))
            unsupported()
          const chain = query<TPayload>(
            current,
            async () => ({ query: captured.query, exclude: [] }),
            captured.options.exact,
            undefined,
            conditions
          )
          if (captured.options.k === 0) {
            port.assertLive()
            snapshotOperationContext(ctx)
            return []
          }
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
  return {
    api,
    expire,
    remaining,
    remainingRoot: (target, ctx) =>
      resolve().run(
        RedisOperation.remaining,
        target,
        ctx,
        false,
        async (actual, connection, layout) => {
          const value = replyInteger(
            await connection.command([
              RedisCommand.pttl,
              vectorNames(layout, actual.collection).point(actual.id)
            ])
          )
          return value < 0 ? undefined : value
        }
      )
  }
}
