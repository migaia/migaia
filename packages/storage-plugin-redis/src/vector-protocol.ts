import { isUint8Array } from '@migaia/utils/bytes'
import { sleep, type IAbortSignal } from '@migaia/utils/promise'
import { asCodecValue, type ICodecValue } from '@migaia/serialize/codec'
import {
  QueryOperator,
  type IQueryCondition,
  type IStorageVectorConfiguration
} from '@migaia/storage-contract'
import {
  redisPortableIdentity,
  redisHex,
  RedisSuffix,
  encodeRedisValue,
  decodeRedisValue,
  type createRedisLayout
} from './layout.ts'
import { readRedisHash } from './transaction.ts'
import { redisError, invalidArgument, unsupported } from './errors.ts'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import type { IRedisConnection } from './driver.ts'
/** Native schema, field and reply names have one owner for every selected vector path. */
export const RedisVector = {
  list: 'FT._LIST',
  info: 'FT.INFO',
  create: 'FT.CREATE',
  alter: 'FT.ALTER',
  search: 'FT.SEARCH',
  /** Per-query TIMEOUT word; 0 disables the server limit so FT.SEARCH never truncates silently. */
  timeout: 'TIMEOUT',
  on: 'ON',
  hash: 'HASH',
  prefix: 'PREFIX',
  schema: 'SCHEMA',
  tag: 'TAG',
  numeric: 'NUMERIC',
  vector: 'VECTOR',
  hnsw: 'HNSW',
  flat: 'FLAT',
  type: 'TYPE',
  float: 'FLOAT32',
  dim: 'DIM',
  distance: 'DISTANCE_METRIC',
  separator: 'SEPARATOR',
  add: 'ADD',
  sample: 'sample',
  /** Search truncates TAG tokens at this native byte boundary. */
  maxTagBytes: 4096,
  /** Fixed sample projection uses native SHA-256 over the complete original codec bytes. */
  digest: 'SHA-256',
  org: RedisSuffix.vectorOrg,
  expiry: 'expiry',
  id: RedisSuffix.vectorId,
  collection: RedisSuffix.vectorCollection,
  payload: 'payload',
  approximate: 'approximate',
  exact: 'exact',
  score: '__distance',
  params: 'PARAMS',
  sortby: 'SORTBY',
  asc: 'ASC',
  return: 'RETURN',
  dialect: 'DIALECT',
  query: 'query',
  /** FT.INFO field that stays non-zero while the index's background keyspace scan runs. */
  indexing: 'indexing',
  /** First poll delay while waiting for a background scan; doubles up to `scanPollMaxMs`. */
  scanPollMs: 1,
  /** Upper bound of the scan poll delay, so a finished scan is noticed within this many ms. */
  scanPollMaxMs: 50,
  cosine: 'COSINE',
  dot: 'IP',
  euclid: 'L2'
} as const
/** One canonical portable codec preserves arbitrary collection/id strings without shrinking D-KEY. */
const utf8 = new TextEncoder(),
  text = new TextDecoder('utf-8', { fatal: true })
/** Each collection's index covers every organization, with org filtering performed before ranking. */
export function vectorNames(layout: ReturnType<typeof createRedisLayout>, collection: string) {
  const prefix = layout.vectorPrefix(collection)
  return {
    index: layout.vectorIndex(collection),
    prefix,
    point: (id: string) => layout.vectorPoint(collection, id)
  }
}
/** Driver binary replies preserve the exact native bytes; only protocol text is decoded as UTF-8. */
export function vectorText(value: unknown): string {
  try {
    if (typeof value === 'string') return value
    if (isUint8Array(value)) return text.decode(value)
  } catch (cause) {
    throw redisError(RedisErrorCode.decodeFailed, cause)
  }
  throw redisError(RedisErrorCode.decodeFailed, value)
}
/** Fixed command maps admit native RESP2 pairs and RESP3 maps without coercing arbitrary values. */
export function vectorMap(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length % 2) throw redisError(RedisErrorCode.decodeFailed, value)
    const result: Record<string, unknown> = Object.create(null)
    for (let index = 0; index < value.length; index += 2) {
      const key = vectorText(value[index])
      if (Object.hasOwn(result, key)) throw redisError(RedisErrorCode.decodeFailed, value)
      result[key] = value[index + 1]
    }
    return result
  }
  if (value && typeof value === 'object' && !isUint8Array(value))
    return value as Record<string, unknown>
  throw redisError(RedisErrorCode.decodeFailed, value)
}
/** Native schemas remain authoritative; this projection is reconstructed from FT.INFO each time. */
export type IRedisVectorSchema = {
  readonly configuration: IStorageVectorConfiguration
  readonly fields: ReadonlySet<string>
}
/**
 * Queries pass this to `resolveVectorSchema` so ranking starts only after the index finished its
 * background scan. The signal is the caller's operation signal and cancels the wait.
 */
