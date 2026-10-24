import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  vector,
  implement,
  createVectorQuery,
  createStorageIteratorLifetime,
  snapshotStorageVector,
  assertStorageVector,
  assertOperationContext,
  snapshotStorageVectorCollection,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorIds,
  assertStorageVectorIds,
  snapshotStorageVectorSearch,
  snapshotStorageWhere,
  snapshotStorageDeleteCountMode,
  assertStorageTtlDuration,
  QueryOperator,
  QueryOperation,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  type ICapabilityImpl,
  type IVectorApi,
  type IVectorCollection,
  type IStorageVectorConfiguration,
  type IStorageVectorPoint,
  type IQueryCondition,
  type IStorageIterator,
  type IStorageKey,
  type IVectorHit,
  type IVectorQueryInput,
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
type IRedisVectorCollectionState = {
  readonly name: string
  configuration: IStorageVectorConfiguration | undefined
}
/**
 * One selected organization owns collection configuration facts, while FT.INFO owns persistent
 * schema.
 */
type IRedisVectorBindingContext = {
  /** Resolve only this original organization's native port at each public terminal. */
  resolve: () => IRedisNativeFeaturePort
  /** This is the original per-binding map, never a second schema cache. */
  collections: Map<string, IRedisVectorCollectionState>
}
/**
 * One collection view passes fixed native identity and its existing shared configuration
 * explicitly.
 */
type IRedisVectorCollectionContext = {
  /** Original selected vector provider owns collection lookup and org native ports. */
  binding: IRedisVectorBindingContext
  /** Borrowed native execution and mutation ports retain their canonical owner. */
  port: IRedisNativeFeaturePort
  /** Collection name remains the admitted public string. */
  name: string
  /** Only FT.INFO and admitted caller config update the original shared collection fact. */
  current: IRedisVectorCollectionState
}
/** Execute hash using original vector configuration, native connection and explicit provider state. */
async function redisVectorHash(draft: RedisDraft, collection: string, id: string) {
  return draft.hash(vectorNames(draft.layout, collection).point(id), lock(collection, id))
}
/**
 * Execute expire using original vector configuration, native connection and explicit provider
 * state.
 */
async function redisVectorExpire(
  draft: RedisDraft,
  target: Parameters<IRedisVectorBinding['expire']>[1],
  ms?: number
) {
  await draft.guardVector(target)
  const point = await redisVectorHash(draft, target.collection, target.id)
  if (!point.fields.size || (ms === undefined && point.deadline === 0)) return false
  const deadline = ms === undefined ? 0 : (await draft.now()) + Math.ceil(ms)
  draft.changeHash(point, ms === 0 ? new Map() : vectorExpiry(point.fields, deadline), deadline)
  return true
}
/**
 * Execute remaining using original vector configuration, native connection and explicit provider
 * state.
 */
