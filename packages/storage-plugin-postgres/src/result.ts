import type { ISqlRow, ISqlValue } from '@migaia/storage-contract'
import { postgresError } from './errors.js'
import { PostgresErrorCode } from './error-code.js'
import { PostgresErrorText } from './error-text.js'
/** PostgreSQL's fixed wire OIDs distinguish scalars that must never share a lossy JS parser. */
const PgOid = {
  boolean: 16,
  bytes: 17,
  int8: 20,
  int2: 21,
  int4: 23,
  oid: 26,
  float4: 700,
  float8: 701
} as const
/** Only real native column metadata enters the common driver result projection. */
export type IPgColumn = { readonly name: string; readonly type: number }
/**
 * Text bytea preserves both supported native output formats without loading a client at package
 * root.
 */
function bytea(value: string): Uint8Array {
  if (value.startsWith('\\x')) {
    const data = value.slice(2)
    if (data.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(data))
      throw postgresError(PostgresErrorCode.sqlFailed, new TypeError(PostgresErrorText.invalidRow))
    return Uint8Array.from({ length: data.length / 2 }, (_, index) =>
      Number.parseInt(data.slice(index * 2, index * 2 + 2), 16)
    )
  }
  const bytes: number[] = []
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '\\') {
      bytes.push(value.charCodeAt(index))
      continue
    }
    if (value[index + 1] === '\\') {
      bytes.push(92)
      index++
      continue
    }
    bytes.push(Number.parseInt(value.slice(index + 1, index + 4), 8))
    index += 3
  }
  return Uint8Array.from(bytes)
}
/** Parse native text once using the actual OID; other values intentionally remain native strings. */
export function decodePgColumn(type: number, value: unknown): ISqlValue {
  if (value === null) return null
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Uint8Array
        ? new TextDecoder().decode(value)
        : undefined
  if (text === undefined)
    throw postgresError(PostgresErrorCode.sqlFailed, new TypeError(PostgresErrorText.invalidRow))
  if (type === PgOid.bytes) return bytea(text)
  if (type === PgOid.boolean) return text === 't'
  if (type === PgOid.int8) return BigInt(text)
  if (
    type === PgOid.int2 ||
    type === PgOid.int4 ||
    type === PgOid.oid ||
    type === PgOid.float4 ||
    type === PgOid.float8
  )
    return Number(text)
  return text
}
/** Driver row projection retains duplicate-name last-wins semantics and safe **proto** data columns. */
export function decodePgRows(
  columns: readonly IPgColumn[],
  rows: readonly (readonly unknown[])[]
): readonly ISqlRow[] {
  return rows.map((values) => {
    const result: Record<string, ISqlValue> = Object.create(null)
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]!
      result[column.name] = decodePgColumn(column.type, values[index])
    }
    return result
  })
}