export type IRedisVectorSettle = { readonly signal: IAbortSignal | undefined }
/** Reads the FT.INFO `indexing` flag, which RESP2 and RESP3 replies encode differently. */
function vectorIndexing(info: Record<string, unknown>): boolean {
  const raw = info[RedisVector.indexing],
    flag = typeof raw === 'number' ? raw : Number(vectorText(raw))
  if (!Number.isFinite(flag)) throw redisError(RedisErrorCode.decodeFailed, info)
  return flag !== 0
}
/**
 * Waits until the index finished the background keyspace scan started by FT.CREATE or FT.ALTER. On
 * Redis 8, a point written while that scan runs can be missing from query results until the scan
 * passes it, so a query issued during the scan would silently return too few hits. The wait polls
 * FT.INFO with a doubling delay and returns the settled reply; it costs no extra command when the
 * index is not scanning. Aborting the signal rejects with the signal's reason.
 */
async function settleVectorIndex(
  connection: IRedisConnection,
  index: string,
  info: Record<string, unknown>,
  signal: IAbortSignal | undefined
): Promise<Record<string, unknown>> {
  let delay: number = RedisVector.scanPollMs
  while (vectorIndexing(info)) {
    await sleep(delay, { signal })
    delay = Math.min(delay * 2, RedisVector.scanPollMaxMs)
    info = vectorMap(await connection.command([RedisVector.info, index]))
  }
  return info
}
/**
 * Missing native indices are distinguished by the server's existing index listing, not error text.
 * With `settle`, the returned schema is read only after the index's background scan finished.
 */
