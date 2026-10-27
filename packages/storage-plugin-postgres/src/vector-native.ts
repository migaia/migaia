import { snapshotStorageVector, snapshotStorageVectorFilter } from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext
} from '@migaia/storage-contract'
import type {
  IPgNativeOperation,
  IPgNativeVectorTarget,
  IPgNativeVectorSearchOptions,
  IPgNativeVectorHit,
  IPgNativeParameter,
  IPostgresTransactionScope
} from './types.js'
import { quotePgIdentifier } from './copy-command.js'
import { pgVectorCondition, pgVectorFilter } from './vector-filter.js'
import { invalidArgument, postgresError } from './errors.js'
import { PostgresErrorCode } from '@migaia/storage-contract/error-code'
import { PgNames } from './constants.js'
/** Validate and encode the caller table target before native execution can await. */
function preparePgNativeVector(
  target: IPgNativeVectorTarget,
  query: readonly number[],
  options: IPgNativeVectorSearchOptions | undefined
) {
  const { table, idColumn, vectorColumn, payloadColumn } = target
  if (!Array.isArray(table) || table.length === 0) throw invalidArgument()
  const physical = table.map(quotePgIdentifier).join('.')
  const id = quotePgIdentifier(idColumn)
  const vector = quotePgIdentifier(vectorColumn)
  const payload = payloadColumn === undefined ? undefined : quotePgIdentifier(payloadColumn)
  const { metric = 'cosine', limit = 10, minScore, filter, efSearch, probes } = options ?? {}
  if (
    (metric !== 'cosine' && metric !== 'dot' && metric !== 'euclid') ||
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    (minScore !== undefined && (typeof minScore !== 'number' || !Number.isFinite(minScore))) ||
    (efSearch !== undefined && (!Number.isSafeInteger(efSearch) || efSearch < 1)) ||
    (probes !== undefined && (!Number.isSafeInteger(probes) || probes < 1))
  )
    throw invalidArgument()
  /** Native operation admission and tuning queries await before binding this caller vector. */
  const direction = snapshotStorageVector(query, { metric }, PgNames.backend)
  /** Native operation admission awaits; the caller filter must keep its original membership. */
  const condition =
    filter === undefined
      ? undefined
      : pgVectorFilter(snapshotStorageVectorFilter(filter, PgNames.backend))
  if (
    condition !== undefined &&
    (payload === undefined || pgVectorCondition(condition, [], payload) === undefined)
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  return {
    physical,
    id,
    vector,
    payload,
    metric,
    limit,
    minScore,
    condition,
    efSearch,
    probes,
    direction
  }
}
/**
 * Caller tables use their actual engine schema and preserve native IDs instead of standard
 * collection rules.
 */
export function searchPgNativeVector(
  run: IPgNativeOperation,
  scope: IPostgresTransactionScope | undefined,
  target: IPgNativeVectorTarget,
  query: readonly number[],
  options: IPgNativeVectorSearchOptions | undefined,
  ctx: IOperationContext | undefined
): Promise<readonly IPgNativeVectorHit[]> {
  const input = preparePgNativeVector(target, query, options)
  if (input.limit === 0) return Promise.resolve([])
  return run(scope, 'pgvector.search', ctx, async (client, context) => {
    if (input.efSearch !== undefined)
      await client.query(
        "SELECT set_config('hnsw.ef_search',$1,true)",
        [String(input.efSearch)],
        context
      )
    if (input.probes !== undefined)
      await client.query(
        "SELECT set_config('ivfflat.probes',$1,true)",
        [String(input.probes)],
        context
      )
    const params: IPgNativeParameter[] = [JSON.stringify(input.direction)]
    const operator = input.metric === 'cosine' ? '<=>' : input.metric === 'dot' ? '<#>' : '<->'
    const distance = input.vector + ' ' + operator + ' $1::vector'
    let inner =
      'SELECT ' +
      input.id +
      ' AS id,' +
      (input.metric === 'cosine' ? '1-' : '-') +
      '(' +
      distance +
      ') AS score' +
      (input.payload === undefined ? '' : ',' + input.payload + ' AS payload') +
      ' FROM ' +
      input.physical
    if (input.condition !== undefined)
      inner += ' WHERE ' + pgVectorCondition(input.condition, params, input.payload!)
    params.push(input.limit)
    inner += ' ORDER BY ' + distance + ',' + input.id + ' LIMIT $' + params.length
    let text = 'SELECT * FROM (' + inner + ') AS ranked'
    if (input.minScore !== undefined) {
      params.push(input.minScore)
      text += ' WHERE score>=$' + params.length
    }
    text += ' ORDER BY score DESC,id'
    const rows = (await client.query(text, params, context)).rows
    return rows.map((row) => {
      if (typeof row.score !== 'number' || !Number.isFinite(row.score))
        throw postgresError(PostgresErrorCode.decodeFailed)
      return {
        id: row.id,
        score: row.score,
        ...(input.payload === undefined ? {} : { payload: row.payload })
      }
    })
  })
}