async function redisVectorRemaining(
  draft: RedisDraft,
  target: Parameters<IRedisVectorBinding['remaining']>[1]
) {
  const point = await redisVectorHash(draft, target.collection, target.id)
  return !point.fields.size || point.deadline === 0
    ? undefined
    : Math.max(0, point.deadline - (await draft.now()))
}
/** One native query source retains admitted direction and fixed collection/org ports explicitly. */
type IRedisVectorQueryContext = {
  /** FT.INFO updates only the original shared collection configuration. */
  state: IRedisVectorCollectionState
  /** Direction comes from captured caller input or exact native samples. */
  direction: (
    connection: IRedisConnection,
    configuration: IStorageVectorConfiguration
  ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>
  /** Native port owns admission, cancellation and resource drain. */
  port: IRedisNativeFeaturePort
  /** Exact selects the existing FLAT field rather than a second query engine. */
  exact: boolean
  /** A supplied metric must match the original native schema. */
  metric: IStorageVectorConfiguration['metric'] | undefined
  /** Legacy filter conditions share the same canonical query AST. */
  initial: readonly IQueryCondition[]
}
/** One native ranked result retains position while the canonical iterator lifetime drains advances. */
class RedisVectorCursor<TPayload> implements IStorageIterator<
  readonly [IStorageKey, IVectorHit<TPayload, boolean>]
> {
  /** Fixed native query facts belong to this cursor's original source. */
  readonly #query: IRedisVectorQueryContext
  /** The canonical query owner supplies this execution's admitted input. */
  readonly #input: IVectorQueryInput
  /** Only the actual native result is retained until close. */
  #rows: readonly (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] | undefined
  /** Native ranked rows advance once in the existing result order. */
  #index = 0
  /** All accepted advances share the same one native loading Promise. */
  #loading: Promise<readonly (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[]> | undefined
  /** The original native resource owner removes this cursor after cleanup settles. */
  #release: (() => void) | undefined
  /** Existing lifetime owns queued advances and both cached cleanup Promises. */
  readonly #lifetime: ReturnType<
    typeof createStorageIteratorLifetime<readonly [IStorageKey, IVectorHit<TPayload, boolean>]>
  >
  /** Allocate no native work before the first admitted advance. */
  constructor(query: IRedisVectorQueryContext, input: IVectorQueryInput) {
    query.port.assertLive()
    this.#query = query
    this.#input = input
    this.#lifetime = createStorageIteratorLifetime({
      close: async () => {
        this.#rows = undefined
        this.#loading = undefined
      },
      report: query.port.report,
      onSettled: () => this.#release?.()
    })
    this.#release = query.port.own(this)
  }
  /** Preserve the original one native load and row position inside canonical advance admission. */
  readonly next = () => {
    this.#query.port.assertLive()
    if (this.#lifetime.isClosing())
      return Promise.resolve({ done: true as const, value: undefined })
    return this.#lifetime.advance(async () => {
      this.#rows ??= await (this.#loading ??= this.#query.port.run(
        RedisOperation.vectorSearch,
        this.#input,
        this.#input.ctx,
        false,
        (actual, connection, layout, signal) =>
          redisSearchVector<TPayload>(this.#query, actual, connection, layout, signal)
      ))
      const row = this.#rows[this.#index++]
      return row === undefined ? { done: true, value: undefined } : { done: false, value: row }
    })
  }
  /** Return the canonical cached return Promise without another lifecycle. */
  readonly return = () => this.#lifetime.returned()
  /** Explicit cleanup retains the original cached settlement. */
  readonly dispose = () => this.#lifetime.dispose()
  /** Symbolic cleanup retains the original report-only Promise. */
  readonly [asyncDisposeKey] = () => this.#lifetime.symbolic();
  /** The native cursor is its own async iterator. */
  [Symbol.asyncIterator]() {
    return this
  }
}
/** Translate and execute one bounded native FT ranking against explicit source facts. */
async function redisSearchVector<TPayload>(
  query: IRedisVectorQueryContext,
  actual: IVectorQueryInput,
  connection: IRedisConnection,
  layout: IRedisNativeFeaturePort['layout'],
  signal: AbortSignal | undefined
): Promise<readonly (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[]> {
  const schema = await resolveVectorSchema(
    connection,
    layout,
    query.state.name,
    query.state.configuration
  )
  query.state.configuration = schema.configuration
  if (query.metric !== undefined && query.metric !== schema.configuration.metric) unsupported()
  const selected = await query.direction(connection, schema.configuration)
  // Direction is private admitted data; byte projection completes synchronously without another image.
  assertStorageVector(selected.query, schema.configuration, RedisText.backend)
  const bytes = vectorBytes(selected.query)
  // The FP32 roundtrip remains required to reject finite inputs that overflow native FLOAT32.
  assertStorageVector(
    vectorValues(bytes, schema.configuration.dimensions),
    schema.configuration,
    RedisText.backend
  )
  if (!actual.topK) return []
  const conditions = [...query.initial, ...actual.conditions].map((condition) =>
    vectorCondition(condition, schema.fields)
  )
  if (conditions.some((condition) => condition === undefined)) unsupported()
  const time = await connection.command([RedisCommand.time])
  if (!Array.isArray(time) || time.length !== 2) throw redisError(RedisErrorCode.decodeFailed, time)
  const now = replyRevision(time[0]) * 1000 + Math.floor(replyRevision(time[1]) / 1000)
  if (!Number.isSafeInteger(now) || replyRevision(time[1]) > 999999)
    throw redisError(RedisErrorCode.decodeFailed, time)
  // Exclusions are exact managed native document keys, avoiding assumptions about user ID syntax.
  const names = vectorNames(layout, query.state.name),
    excluded = new Set(selected.exclude.map(names.point))
  const filter = [
    '@' + RedisVector.org + ':{' + layout.orgId.replaceAll('-', '\\-') + '}',
    '(@' + RedisVector.expiry + ':[0 0] | @' + RedisVector.expiry + ':[(' + now + ' +inf])',
    ...conditions
  ].join(' ')
  // Fixed-size native sample TAGs exclude complete IDs before ranking.
  const sampleTags = await Promise.all(selected.exclude.map(vectorSample)),
    withoutSamples = selected.exclude.length
      ? filter + ' -@' + RedisVector.sample + ':{' + sampleTags.join('|') + '}'
      : filter
  const field = query.exact ? RedisVector.exact : RedisVector.approximate,
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
    const point = vectorPoint(row.fields, query.state.name, row.key, names),
      distance = Number(vectorText(row.fields.get(RedisVector.score)))
    if (!Number.isFinite(distance)) throw redisError(RedisErrorCode.decodeFailed, row)
    const score =
      schema.configuration.metric === 'euclid' ? -Math.sqrt(Math.max(0, distance)) : 1 - distance
    if (actual.minScore !== undefined && score < actual.minScore) continue
    hits.push([
      point.id,
      {
        id: point.id,
        score,
        ...(point.payload === undefined ? {} : { payload: point.payload as TPayload }),
        ...(actual.withVector
          ? {
              vector: vectorValues(row.fields.get(field), schema.configuration.dimensions)
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
/** Bind the canonical vector query owner to this explicit native source and cursor. */
function redisVectorQuery<TPayload>(
  binding: IRedisVectorBindingContext,
  state: IRedisVectorCollectionState,
  direction: (
    connection: IRedisConnection,
    configuration: IStorageVectorConfiguration
  ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>,
  exact: boolean,
  metric?: IStorageVectorConfiguration['metric'],
  initial: readonly IQueryCondition[] = [],
  origin?: IVectorQueryOrigin
) {
  const port = binding.resolve()
  const query: IRedisVectorQueryContext = { state, direction, port, exact, metric, initial }
  return createVectorQuery<TPayload, false>(
    {
      asyncDisposeKey,
      exact,
      origin,
      beginOperation: () => port.beginOperation(),
      pushdown: {
        source: RedisText.backend,
        operators: Object.values(QueryOperator),
        operations: [QueryOperation.where, QueryOperation.topK],
        canPushCondition: (condition) => vectorCondition(condition) !== undefined
      },
      watch: ({ ctx }) => port.watch(ctx),
      execute: (input) => new RedisVectorCursor<TPayload>(query, input)
    },
    port.chain()
  )
}

/**
 * Execute samples using original vector configuration, native connection and explicit provider
 * state.
 */
async function redisVectorSamples(
  binding: IRedisVectorBindingContext,
  connection: IRedisConnection,
  state: IRedisVectorCollectionState,
  configuration: IStorageVectorConfiguration,
  ids: readonly string[]
) {
  const port = binding.resolve(),
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
/** Remove selected IDs through the original native draft, locks and command planner. */
function redisRemoveVectors(
  collection: IRedisVectorCollectionContext,
  ids: readonly string[],
  ctx?: Parameters<IVectorCollection<unknown>['delete']>[1]
) {
  /** Caller IDs must remain stable while middleware and native lock admission can await. */
  const captured = snapshotStorageVectorIds(ids, RedisText.backend)
  return collection.port.mutate(
    RedisOperation.vectorDelete,
    captured,
    ctx,
    // Middleware may replace IDs; the native draft still awaits guards and HASH reads.
    (actual) => snapshotStorageVectorIds(actual, RedisText.backend),
    (actual) => actual.map((id) => lock(collection.name, id)),
    async (draft, actual) => {
      for (const id of actual) {
        await draft.guardVector(lock(collection.name, id))
        const point = await redisVectorHash(draft, collection.name, id)
        if (point.fields.size) {
          draft.changeHash(point, new Map())
        }
      }
    },
    ctx?.concurrency
  )
}
/** Collection methods are a fixed explicit-context table with no mutable lexical component state. */
function createRedisVectorCollectionApi<TPayload>(
  collection: IRedisVectorCollectionContext
): IVectorCollection<TPayload, false, true> {
  return {
    near(input, options) {
      const { exact = false, metric } = options ?? {}
      if (typeof exact !== 'boolean') throw invalidArgument()
      if (metric !== undefined && !['cosine', 'dot', 'euclid'].includes(metric))
        throw invalidArgument()
      if (
        metric !== undefined &&
        collection.current.configuration &&
        metric !== collection.current.configuration.metric
      )
        unsupported()
      /** A deferred query stores its own caller vector across future FT.INFO/sample awaits. */
      const direction = snapshotStorageVector(
        input,
        collection.current.configuration,
        RedisText.backend
      )
      return redisVectorQuery<TPayload>(
        collection.binding,
        collection.current,
        async () => ({ query: direction, exclude: [] }),
        exact,
        metric,
        [],
        { kind: VectorQueryOriginKind.near, vector: direction }
      )
    },
    similarTo(id) {
      assertStorageVectorIds([id], RedisText.backend)
      const captured = id
      return redisVectorQuery<TPayload>(
        collection.binding,
        collection.current,
        async (connection, configuration) => ({
          query: (
            await redisVectorSamples(
              collection.binding,
              connection,
              collection.current,
              configuration,
              [captured]
            )
          )[0]!,
          exclude: [captured]
        }),
        false,
        undefined,
        [],
        { kind: VectorQueryOriginKind.similarTo, id: captured }
      )
    },
    recommend(examples) {
      /** Query sample IDs outlive this synchronous chain construction and native loading awaits. */
      const { positive, negative } = examples,
        pos = snapshotStorageVectorIds(positive, RedisText.backend),
        neg = snapshotStorageVectorIds(negative ?? [], RedisText.backend)
      if (!pos.length || new Set([...pos, ...neg]).size !== pos.length + neg.length)
        throw invalidArgument()
      return redisVectorQuery<TPayload>(
        collection.binding,
        collection.current,
        async (connection, configuration) => {
          const values = await redisVectorSamples(
            collection.binding,
            connection,
            collection.current,
            configuration,
            [...pos, ...neg]
          )
          return {
            query: recommendStorageVector(
              values.slice(0, pos.length) as [readonly number[], ...(readonly number[])[]],
              values.slice(pos.length)
            ),
            exclude: [...pos, ...neg]
          }
        },
        false,
        undefined,
        [],
        { kind: VectorQueryOriginKind.recommend, positive: pos, negative: neg }
      )
    },
    upsert(points, ctx) {
      const ttlMs = ctx?.ttlMs,
        policy = ctx?.concurrency
      if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, RedisText.backend)
      /** Transformed point data must remain fixed through native schema, lock and HASH awaits. */
      const capture = (input: readonly IStorageVectorPoint<TPayload>[]) =>
        snapshotStorageVectorUpsert(input, collection.current.configuration, RedisText.backend).map(
          (point) => ({
            point,
            bytes: vectorBytes(point.vector),
            projection: vectorProjection(point.payload as ICodecValue | undefined),
            payload: point.payload === undefined ? undefined : payloadBytes(point.payload)
          })
        )
      /** Detach caller vectors and payloads before asynchronous middleware can borrow them. */
      const initial = snapshotStorageVectorUpsert(
        points,
        collection.current.configuration,
        RedisText.backend
      )
      return collection.port.mutate(
        RedisOperation.vectorUpsert,
        initial,
        ctx,
        capture,
        (actual) => actual.map(({ point }) => lock(collection.name, point.id)),
        async (draft, actual) => {
          if (!actual.length) return
          const sampleTags = await Promise.all(actual.map(({ point }) => vectorSample(point.id)))
          const schema = await resolveVectorSchema(
            draft.connection,
            draft.layout,
            collection.name,
            collection.current.configuration
          )
          collection.current.configuration = schema.configuration
          const names = vectorNames(draft.layout, collection.name)
          /** One local batch union avoids repeated DDL for a newly observed scalar path. */
          const projections = new Map(actual.flatMap((item) => [...item.projection]))
          for (const item of actual)
            assertStorageVector(
              vectorValues(item.bytes, schema.configuration.dimensions),
              schema.configuration,
              RedisText.backend
            )
          await registerVectorFields(draft.connection, names.index, schema, projections)
          for (const [index, { point, bytes, projection, payload }] of actual.entries()) {
            await draft.guardVector(lock(collection.name, point.id))
            const entry = await redisVectorHash(draft, collection.name, point.id)
            const deadline =
              ttlMs === undefined ? entry.deadline : (await draft.now()) + Math.ceil(ttlMs)
            const fields = new Map(projection)
            fields.set(RedisVector.org, vectorString(draft.layout.orgId))
            fields.set(RedisVector.id, payloadBytes(point.id))
            fields.set(RedisVector.collection, payloadBytes(collection.name))
            fields.set(RedisVector.sample, vectorString(sampleTags[index]!))
            fields.set(RedisVector.approximate, bytes)
            fields.set(RedisVector.exact, bytes)
            if (payload !== undefined) fields.set(RedisVector.payload, payload)
            draft.changeHash(
              entry,
              ttlMs === 0 ? new Map() : vectorExpiry(fields, deadline),
              deadline
            )
          }
        },
        policy
      )
    },
    delete: (ids, ctx) => redisRemoveVectors(collection, ids, ctx),
    deleteWhere(where, ctx) {
      if (typeof where === 'function') unsupported()
      /** A deferred native delete retains a canonical condition AST across pipeline and query I/O. */
      const condition = snapshotStorageWhere(where),
        mode = snapshotStorageDeleteCountMode(ctx?.count, RedisText.backend)
      if (vectorCondition(condition) === undefined) unsupported()
      void mode
      return collection.port.mutate(
        RedisOperation.vectorDeleteWhere,
        condition,
        ctx,
        (actual) => actual,
        () => [],
        async (draft, actual) => {
          const schema = await resolveVectorSchema(
              draft.connection,
              draft.layout,
              collection.name,
              collection.current.configuration
            ),
            names = vectorNames(draft.layout, collection.name),
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
              const point = vectorPoint(row.fields, collection.name, row.key, names)
              ids.set(row.key, point.id)
            }
            if (rows.length < 256) break
          }
          let count = 0
          for (const [physical, id] of ids) {
            await draft.guardVector(lock(collection.name, id))
            const point = await draft.hash(physical, lock(collection.name, id))
            if (point.fields.size) {
              draft.changeHash(point, new Map())
              count++
            }
          }
          return count
        },
        ctx?.concurrency
      )
    },
    async search(input, options, ctx) {
      /** The public search owns its caller vector/options while the query executes asynchronously. */
      const captured = snapshotStorageVectorSearch(
          input,
          options,
          collection.current.configuration,
          RedisText.backend
        ),
        conditions = captured.options.filter ? [filterCondition(captured.options.filter)] : []
      if (conditions.some((condition) => vectorCondition(condition) === undefined)) unsupported()
      const chain = redisVectorQuery<TPayload>(
        collection.binding,
        collection.current,
        async () => ({ query: captured.query, exclude: [] }),
        captured.options.exact,
        undefined,
        conditions
      )
      if (captured.options.k === 0) {
        collection.port.assertLive()
        assertOperationContext(ctx)
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
/** Admit collection input once and publish a view of the original selected provider state. */
function createRedisVectorCollection<TPayload>(
  binding: IRedisVectorBindingContext,
  name: string,
  options?: IStorageVectorConfiguration
): IVectorCollection<TPayload, false, true> {
  const port = binding.resolve()
  port.assertLive()
  /** Collection configuration is retained across later schema/query I/O, so caller options detach. */
  const captured = snapshotStorageVectorCollection(name, options, RedisText.backend)
  let state = binding.collections.get(captured.name)
  if (!state) {
    state = { name: captured.name, configuration: captured.options }
    binding.collections.set(captured.name, state)
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
  return createRedisVectorCollectionApi<TPayload>({ binding, port, name, current })
}
/** One selected organization publishes only its original native vector implementation. */
function createRedisVectorBinding(resolve: () => IRedisNativeFeaturePort): IRedisVectorBinding {
  const binding: IRedisVectorBindingContext = { resolve, collections: new Map() }
  const api: IVectorApi<false, true> = {
    collection: <TPayload>(name: string, options?: IStorageVectorConfiguration) =>
      createRedisVectorCollection<TPayload>(binding, name, options)
  }
  return {
    api,
    expire: redisVectorExpire,
    remaining: redisVectorRemaining,
    remainingRoot: (target, ctx) =>
      binding
        .resolve()
        .run(RedisOperation.remaining, target, ctx, false, async (actual, connection, layout) => {
          const value = replyInteger(
            await connection.command([
              RedisCommand.pttl,
              vectorNames(layout, actual.collection).point(actual.id)
            ])
          )
          return value < 0 ? undefined : value
        })
  }
}