export async function resolveVectorSchema(
  connection: IRedisConnection,
  layout: ReturnType<typeof createRedisLayout>,
  name: string,
  expected?: IStorageVectorConfiguration,
  settle?: IRedisVectorSettle
): Promise<IRedisVectorSchema> {
  const names = vectorNames(layout, name),
    indices = await connection.command([RedisVector.list])
  if (!Array.isArray(indices)) throw redisError(RedisErrorCode.decodeFailed, indices)
  if (!indices.map(vectorText).includes(names.index)) {
    if (!expected) throw invalidArgument()
    const args = [
      RedisVector.create,
      names.index,
      RedisVector.on,
      RedisVector.hash,
      RedisVector.prefix,
      '1',
      names.prefix,
      RedisVector.schema,
      RedisVector.org,
      RedisVector.tag,
      RedisVector.separator,
      '|',
      RedisVector.sample,
      RedisVector.tag,
      RedisVector.separator,
      '|',
      RedisVector.expiry,
      RedisVector.numeric
    ]
    for (const [field, algorithm] of [
      [RedisVector.approximate, RedisVector.hnsw],
      [RedisVector.exact, RedisVector.flat]
    ] as const)
      args.push(
        field,
        RedisVector.vector,
        algorithm,
        '6',
        RedisVector.type,
        RedisVector.float,
        RedisVector.dim,
        String(expected.dimensions),
        RedisVector.distance,
        RedisVector[expected.metric]
      )
    try {
      await connection.command(args)
    } catch (error) {
      // A concurrent creator is accepted only after its actual native schema is checked below.
      const current = await connection.command([RedisVector.list])
      if (!Array.isArray(current) || !current.map(vectorText).includes(names.index)) throw error
    }
  }
  let info = vectorMap(await connection.command([RedisVector.info, names.index]))
  if (settle !== undefined)
    info = await settleVectorIndex(connection, names.index, info, settle.signal)
  const attributes = info.attributes
  if (!Array.isArray(attributes)) throw redisError(RedisErrorCode.decodeFailed, info)
  const fields = new Set<string>()
  let configuration: IStorageVectorConfiguration | undefined
  for (const raw of attributes) {
    const attribute = vectorMap(raw),
      field = vectorText(attribute.identifier),
      kind = vectorText(attribute.type)
    fields.add(field)
    if (
      ((field === RedisVector.org || field === RedisVector.sample) && kind !== RedisVector.tag) ||
      (field === RedisVector.expiry && kind !== RedisVector.numeric)
    )
      throw invalidArgument()
    if (field === RedisVector.approximate || field === RedisVector.exact) {
      const metric = vectorText(attribute.distance_metric),
        dimensions =
          typeof attribute.dim === 'number' ? attribute.dim : Number(vectorText(attribute.dim)),
        algorithm = vectorText(attribute.algorithm)
      const next = {
        dimensions,
        metric:
          metric === RedisVector.cosine
            ? 'cosine'
            : metric === RedisVector.dot
              ? 'dot'
              : metric === RedisVector.euclid
                ? 'euclid'
                : undefined
      } as const
      if (
        kind !== RedisVector.vector ||
        vectorText(attribute.data_type) !== RedisVector.float ||
        algorithm !== (field === RedisVector.exact ? RedisVector.flat : RedisVector.hnsw) ||
        !Number.isSafeInteger(dimensions) ||
        dimensions < 1 ||
        !next.metric
      )
        throw invalidArgument()
      if (
        configuration &&
        (next.dimensions !== configuration.dimensions || next.metric !== configuration.metric)
      )
        throw invalidArgument()
      configuration = { dimensions, metric: next.metric }
    }
  }
  if (
    !configuration ||
    ![
      RedisVector.org,
      RedisVector.sample,
      RedisVector.expiry,
      RedisVector.approximate,
      RedisVector.exact
    ].every((field) => fields.has(field))
  )
    throw invalidArgument()
  if (
    expected &&
    (expected.dimensions !== configuration.dimensions || expected.metric !== configuration.metric)
  )
    throw invalidArgument()
  return { configuration, fields }
}
/** FLOAT32 is the native engine's storage domain; overflow is rejected before any HASH modification. */
export function vectorBytes(values: readonly number[]): Uint8Array {
  const result = new Uint8Array(values.length * 4),
    view = new DataView(result.buffer)
  for (let index = 0; index < values.length; index++) {
    const value = Math.fround(values[index]!)
    if (!Number.isFinite(value)) throw invalidArgument()
    view.setFloat32(index * 4, value, true)
  }
  return result
}
/** Samples read only native FLOAT32 bytes and never use a portable vector mirror. */
export function vectorValues(value: unknown, dimensions: number): readonly number[] {
  if (!isUint8Array(value) || value.length !== dimensions * 4)
    throw redisError(RedisErrorCode.decodeFailed, value)
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength),
    result: number[] = []
  for (let index = 0; index < dimensions; index++) {
    const number = view.getFloat32(index * 4, true)
    if (!Number.isFinite(number)) throw redisError(RedisErrorCode.decodeFailed, value)
    result.push(number)
  }
  return result
}
/** Portable payload values retain the standard codec as their sole persisted truth. */
export function payloadBytes(value: unknown): Uint8Array {
  return utf8.encode(encodeRedisValue('record', value))
}
/** Decoding retains the original package's error/cause boundary. */
export function payloadValue(value: unknown): unknown {
  return decodeRedisValue('record', vectorText(value))
}
/** Scalar field paths use original tuple JSON identity, with separate native type projections. */
export function vectorField(path: readonly string[], kind: 't' | 'n' | 'e'): string {
  return kind + redisPortableIdentity(path)
}
/**
 * A fixed-size native TAG projection avoids truncating long sample IDs. The original ID and key
 * remain complete; this digest is neither reversible nor a mathematical collision guarantee.
 */
