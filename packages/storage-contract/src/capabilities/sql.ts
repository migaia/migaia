import type { ISqlExecutor } from '../sql.js'
import { defineStandardStorageCapability, invalidCapability } from '../capability-token.js'

/** SQL publication validates the nested tag shape without compiling or executing native input. */
function validateSqlApi(api: unknown): void {
  if (typeof api !== 'object' || api === null) throw invalidCapability()
  /** The backend owns the tag; only callable tools and an object fragment are promised here. */
  const tag = (api as ISqlExecutor).sql
  if (typeof tag !== 'function') throw invalidCapability()
  /** Fragment identity is checked by the SQL owner when composed, without running a query here. */
  const empty = tag.empty
  if (
    typeof tag.id !== 'function' ||
    typeof tag.join !== 'function' ||
    typeof empty !== 'object' ||
    empty === null
  )
    throw invalidCapability()
}
/** Standard SQL keeps native execution nested and projects through the original transaction owner. */
export const sql = /* @__PURE__ */ defineStandardStorageCapability<ISqlExecutor, 'sql'>('sql', {
  validate: validateSqlApi,
  transaction: { methods: [], sql: true }
})
