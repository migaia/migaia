import type { Schemas } from '@qdrant/js-client-rest'
import { QueryOperator, type IQueryCondition } from '@migaia/storage-contract'
import { projectedPath, projectedScalar } from './envelope.js'
import { QdrantText } from './constants.js'
/**
 * Native filter expressions are only produced when the original condition's full domain is
 * faithful.
 */
export type IQdrantFilter = Schemas['Filter']
/** Empty filter is true; negating it is the native constant false expression. */
const no: IQdrantFilter = { must_not: [{}] }
/** Shared AST identity and string comparison stay with the original client predicate owner. */
export function nativeCondition(condition: IQueryCondition): IQdrantFilter | undefined {
  if (condition.kind === 'not') {
    const child = nativeCondition(condition.condition)
    return child === undefined ? undefined : { must_not: [child] }
  }
  if (condition.kind !== 'field') {
    const children = condition.conditions.map(nativeCondition)
    if (children.some((child) => child === undefined)) return undefined
    return condition.kind === 'and'
      ? { must: children as IQdrantFilter[] }
      : children.length
        ? { should: children as IQdrantFilter[] }
        : no
  }
  const { path, operator, value } = condition,
    key = projectedPath(path),
    kind = key + '.kind',
    field = key + '.value'
  const equal = (operand: unknown): IQdrantFilter | undefined => {
    if (operand === undefined) return { must: [{ is_empty: { key: kind } }] }
    if (operand === null) return { must: [{ key: kind, match: { value: 'null' } }] }
    if (typeof operand === 'number')
      return Number.isFinite(operand)
        ? {
            must: [
              { key: kind, match: { value: 'number' } },
              { key: field, range: { gte: operand, lte: operand } }
            ]
          }
        : no
    if (typeof operand === 'string' || typeof operand === 'boolean')
      return {
        must: [
          { key: kind, match: { value: typeof operand } },
          { key: field, match: { value: projectedScalar(operand) } }
        ]
      }
    return undefined
  }
  if (operator === QueryOperator.exists)
    return value
      ? { must_not: [{ is_empty: { key: kind } }] }
      : { must: [{ is_empty: { key: kind } }] }
  if (operator === QueryOperator.eq || operator === QueryOperator.ne) {
    const expression = equal(value)
    return expression === undefined
      ? undefined
      : operator === QueryOperator.eq
        ? expression
        : { must_not: [expression] }
  }
  if (operator === QueryOperator.in) {
    const choices = (value as readonly unknown[]).map(equal)
    return choices.some((choice) => choice === undefined)
      ? undefined
      : choices.length
        ? { should: choices as IQdrantFilter[] }
        : no
  }
  if (operator === QueryOperator.has) {
    let member: IQdrantFilter
    if (typeof value === 'string' || typeof value === 'boolean')
      member = { must: [{ key: field, match: { value: projectedScalar(value) } }] }
    else if (typeof value === 'number' && Number.isFinite(value))
      member = { must: [{ key: field, range: { gte: value, lte: value } }] }
    else return undefined
    return { must: [{ key: kind, match: { value: 'array' } }, member] }
  }
  const range: Record<string, number> = {}
  if (operator === QueryOperator.between) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    )
      return undefined
    range.gte = value[0] as number
    range.lte = value[1] as number
  } else if (
    [QueryOperator.gt, QueryOperator.gte, QueryOperator.lt, QueryOperator.lte].includes(
      operator as 'gt'
    )
  ) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    range[operator] = value
  } else return undefined
  return {
    must: [
      { key: kind, match: { value: 'number' } },
      { key: field, range }
    ]
  }
}
/** Organization and liveness are always applied before native ranking. Deletion omits liveness. */
export function orgFilter(
  orgId: string,
  conditions: readonly IQdrantFilter[] = [],
  now?: number
): IQdrantFilter {
  return {
    must: [
      { key: JSON.stringify(QdrantText.org), match: { value: orgId } },
      ...conditions,
      ...(now === undefined
        ? []
        : [
            {
              should: [
                { is_empty: { key: JSON.stringify(QdrantText.expiresAt) } },
                {
                  key: JSON.stringify(QdrantText.expiresAt),
                  range: { gt: new Date(now).toISOString() }
                }
              ]
            }
          ])
    ]
  }
}