export async function vectorSample(id: string): Promise<string> {
  return redisHex(
    new Uint8Array(
      await crypto.subtle.digest(RedisVector.digest, utf8.encode(encodeRedisValue('text', id)))
    )
  )
}
/** TAG values are nonempty ASCII identity strings, with no tokenization or escaping ambiguity. */
export function vectorTag(value: unknown): string {
  return 'x' + redisPortableIdentity(asCodecValue(value))
}
/**
 * Full payload traversal builds only scalar/presence native index projections, never another query
 * evaluator.
 */
export function vectorProjection(
  payload: ICodecValue | undefined
): ReadonlyMap<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  const visit = (value: ICodecValue, path: readonly string[]): void => {
    if (path.length) {
      result.set(vectorField(path, 'e'), utf8.encode('1'))
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        const tag = vectorTag(value)
        if (tag.length <= RedisVector.maxTagBytes)
          result.set(vectorField(path, 't'), utf8.encode(tag))
      }
      if (typeof value === 'number') result.set(vectorField(path, 'n'), utf8.encode(String(value)))
    }
    if (value && typeof value === 'object')
      for (const key of Object.keys(value)) visit(Reflect.get(value, key), [...path, key])
  }
  if (payload !== undefined) visit(payload, [])
  return result
}
/**
 * New scalar paths are registered on the real index before a point write; no schema registry is
 * added.
 */
