import type { IRecordsApi } from '../capability.js'
import { defineStandardStorageCapability, invalidCapability } from '../capability-token.js'

/** Native and Feature records retain their exact original callable admission without querying. */
function validateRecords(value: unknown): void {
  /** Shape reads retain the original query-before-prefix order and reflected failures. */
  const api = value as IRecordsApi | undefined
  if (
    typeof api !== 'object' ||
    api === null ||
    typeof api.query !== 'function' ||
    typeof api.removeByPrefix !== 'function'
  )
    throw invalidCapability()
}

/** Standard records borrow the existing query constructor and transaction prefix operation. */
export const records = /* @__PURE__ */ defineStandardStorageCapability<IRecordsApi, 'records'>(
  'records',
  {
    validate: validateRecords,
    transaction: { query: true, methods: [] }
  }
)
