import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageVectorCollection,
  assertStorageVector,
  type IVectorApi,
  type IStorageVectorConfiguration,
  type IOperationContext,
  type ITransactionOptions,
  type IStorageIterator,
  type IStorageKey,
  type IVectorQueryInput,
  type IVectorHit,
  type ITtlTarget,
  type IStorageChange
} from '@migaia/storage-contract'
import {
  createStorageIteratorLifetime,
  lockKey,
  asyncDisposeKey,
  createStorageOperationReporter
} from '@migaia/storage-host/sdk'
import type { IPgConfiguration, IPgTables } from './schema.js'
import { ensurePgQuantizedIndex, pgQuantizedExpression } from './schema.js'
import type { IPgQuantizedOptions } from './features/quantized.js'
import type { IPgState } from './native.js'
import { observePgRevision, observePgRange, observePgBatch, markPgChanged } from './native.js'
import type { IPgNativeParameter, IPgConnection } from './types.js'
import { pgKey, pgTextKey, encodePgRecord, decodePgRecord } from './codec.js'
import { quotePgIdentifier } from './copy-command.js'
import { pgVectorCondition } from './vector-filter.js'
import { invalidArgument, postgresError } from './errors.js'
import { PostgresErrorCode } from '@migaia/storage-contract/error-code'
import { PgNames, PgQuantizedMode } from './constants.js'
import { encodePgJournalImage, decodePgJournalImage, type IPgJournalVectorPort } from './journal.js'
import { PgVectorCollection } from './vector-collection.js'

/** One native table belongs to the store-wide logical collection rather than one organization. */
type IPgVectorCollectionState = IStorageVectorConfiguration & { readonly table: string }
/** This private source receives only the backend's original native transaction operation. */
export type IPgVectorRuntime = {
  readonly configuration: IPgConfiguration
  readonly tables: IPgTables
  readonly quantization: IPgQuantizedOptions['mode'] | undefined
  readonly orgId: string
  assertLive(): void
  beginOperation(): () => void
  run<R>(
    operation: string,
    ctx: ITransactionOptions | undefined,
    work: (state: IPgState) => Promise<R>
  ): Promise<R>
  readonly methods: () => object | undefined
  watch(ctx?: IOperationContext): IStorageIterator<IStorageChange>
}
/** The distance operator and score projection are finite native engine choices. */
const metrics = {
  cosine: { operator: '<=>', score: '1-' },
  dot: { operator: '<#>', score: '-' },
  euclid: { operator: '<->', score: '-' }
} as const
/** Unsupported native conditions never fall back to a full managed collection scan. */
export function unsupported(): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: PgNames.backend
  })
}
/** Actual native embedding text is re-admitted by the original finite-vector owner. */
function decodeVector(
  value: unknown,
  configuration: IStorageVectorConfiguration
): readonly number[] {
  try {
    if (typeof value !== 'string') throw unsupported()
    const decoded: unknown = JSON.parse(value)
    if (!Array.isArray(decoded)) throw unsupported()
    assertStorageVector(decoded, configuration, PgNames.backend)
    return decoded
  } catch (cause) {
    throw postgresError(PostgresErrorCode.decodeFailed, cause)
  }
}
/**
 * Canonical point IDs may contain any supported string code units; native TEXT stores only their
 * key hex.
 */
