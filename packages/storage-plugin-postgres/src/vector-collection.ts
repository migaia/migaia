// Vector collection class for the PostgreSQL vector backend (see ./vector.ts).
import {
  assertStorageVector,
  assertStorageVectorIds,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  assertStorageTtlDuration,
  type IVectorCollection,
  type IStorageVectorConfiguration,
  type IVectorQueryInput
} from '@migaia/storage-contract'
import {
  snapshotStorageWhere,
  createVectorQuery,
  lockKey,
  recommendStorageVector,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch,
  snapshotStorageVectorIds,
  snapshotStorageDeleteCountMode,
  asyncDisposeKey
} from '@migaia/storage-host/sdk'
import type { IPgState } from './native.ts'
import { observePgRange, observePgBatch, markPgChanged } from './native.ts'
import type { IPgNativeParameter } from './types.ts'
import { pgKey } from './codec.ts'
import { pgVectorCondition, pgVectorFilter, pgVectorProjection } from './vector-filter.ts'
import { invalidArgument } from './errors.ts'
import { PgNames } from './constants.ts'
import { PgVectorBackend, vectorRows, unsupported, pointId } from './vector.ts'

/** Each collection retains its own immutable name, schema choice and original backend. */
export class PgVectorCollection<T> implements IVectorCollection<T, true> {
  /** The backend owns native execution; this view owns no additional resource. */
  readonly #backend: PgVectorBackend
  /** Collection identity remains stable across asynchronous native layout preparation. */
  readonly #name: string
  /** Capture schema options because callers can mutate them before a deferred query executes. */
  readonly #captured: ReturnType<typeof snapshotStorageVectorCollection>
  /** Validate the public collection entry before any query or native operation is created. */
  constructor(
    backend: PgVectorBackend,
    name: string,
    options: IStorageVectorConfiguration | undefined
  ) {
    backend.runtime.assertLive()
    this.#backend = backend
    this.#name = name
    this.#captured = snapshotStorageVectorCollection(name, options, PgNames.backend)
  }
  /** Bind the canonical query source to this collection and the selected native execution. */
  #build(
    resolve: (state: IPgState) => Promise<readonly number[]>,
    metric?: IStorageVectorConfiguration['metric'],
    exact = false,
    excluded: readonly string[] = [],
    origin?: IVectorQueryOrigin
  ) {
    const source: import('@migaia/storage-contract').IVectorQuerySource<T, true> = {
      pushdown: {
        source: PgNames.backend,
        operators: [
          'eq',
          'ne',
          'in',
          'exists',
          'gt',
          'gte',
          'lt',
          'lte',
          'between',
          'has'
        ] as const,
        operations: ['where', 'topK', 'minScore'] as const,
        canPushCondition: (condition: import('@migaia/storage-contract').IQueryCondition) =>
          pgVectorCondition(condition, []) !== undefined
      },
      asyncDisposeKey,
      groupBy: true as const,
      exact,
      origin,
      ...(this.#backend.runtime.quantization === undefined ? {} : { native: true as const }),
      beginOperation: () => this.#backend.runtime.beginOperation(),
      execute: (input: IVectorQueryInput) =>
        vectorRows(() =>
          this.#backend.runtime.run('vector.search', input.ctx, async (state) =>
            this.#backend.search<T>(
              state,
              this.#name,
              this.#captured.options,
              await resolve(state),
              input,
              metric,
              exact,
              false,
              excluded
            )
          )
        ),
      mutate: (
        request: import('@migaia/storage-contract').IQueryDelete,
        run: Parameters<
          NonNullable<import('@migaia/storage-contract').IVectorQuerySource<T>['mutate']>
        >[1]
      ) =>
        this.#backend.runtime.run(
          'vector.delete',
          {
            ...request.ctx,
            ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency })
          },
          async (state) =>
            run({
              execute: (input) =>
                vectorRows(async () =>
                  this.#backend.search<T>(
                    state,
                    this.#name,
                    this.#captured.options,
                    await resolve(state),
                    input,
                    metric,
                    exact,
                    true,
                    excluded
                  )
                ),
              accept: async (_key, hit) =>
                this.#backend
                  .remove(
                    state,
                    this.#name,
                    await this.#backend.collection(state, this.#name, this.#captured.options),
                    [hit.id]
                  )
                  .then((count) => count !== 0)
            })
        ),
      ...(this.#backend.runtime.configuration.server === 'postgres'
        ? { watch: (input: IVectorQueryInput) => this.#backend.runtime.watch(input.ctx) }
        : {})
    }
    return createVectorQuery<T, true>(source, this.#backend.runtime.methods())
  }
  /** Near uses this collection's fixed native routing and configuration. */
  readonly near: IVectorCollection<T, true>['near'] = (query, options) => {
    const { metric, exact = false } = options ?? {}
    if (exact !== true && exact !== false) throw invalidArgument()
    /** Deferred query execution must not observe later caller vector mutation. */
    const direction = snapshotStorageVector(
      query,
      { ...this.#captured.options, ...(metric === undefined ? {} : { metric }) },
      PgNames.backend
    )
    return this.#build(async () => direction, metric, exact, [], {
      kind: VectorQueryOriginKind.near,
      vector: direction
    })
  }
  /** SimilarTo uses this collection's fixed native routing and configuration. */
  readonly similarTo: IVectorCollection<T, true>['similarTo'] = (id) => {
    if (typeof id !== 'string') throw invalidArgument()
    return this.#build(
      async (state) =>
        (await this.#backend.sample(state, this.#name, this.#captured.options, [id]))[0]!,
      undefined,
      false,
      [id],
      { kind: VectorQueryOriginKind.similarTo, id }
    )
  }
  /** Recommend uses this collection's fixed native routing and configuration. */
  readonly recommend: IVectorCollection<T, true>['recommend'] = (examples) => {
    const { positive, negative = [] } = examples
    /** Positive examples remain fixed while deferred native sample reads await. */
    const positives = snapshotStorageVectorIds(positive, PgNames.backend, true)
    /** Negative examples remain fixed while deferred native sample reads await. */
    const negatives = snapshotStorageVectorIds(negative, PgNames.backend, true)
    if (positives.length === 0) throw invalidArgument()
    assertStorageVectorIds([...positives, ...negatives], PgNames.backend, true)
    return this.#build(
      async (state) => {
        const good = await this.#backend.sample(
          state,
          this.#name,
          this.#captured.options,
          positives
        )
        const bad = await this.#backend.sample(state, this.#name, this.#captured.options, negatives)
        return recommendStorageVector([good[0]!, ...good.slice(1)], bad)
      },
      undefined,
      false,
      [...positives, ...negatives],
      { kind: VectorQueryOriginKind.recommend, positive: positives, negative: negatives }
    )
  }
  /** Upsert uses this collection's fixed native routing and configuration. */
  readonly upsert: IVectorCollection<T, true>['upsert'] = async (points, ctx) => {
    /** IDs, embeddings and codec payloads must survive awaited layout, lock and revision I/O. */
    const prepared = snapshotStorageVectorUpsert(points, this.#captured.options, PgNames.backend)
    const { ttlMs, ...options } = ctx ?? {}
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, PgNames.backend)
    if (prepared.length === 0) return
    await this.#backend.runtime.run('vector.upsert', options, async (state) => {
      const config = await this.#backend.collection(state, this.#name, this.#captured.options)
      for (const point of prepared) assertStorageVector(point.vector, config, PgNames.backend)
      await state.guardKeys(prepared.map((point) => lockKey.vector(this.#name, point.id)))
      await observePgBatch(
        state,
        this.#backend.runtime.tables,
        'vector',
        prepared.map((point) => [this.#name, point.id])
      )
      const written = await state.client.query(
        'INSERT INTO ' +
          config.table +
          ' (org_id,key,embedding,payload,projection,expires_at) SELECT $1,input.key,input.embedding::vector,input.payload,input.projection::jsonb,' +
          (ttlMs === undefined ? 'NULL' : "clock.now+($6::float8*interval '1 millisecond')") +
          ' FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS input(key,embedding,payload,projection) CROSS JOIN (SELECT clock_timestamp() AS now) AS clock ON CONFLICT(org_id,key) DO UPDATE SET embedding=excluded.embedding,payload=excluded.payload,projection=excluded.projection,expires_at=' +
          (ttlMs === undefined
            ? 'CASE WHEN ' +
              config.table +
              '.expires_at<=clock_timestamp() THEN NULL ELSE ' +
              config.table +
              '.expires_at END'
            : 'excluded.expires_at') +
          (state.journal === undefined
            ? ''
            : ' RETURNING key,embedding::text AS value,payload,projection::text AS projection,expires_at::text AS deadline'),
        [
          state.orgId,
          { arrayType: 'text', values: prepared.map((point) => pgKey(point.id).hex) },
          {
            arrayType: 'text',
            values: prepared.map((point) => JSON.stringify(point.vector))
          },
          {
            arrayType: 'text',
            values: prepared.map((point) =>
              point.payload === undefined ? null : state.codecs.encodeRecord(point.payload)
            )
          },
          {
            arrayType: 'text',
            values: prepared.map((point) =>
              point.payload === undefined ? null : JSON.stringify(pgVectorProjection(point.payload))
            )
          },
          ...(ttlMs === undefined ? [] : [ttlMs])
        ],
        state.ctx
      )
      const after =
        state.journal === undefined
          ? undefined
          : new Map(written.rows.map((row) => [String(row.key), row]))
      for (const point of prepared)
        markPgChanged(state, 'vector', [this.#name, point.id], after?.get(pgKey(point.id).hex))
    })
  }
  /** Delete uses this collection's fixed native routing and configuration. */
  readonly delete: IVectorCollection<T, true>['delete'] = async (ids, ctx) => {
    /** Delete membership must stay fixed while native layout and lock acquisition await. */
    const prepared = snapshotStorageVectorIds(ids, PgNames.backend)
    if (prepared.length === 0) return
    await this.#backend.runtime.run('vector.delete', ctx, async (state) => {
      await this.#backend.remove(
        state,
        this.#name,
        await this.#backend.collection(state, this.#name, this.#captured.options),
        prepared
      )
    })
  }
  /** DeleteWhere uses this collection's fixed native routing and configuration. */
  readonly deleteWhere: IVectorCollection<T, true>['deleteWhere'] = async (where, ctx) => {
    if (typeof where === 'function') throw unsupported()
    /** The condition must stay fixed between awaited layout lookup, locked selection and delete. */
    const condition = snapshotStorageWhere(where)
    const { count, ...options } = ctx ?? {}
    snapshotStorageDeleteCountMode(count, PgNames.backend)
    if (pgVectorCondition(condition, []) === undefined) throw unsupported()
    return this.#backend.runtime.run('vector.deleteWhere', options, async (state) => {
      const config = await this.#backend.collection(state, this.#name, this.#captured.options)
      await observePgRange(state, this.#backend.runtime.tables, 'vector')
      const params: IPgNativeParameter[] = [state.orgId]
      const translated = pgVectorCondition(condition, params)!
      const rows = (
        await state.client.query(
          'SELECT key FROM ' + config.table + ' WHERE org_id=$1 AND ' + translated + ' FOR UPDATE',
          params,
          state.ctx
        )
      ).rows
      const ids = rows.map((row) => pointId(row.key))
      await observePgBatch(
        state,
        this.#backend.runtime.tables,
        'vector',
        ids.map((id) => [this.#name, id])
      )
      await state.guardKeys(ids.map((id) => lockKey.vector(this.#name, id)))
      const removed = (
        await state.client.query(
          'DELETE FROM ' + config.table + ' WHERE org_id=$1 AND ' + translated + ' RETURNING key',
          params,
          state.ctx
        )
      ).rows
      for (const row of removed) markPgChanged(state, 'vector', [this.#name, pointId(row.key)])
      return removed.length
    })
  }
  /** Search uses this collection's fixed native routing and configuration. */
  readonly search: IVectorCollection<T, true>['search'] = async (query, options, ctx) => {
    /** Search query, options and filter remain fixed while transaction and layout lookup await. */
    const prepared = snapshotStorageVectorSearch(
      query,
      options,
      this.#captured.options,
      PgNames.backend
    )
    if (prepared.options.k === 0) return []
    const conditions =
      prepared.options.filter === undefined ? [] : [pgVectorFilter(prepared.options.filter)]
    if (conditions.some((condition) => pgVectorCondition(condition, []) === undefined))
      throw unsupported()
    const rows = await this.#backend.runtime.run('vector.search', ctx, (state) =>
      this.#backend.search<T>(
        state,
        this.#name,
        this.#captured.options,
        prepared.query,
        { conditions, topK: prepared.options.k, minScore: undefined, withVector: false, ctx },
        undefined,
        prepared.options.exact
      )
    )
    return rows.map(([, hit]) => ({
      id: hit.id,
      score: hit.score,
      ...(prepared.options.withPayload && hit.payload !== undefined ? { payload: hit.payload } : {})
    }))
  }
}
