import type { IPgCopyTarget, IPgCopyOptions } from './types.ts'
import { invalidArgument } from './errors.ts'
import { PostgresErrorText } from './error-text.ts'
/**
 * PostgreSQL identifier quoting belongs to this native DDL/protocol mapping; user SQL uses the
 * shared tag.
 */
export function quotePgIdentifier(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !value.isWellFormed()
  )
    throw invalidArgument(new TypeError(PostgresErrorText.invalidIdentifier))
  return '"' + value.replaceAll('"', '""') + '"'
}
/**
 * COPY requires native option literals rather than bind parameters, under
 * standard_conforming_strings.
 */
function literal(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
}
/** One structured COPY writer is shared by every driver; it never accepts file/PROGRAM SQL. */
export function copyCommand(target: IPgCopyTarget, options: IPgCopyOptions): string {
  const table = target.table
  const columns = target.columns
  const {
    format = 'csv',
    header = false,
    delimiter = format === 'csv' ? ',' : '\t',
    null: nullValue
  } = options
  if (
    !Array.isArray(table) ||
    table.length === 0 ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    (format !== 'csv' && format !== 'text') ||
    typeof header !== 'boolean' ||
    (format === 'text' && header) ||
    typeof delimiter !== 'string' ||
    new TextEncoder().encode(delimiter).length !== 1 ||
    delimiter === '\0' ||
    delimiter === '\n' ||
    delimiter === '\r' ||
    (nullValue !== undefined && (typeof nullValue !== 'string' || nullValue.includes('\0')))
  )
    throw invalidArgument(new TypeError(PostgresErrorText.invalidArgument))
  return (
    'COPY ' +
    table.map(quotePgIdentifier).join('.') +
    ' (' +
    columns.map(quotePgIdentifier).join(', ') +
    ') FROM STDIN WITH (FORMAT ' +
    format +
    ', HEADER ' +
    String(header) +
    ', DELIMITER ' +
    literal(delimiter) +
    (nullValue === undefined ? '' : ', NULL ' + literal(nullValue)) +
    ')'
  )
}