export function pointId(value: unknown): string {
  const decoded = pgTextKey(value)
  if (typeof decoded !== 'string') throw postgresError(PostgresErrorCode.decodeFailed)
  return decoded
}
/** One vector cursor owns its bounded result buffer and position. */
class PgVectorRows<T> {
  /** The native read stays deferred until the first admitted next call. */
  readonly #read: () => Promise<readonly T[]>
  /** Results are read once and released by the canonical iterator lifetime. */
  #rows: readonly T[] | undefined
  /** The next result position preserves the native ranking. */
  #index = 0
  /** Canonical lifetime retains close, return and disposal identity. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<T>>
  /** Build one cursor without executing native SQL eagerly. */
  constructor(read: () => Promise<readonly T[]>) {
    this.#read = read
    this.#lifetime = createStorageIteratorLifetime<T>({
      close: async () => {
        this.#rows = []
      },
      report: createStorageOperationReporter()
    })
  }
  /** Fetch once and advance only within the canonical iterator admission. */
  async #advance(): Promise<IteratorResult<T>> {
    this.#rows ??= await this.#read()
    return this.#index < this.#rows.length
      ? { done: false, value: this.#rows[this.#index++]! }
      : { done: true, value: undefined }
  }
  /** Expose own callbacks so detached iterator ports preserve their receiver. */
  open(): IStorageIterator<T> {
    return {
      next: () => this.#lifetime.advance(() => this.#advance()),
      return: (value) => this.#lifetime.returned(value),
      dispose: this.#lifetime.dispose,
      [asyncDisposeKey]: this.#lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}
/** Native result buffering is bounded by topK and owned by the original iterator lifetime. */
export function vectorRows<T>(read: () => Promise<readonly T[]>): IStorageIterator<T> {
  return new PgVectorRows(read).open()
}
/** One native vector backend owns layout lookup and the shared standard and journal ports. */
export class PgVectorBackend {
  /** Original organization execution, layout and feature selection remain with their owner. */
  readonly #runtime: IPgVectorRuntime
  /** One stable capability API constructs independently named collection views. */
  readonly standard: IVectorApi<true>
  /** Journal operations share the exact native vector codec and revision path. */
  readonly journal: IPgJournalVectorPort
  /** Assemble interfaces once without sharing mutable lexical state. */
  constructor(runtime: IPgVectorRuntime) {
    this.#runtime = runtime
    this.standard = {
      collection: <T>(name: string, options?: IStorageVectorConfiguration) =>
        new PgVectorCollection<T>(this, name, options)
    }
    this.journal = {
      read: async (state, name, ids) => {
        const config = await this.collection(state, name, undefined)
        const rows = (
          await state.client.query(
            'SELECT key,embedding::text AS vector,payload,projection::text AS projection,expires_at::text AS deadline FROM ' +
              config.table +
              ' WHERE org_id=$1 AND key=ANY($2::text[])',
            [state.orgId, { arrayType: 'text', values: ids.map((id) => pgKey(id).hex) }],
            state.ctx
          )
        ).rows
        const result = new Map<string, import('@migaia/storage-host').IStorageJournalImage>()
        for (const id of ids) result.set(id, { present: false })
        for (const row of rows) {
          if (
            typeof row.vector !== 'string' ||
            !(row.payload === null || typeof row.payload === 'string') ||
            !(row.projection === null || typeof row.projection === 'string') ||
            !(row.deadline === null || typeof row.deadline === 'string')
          )
            throw postgresError(PostgresErrorCode.decodeFailed)
          result.set(
            pointId(row.key),
            encodePgJournalImage({
              version: 1,
              channel: 'vector',
              value: row.vector,
              payload: row.payload,
              projection: row.projection,
              expiresAt: row.deadline
            })
          )
        }
        return result
      },
      write: async (state, name, id, image) => {
        const config = await this.collection(state, name, undefined)
        const wire = image.present ? decodePgJournalImage(image, 'vector') : undefined
        if (wire !== undefined) decodeVector(wire.value, config)
        await observePgRevision(state, this.#runtime.tables, 'vector', [name, id])
        await state.guardKeys([lockKey.vector(name, id)])
        let after: import('@migaia/storage-contract').ISqlRow | undefined
        if (wire === undefined) {
          const removed = await state.client.query(
            'DELETE FROM ' + config.table + ' WHERE org_id=$1 AND key=$2',
            [state.orgId, pgKey(id).hex],
            state.ctx
          )
          if (removed.rowCount === 0) return
        } else
          after = (
            await state.client.query(
              'INSERT INTO ' +
                config.table +
                ' (org_id,key,embedding,payload,projection,expires_at) VALUES($1,$2,$3::vector,$4,$5::jsonb,$6::timestamptz) ON CONFLICT(org_id,key) DO UPDATE SET embedding=excluded.embedding,payload=excluded.payload,projection=excluded.projection,expires_at=excluded.expires_at' +
                (state.journal === undefined
                  ? ''
                  : ' RETURNING key,embedding::text AS value,payload,projection::text AS projection,expires_at::text AS deadline'),
              [
                state.orgId,
                pgKey(id).hex,
                wire.value,
                wire.payload ?? null,
                wire.projection ?? null,
                wire.expiresAt
              ],
              state.ctx
            )
          ).rows[0]
        markPgChanged(state, 'vector', [name, id], after)
      }
    } satisfies IPgJournalVectorPort
  }
  /** Collection views borrow their fixed organization's execution context. */
  get runtime(): IPgVectorRuntime {
    return this.#runtime
  }
  /** Native managedTable uses this backend's original layout and transaction ports. */
  managedTable(value: unknown): string {
    const prefix =
      quotePgIdentifier(this.#runtime.configuration.schema) +
      '.' +
      quotePgIdentifier(this.#runtime.configuration.prefix + '_v').slice(0, -1)
    if (
      typeof value !== 'string' ||
      !value.startsWith(prefix) ||
      !value.endsWith('"') ||
      !/^[a-f0-9]{1,32}$/.test(value.slice(prefix.length, -1))
    )
      throw postgresError(PostgresErrorCode.decodeFailed)
    return value
  }
  /** Native collection uses this backend's original layout and transaction ports. */
  async collection(
    state: IPgState,
    name: string,
    options: IStorageVectorConfiguration | undefined
  ): Promise<IPgVectorCollectionState> {
    const extension = (
      await state.client.query(
        "SELECT extversion FROM pg_extension WHERE extname='vector'",
        [],
        state.ctx
      )
    ).rows[0]
    if (typeof extension?.extversion !== 'string') throw unsupported()
    const key = pgKey(name).hex
    let row = (
      await state.client.query(
        'SELECT value FROM ' +
          this.#runtime.tables.vectorConfiguration +
          ' WHERE org_id=$1 AND key=$2' +
          (this.#runtime.quantization === undefined ? '' : ' FOR UPDATE'),
        [PgNames.vectorConfigurationOwner, key],
        state.ctx
      )
    ).rows[0]
    if (!row) {
      if (options === undefined) throw invalidArgument()
      const limit = Number(
        (await state.client.query('SHOW max_identifier_length', [], state.ctx)).rows[0]
          ?.max_identifier_length
      )
      const available =
        limit - new TextEncoder().encode(this.#runtime.configuration.prefix + '_v').length
      if (available < 1) throw invalidArgument()
      const suffix = String(
        (await state.client.query('SELECT gen_random_uuid()::text AS id', [], state.ctx)).rows[0]
          ?.id
      )
        .replaceAll('-', '')
        .slice(0, available)
      const table =
        quotePgIdentifier(this.#runtime.configuration.schema) +
        '.' +
        quotePgIdentifier(this.#runtime.configuration.prefix + '_v' + suffix)
      const value = encodePgRecord({ ...options, table })
      const inserted = await state.client.query(
        'INSERT INTO ' +
          this.#runtime.tables.vectorConfiguration +
          ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING RETURNING value',
        [PgNames.vectorConfigurationOwner, key, value],
        state.ctx
      )
      if (inserted.rows.length !== 0) {
        await state.client.query(
          'CREATE TABLE ' +
            table +
            ' (org_id TEXT NOT NULL,key TEXT COLLATE "C" NOT NULL,embedding vector(' +
            options.dimensions +
            ') NOT NULL,payload TEXT,projection jsonb,expires_at timestamptz,PRIMARY KEY(org_id,key))',
          [],
          state.ctx
        )
        await state.client.query(
          'CREATE INDEX ' +
            quotePgIdentifier(this.#runtime.configuration.prefix + '_x' + suffix) +
            ' ON ' +
            table +
            ' (org_id,expires_at)',
          [],
          state.ctx
        )
        row = inserted.rows[0]
      } else
        row = (
          await state.client.query(
            'SELECT value FROM ' +
              this.#runtime.tables.vectorConfiguration +
              ' WHERE org_id=$1 AND key=$2' +
              (this.#runtime.quantization === undefined ? '' : ' FOR UPDATE'),
            [PgNames.vectorConfigurationOwner, key],
            state.ctx
          )
        ).rows[0]
    }
    const stored = decodePgRecord<IPgVectorCollectionState>(row?.value)
    const table = this.managedTable(stored.table)
    assertStorageVectorCollection(name, stored, PgNames.backend)
    const actual = stored
    if (
      options !== undefined &&
      (actual.dimensions !== options.dimensions || actual.metric !== options.metric)
    )
      throw invalidArgument()
    const column = (
      await state.client.query(
        "SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid=$1::regclass AND attname='embedding'",
        [table],
        state.ctx
      )
    ).rows[0]?.type
    if (column !== 'vector(' + actual.dimensions + ')') throw unsupported()
    if (this.#runtime.quantization !== undefined)
      await ensurePgQuantizedIndex(
        state.client,
        table,
        actual,
        this.#runtime.quantization,
        state.ctx
      )
    return { ...actual, table }
  }
  /** Native search uses this backend's original layout and transaction ports. */
  async search<T>(
    state: IPgState,
    name: string,
    options: IStorageVectorConfiguration | undefined,
    query: readonly number[],
    input: IVectorQueryInput,
    metric: IStorageVectorConfiguration['metric'] | undefined,
    exact: boolean,
    forUpdate = false,
    excluded: readonly string[] = []
  ): Promise<readonly (readonly [IStorageKey, IVectorHit<T, boolean>])[]> {
    /** Only this selected source can consume its captured native refinement packet. */
    const native = input.native
    let topN: number | undefined
    if (native !== undefined) {
      if (
        native === null ||
        typeof native !== 'object' ||
        !('mode' in native) ||
        !('topN' in native)
      )
        throw invalidArgument()
      const { mode, topN: capturedTopN } = native
      if (
        this.#runtime.quantization === undefined ||
        mode !== this.#runtime.quantization ||
        typeof capturedTopN !== 'number' ||
        !Number.isSafeInteger(capturedTopN) ||
        capturedTopN < 1 ||
        capturedTopN > input.topK
      )
        throw invalidArgument()
      topN = capturedTopN
    }
    const config = await this.collection(state, name, options)
    const selected = metric ?? config.metric
    assertStorageVector(query, { dimensions: config.dimensions, metric: selected }, PgNames.backend)
    const direction = query
    if (exact && native === undefined)
      await state.client.query('SET LOCAL enable_indexscan=off', [], state.ctx)
    if (native !== undefined && selected !== config.metric)
      await ensurePgQuantizedIndex(
        state.client,
        config.table,
        { ...config, metric: selected },
        this.#runtime.quantization!,
        state.ctx
      )
    await observePgRange(state, this.#runtime.tables, 'vector')
    const params: IPgNativeParameter[] = [state.orgId, JSON.stringify(direction)]
    const predicates = ['org_id=$1', '(expires_at IS NULL OR expires_at>clock_timestamp())']
    if (excluded.length !== 0) {
      params.push({ arrayType: 'text', values: excluded.map((id) => pgKey(id).hex) })
      predicates.push('key<>ALL($' + params.length + '::text[])')
    }
    for (const condition of input.conditions) {
      const translated = pgVectorCondition(condition, params)
      if (translated === undefined) throw unsupported()
      predicates.push(translated)
    }
    const distance = 'embedding ' + metrics[selected].operator + ' $2::vector'
    params.push(input.topK)
    const inner =
      'SELECT key,payload' +
      (input.withVector ? ',embedding::text AS vector' : '') +
      ',' +
      metrics[selected].score +
      '(' +
      distance +
      ') AS score FROM ' +
      config.table +
      ' WHERE ' +
      predicates.join(' AND ') +
      ' ORDER BY ' +
      distance +
      ',key LIMIT $' +
      params.length +
      (forUpdate ? ' FOR UPDATE' : '')
    let text = 'SELECT * FROM (' + inner + ') AS ranked'
    if (native !== undefined) {
      const mode = this.#runtime.quantization!
      const quantizedDistance =
        pgQuantizedExpression(mode, config.dimensions, 'embedding') +
        ' ' +
        (mode === PgQuantizedMode.binary ? '<~>' : metrics[selected].operator) +
        ' ' +
        pgQuantizedExpression(mode, config.dimensions, '$2::vector')
      text =
        'WITH recalled AS MATERIALIZED (SELECT key,payload,embedding FROM ' +
        config.table +
        ' WHERE ' +
        predicates.join(' AND ') +
        ' ORDER BY ' +
        quantizedDistance +
        ' LIMIT $' +
        params.length +
        ') SELECT * FROM (SELECT key,payload' +
        (input.withVector ? ',embedding::text AS vector' : '') +
        ',' +
        metrics[selected].score +
        '(' +
        distance +
        ') AS score FROM recalled) AS ranked'
    }
    if (input.minScore !== undefined) {
      params.push(input.minScore)
      text += ' WHERE score>=$' + params.length
    }
    text += ' ORDER BY score DESC,key'
    if (topN !== undefined) {
      params.push(topN)
      text += ' LIMIT $' + params.length
    }
    const rows = (await state.client.query(text, params, state.ctx)).rows
    await observePgBatch(
      state,
      this.#runtime.tables,
      'vector',
      rows.map((row) => [name, pointId(row.key)])
    )
    const result: (readonly [IStorageKey, IVectorHit<T, boolean>])[] = []
    for (const row of rows) {
      const id = pointId(row.key)
      if (typeof row.score !== 'number' || !Number.isFinite(row.score))
        throw postgresError(PostgresErrorCode.decodeFailed)
      result.push([
        id,
        {
          id,
          score: row.score,
          ...(row.payload == null ? {} : { payload: state.codecs.decodeRecord<T>(row.payload) }),
          ...(input.withVector ? { vector: decodeVector(row.vector, config) } : {})
        }
      ])
    }
    return result
  }
  /** Native sample uses this backend's original layout and transaction ports. */
  async sample(
    state: IPgState,
    name: string,
    options: IStorageVectorConfiguration | undefined,
    ids: readonly string[]
  ): Promise<readonly (readonly number[])[]> {
    const config = await this.collection(state, name, options)
    const rows = (
      await state.client.query(
        'SELECT key,embedding::text AS vector FROM ' +
          config.table +
          ' WHERE org_id=$1 AND key=ANY($2::text[]) AND (expires_at IS NULL OR expires_at>clock_timestamp())',
        [state.orgId, { arrayType: 'text', values: ids.map((id) => pgKey(id).hex) }],
        state.ctx
      )
    ).rows
    const byId = new Map(rows.map((row) => [pointId(row.key), decodeVector(row.vector, config)]))
    return ids.map((id) => {
      const vector = byId.get(id)
      if (vector === undefined) throw invalidArgument()
      return vector
    })
  }
  /** Native remove uses this backend's original layout and transaction ports. */
  async remove(
    state: IPgState,
    name: string,
    config: IPgVectorCollectionState,
    ids: readonly string[]
  ): Promise<number> {
    const unique = [...new Set(ids)]
    await observePgBatch(
      state,
      this.#runtime.tables,
      'vector',
      unique.map((id) => [name, id])
    )
    await state.guardKeys(unique.map((id) => lockKey.vector(name, id)))
    const rows = (
      await state.client.query(
        'DELETE FROM ' + config.table + ' WHERE org_id=$1 AND key=ANY($2::text[]) RETURNING key',
        [state.orgId, { arrayType: 'text', values: unique.map((id) => pgKey(id).hex) }],
        state.ctx
      )
    ).rows
    for (const row of rows) markPgChanged(state, 'vector', [name, pointId(row.key)])
    return rows.length
  }
  /** Remove only one organization while keeping shared physical vector layout. */
  async dropOrg(client: IPgConnection, orgId: string): Promise<void> {
    const rows = (
      await client.query(
        'SELECT value FROM ' + this.#runtime.tables.vectorConfiguration + ' WHERE org_id=$1',
        [PgNames.vectorConfigurationOwner]
      )
    ).rows
    for (const row of rows) {
      const stored = decodePgRecord<IPgVectorCollectionState>(row.value)
      await client.query('DELETE FROM ' + this.managedTable(stored.table) + ' WHERE org_id=$1', [
        orgId
      ])
    }
  }
  /** Read or change expiry through the same native vector row and revision owner. */
  async deadline(
    state: IPgState,
    target: Extract<ITtlTarget, { channel: 'vector' }>,
    ms?: number,
    persist = false
  ): Promise<number | boolean | undefined> {
    const config = await this.collection(state, target.collection, undefined)
    await observePgRevision(state, this.#runtime.tables, 'vector', [target.collection, target.id])
    await state.guardKeys([target])
    const key = pgKey(target.id).hex
    const expired = (
      await state.client.query(
        'DELETE FROM ' +
          config.table +
          ' WHERE org_id=$1 AND key=$2 AND expires_at<=clock_timestamp() RETURNING key',
        [state.orgId, key],
        state.ctx
      )
    ).rowCount
    if (expired) markPgChanged(state, 'vector', [target.collection, target.id])
    if (ms === undefined && !persist) {
      const row = (
        await state.client.query(
          'SELECT CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(0,extract(epoch FROM (expires_at-clock_timestamp()))*1000) END AS remaining FROM ' +
            config.table +
            ' WHERE org_id=$1 AND key=$2',
          [state.orgId, key],
          state.ctx
        )
      ).rows[0]
      return row?.remaining == null ? undefined : Number(row.remaining)
    }
    const changed = await state.client.query(
      'UPDATE ' +
        config.table +
        ' SET expires_at=' +
        (persist ? 'NULL' : "clock_timestamp()+($3::float8*interval '1 millisecond')") +
        ' WHERE org_id=$1 AND key=$2' +
        (persist ? ' AND expires_at IS NOT NULL' : '') +
        ' RETURNING key' +
        (state.journal === undefined
          ? ''
          : ',embedding::text AS value,payload,projection::text AS projection,expires_at::text AS deadline'),
      [state.orgId, key, ...(persist ? [] : [ms!])],
      state.ctx
    )
    if (changed.rowCount)
      markPgChanged(state, 'vector', [target.collection, target.id], changed.rows[0])
    return changed.rowCount !== 0
  }
}
/** Managed vector construction installs named native owners without another persistence path. */
export function createPgVectors(runtime: IPgVectorRuntime) {
  return new PgVectorBackend(runtime)
}
