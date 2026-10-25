import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'

/** Canonical UUID syntax preserves exact organization identity, including the reserved zero UUID. */
const storageOrgIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Validates organization syntax once without supplying a host default or changing letter case. */
export function assertStorageOrgId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length !== 36 || !storageOrgIdPattern.test(value))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.orgId)
    })
}