export async function registerVectorFields(
  connection: IRedisConnection,
  index: string,
  schema: IRedisVectorSchema,
  fields: ReadonlyMap<string, Uint8Array>
): Promise<void> {
  for (const field of fields.keys()) {
    if (schema.fields.has(field)) continue
    try {
      await connection.command([
        RedisVector.alter,
        index,
        RedisVector.schema,
        RedisVector.add,
        field,
        field[0] === 'n' ? RedisVector.numeric : RedisVector.tag,
        ...(field[0] === 'n' ? [] : [RedisVector.separator, '|'])
      ])
    } catch (error) {
      const info = vectorMap(await connection.command([RedisVector.info, index]))
      if (
        !Array.isArray(info.attributes) ||
        !info.attributes.some((raw) => vectorText(vectorMap(raw).identifier) === field)
      )
        throw error
    }
  }
}
/** Faithful native comparison requires scalar equality or finite numeric range operands. */
export function vectorCondition(
  condition: IQueryCondition,
  fields?: ReadonlySet<string>
): string | undefined {
  const absent = '@' + RedisVector.org + ':{impossible}',
    present = (field: string, expression: string): string =>
      fields && !fields.has(field) ? absent : '@' + field + ':' + expression
  if (condition.kind === 'not') {
    const child = vectorCondition(condition.condition, fields)
    return child === undefined ? undefined : '-(' + child + ')'
  }
  if (condition.kind !== 'field') {
    const children = condition.conditions.map((item) => vectorCondition(item, fields))
    if (children.some((item) => item === undefined)) return undefined
    if (!children.length) return condition.kind === 'and' ? '-(' + absent + ')' : absent
    return '(' + children.join(condition.kind === 'and' ? ' ' : ' | ') + ')'
  }
  const { path, operator, value } = condition,
    tag = vectorField(path, 't'),
    numeric = vectorField(path, 'n'),
    exists = vectorField(path, 'e')
  const scalar = (input: unknown): boolean =>
    input === null ||
    typeof input === 'string' ||
    typeof input === 'boolean' ||
    (typeof input === 'number' && Number.isFinite(input))
  if ((operator === QueryOperator.eq || operator === QueryOperator.ne) && scalar(value)) {
    const encoded = vectorTag(value)
    if (encoded.length > RedisVector.maxTagBytes) return undefined
    const query = present(tag, '{' + encoded + '}')
    return operator === QueryOperator.ne ? '-(' + query + ')' : query
  }
  if (operator === QueryOperator.exists && typeof value === 'boolean') {
    const query = present(exists, '{1}')
    return value ? query : '-(' + query + ')'
  }
  if (operator === QueryOperator.in && Array.isArray(value) && value.every(scalar)) {
    const encoded = value.map(vectorTag)
    if (encoded.some((tag) => tag.length > RedisVector.maxTagBytes)) return undefined
    return encoded.length
      ? '(' + encoded.map((item) => present(tag, '{' + item + '}')).join(' | ') + ')'
      : absent
  }
  if (
    [QueryOperator.gt, QueryOperator.gte, QueryOperator.lt, QueryOperator.lte].includes(
      operator as 'gt'
    ) &&
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    return present(
      numeric,
      '[' +
        (operator === QueryOperator.gt
          ? '(' + value
          : operator === QueryOperator.gte
            ? value
            : '-inf') +
        ' ' +
        (operator === QueryOperator.lt
          ? '(' + value
          : operator === QueryOperator.lte
            ? value
            : '+inf') +
        ']'
    )
  if (
    operator === QueryOperator.between &&
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
    return present(numeric, '[' + value[0] + ' ' + value[1] + ']')
  return undefined
}
/** One actual FT.SEARCH result is decoded as native RESP2 or RESP3, preserving only returned hits. */
export function vectorRows(
  reply: unknown
): readonly { readonly key: string; readonly fields: ReadonlyMap<string, Uint8Array> }[] {
  if (Array.isArray(reply) && typeof reply[0] === 'number') {
    if (reply.length < 1 || (reply.length - 1) % 2 || !Number.isSafeInteger(Number(reply[0])))
      throw redisError(RedisErrorCode.decodeFailed, reply)
    const rows: { key: string; fields: ReadonlyMap<string, Uint8Array> }[] = []
    for (let index = 1; index < reply.length; index += 2)
      rows.push({ key: vectorText(reply[index]), fields: readRedisHash(reply[index + 1]) })
    return rows
  }
  const result = vectorMap(reply)
  if (!Array.isArray(result.results) || !Number.isSafeInteger(result.total_results))
    throw redisError(RedisErrorCode.decodeFailed, reply)
  return result.results.map((raw) => {
    const row = vectorMap(raw)
    return { key: vectorText(row.id), fields: readRedisHash(row.extra_attributes) }
  })
}
/** Query and maintenance reads use the original binary port on this exact native connection. */
export async function vectorSend(
  connection: IRedisConnection,
  args: readonly (string | Uint8Array)[]
): Promise<unknown> {
  if (!connection.binaryCommand) unsupported()
  return connection.binaryCommand(args)
}
/** Native point identity is validated against its exact managed key before data is returned. */
export function vectorPoint(
  fields: ReadonlyMap<string, Uint8Array>,
  collection: string,
  physical: string,
  names: ReturnType<typeof vectorNames>
): { id: string; payload?: unknown } {
  const id = payloadValue(fields.get(RedisVector.id)),
    storedCollection = payloadValue(fields.get(RedisVector.collection))
  if (typeof id !== 'string' || storedCollection !== collection || names.point(id) !== physical)
    throw redisError(RedisErrorCode.decodeFailed, fields)
  return {
    id,
    ...(fields.has(RedisVector.payload)
      ? { payload: payloadValue(fields.get(RedisVector.payload)) }
      : {})
  }
}
/** Projection updates encode the database deadline and actual native HASH TTL in the same EXEC. */
export function vectorExpiry(
  fields: ReadonlyMap<string, Uint8Array>,
  deadline: number
): ReadonlyMap<string, Uint8Array> {
  const result = new Map(fields)
  result.set(RedisVector.expiry, utf8.encode(String(deadline)))
  return result
}
/** Fixed protocol text values are detached before the native draft accepts them. */
export function vectorString(value: string): Uint8Array {
  return utf8.encode(value)
}
