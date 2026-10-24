import type { IQueryCondition, IVectorFilter, ISqlValue } from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object'
import type { IPgNativeParameter } from './types.js'
/** PostgreSQL JSON cannot contain NUL or isolated UTF-16 code units. */
export function pgJsonString(value: string): boolean {
  return !value.includes('\0') && value.isWellFormed()
}
/**
 * Scalar native equality preserves type; structural operands remain with the original client
 * compiler.
 */
function scalar(value: unknown): value is Exclude<ISqlValue, Uint8Array | bigint> {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && pgJsonString(value))
  )
}
/** Native paths reject array aliases whose PostgreSQL indexing semantics differ from own JS fields. */
function pathSupported(path: readonly string[]): boolean {
  return path.every(
    (part) =>
      pgJsonString(part) &&
      part !== 'length' &&
      (!/^-?\d+$/.test(part) || (/^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 2147483647))
  )
}
/** Translate only the canonical source AST; parsing and query evaluation remain with their owners. */
export function pgVectorCondition(
  condition: IQueryCondition,
  params: IPgNativeParameter[],
  column = 'projection'
): string | undefined {
  const bind = (value: IPgNativeParameter): string => {
    params.push(value)
    return '$' + params.length
  }
  if (condition.kind === 'and' || condition.kind === 'or') {
    const children = condition.conditions.map((child) => pgVectorCondition(child, params, column))
    if (children.some((child) => child === undefined)) return
    return children.length === 0
      ? condition.kind === 'and'
        ? 'TRUE'
        : 'FALSE'
      : '(' + children.join(condition.kind === 'and' ? ' AND ' : ' OR ') + ')'
  }
  if (condition.kind === 'not') {
    const child = pgVectorCondition(condition.condition, params, column)
    return child === undefined ? undefined : '(NOT ' + child + ')'
  }
  if (condition.kind !== 'field') return
  if (!pathSupported(condition.path)) return
  const path = bind({ arrayType: 'text', values: condition.path }) + '::text[]'
  const field = '(' + column + ' #> ' + path + ')'
  const equal = (value: unknown): string | undefined =>
    value === undefined
      ? field + ' IS NULL'
      : scalar(value)
        ? 'COALESCE(' + field + '=' + bind(JSON.stringify(value)) + '::jsonb,FALSE)'
        : undefined
  const { operator, value } = condition
  if (operator === 'exists') return '(' + field + (value ? ' IS NOT NULL' : ' IS NULL') + ')'
  if (operator === 'eq' || operator === 'ne') {
    const expression = equal(value)
    return expression === undefined
      ? undefined
      : '(' + (operator === 'ne' ? 'NOT ' : '') + expression + ')'
  }
  if (operator === 'in') {
    if (!Array.isArray(value)) return
    const children = value.map(equal)
    if (children.some((child) => child === undefined)) return
    return children.length === 0 ? 'FALSE' : '(' + children.join(' OR ') + ')'
  }
  if (operator === 'has')
    return scalar(value)
      ? 'COALESCE(jsonb_typeof(' +
          field +
          ")='array' AND " +
          field +
          ' @> ' +
          bind(JSON.stringify([value])) +
          '::jsonb,FALSE)'
      : undefined
  const number = '(' + field + " #>> '{}')::float8"
  const numeric = (expression: string) =>
    'COALESCE(CASE WHEN jsonb_typeof(' +
    field +
    ")='number' THEN " +
    expression +
    ' ELSE FALSE END,FALSE)'
  if (operator === 'between') {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    )
      return
    return numeric(number + '>=' + bind(value[0]) + ' AND ' + number + '<=' + bind(value[1]))
  }
  if (
    (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') &&
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    return numeric(
      number + ({ gt: '>', gte: '>=', lt: '<', lte: '<=' } as const)[operator] + bind(value)
    )
}
/**
 * This is the original declarative vector-filter vocabulary mapped into the same canonical
 * translator.
 */
export function pgVectorFilter(filter: IVectorFilter): IQueryCondition {
  if ('all' in filter) return { kind: 'and', conditions: filter.all.map(pgVectorFilter) }
  if ('any' in filter) return { kind: 'or', conditions: filter.any.map(pgVectorFilter) }
  if ('not' in filter) return { kind: 'not', condition: pgVectorFilter(filter.not) }
  const path = parseObjectPath(filter.field).map((segment) => String(segment))
  if ('eq' in filter) return { kind: 'field', path, operator: 'eq', value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: 'in', value: filter.in }
  const conditions: IQueryCondition[] = []
  if (filter.gte !== undefined)
    conditions.push({ kind: 'field', path, operator: 'gte', value: filter.gte })
  if (filter.lte !== undefined)
    conditions.push({ kind: 'field', path, operator: 'lte', value: filter.lte })
  return { kind: 'and', conditions }
}
/**
 * Projection is an optimization only: unsupported strings retain field presence without pretending
 * equality.
 */
export function pgVectorProjection(value: unknown): unknown {
  if (typeof value === 'string') return pgJsonString(value) ? value : {}
  if (Array.isArray(value)) return value.map(pgVectorProjection)
  if (value !== null && typeof value === 'object') {
    const result = Object.create(null)
    for (const key of Object.keys(value)) {
      if (pgJsonString(key)) result[key] = pgVectorProjection(Reflect.get(value, key))
    }
    return result
  }
  return value
}
