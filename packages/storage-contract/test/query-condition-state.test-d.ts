import { expectTypeOf } from 'vitest'
import type { IQueryConditions } from '../src/index.js'

/** A finite type projection preserves the adapter state without changing canonical operand domains. */
function exactConditionState(
  query: IQueryConditions<{ group?: string; total: number }, { readonly terminal: true }>
): void {
  expectTypeOf(query.where({ total: { gt: 1 } })).toEqualTypeOf<{ readonly terminal: true }>()
  expectTypeOf(query.where('group', 'eq', undefined)).toEqualTypeOf<{ readonly terminal: true }>()
  expectTypeOf(query.where((row) => row.total > 1)).toEqualTypeOf<{ readonly terminal: true }>()
  // @ts-expect-error Only actual domain paths are accepted by the original condition type.
  query.where('missing', 'eq', 1)
  // @ts-expect-error Numeric fields do not gain the string startsWith operator.
  query.where('total', 'startsWith', '1')
  // @ts-expect-error Predicates retain their original synchronous boolean contract.
  query.where(async (row) => row.total > 1)
}
void exactConditionState
