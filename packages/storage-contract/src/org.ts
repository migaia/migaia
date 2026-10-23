import type { IStorageKey } from './context.js'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import { snapshotStorageKey } from './key.js'

/** Canonical UUID syntax preserves exact organization identity, including the reserved zero UUID. */
const storageOrgIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The physical envelope marker is shared by wrapping and strict organization-aware unwrapping. */
const storageOrgKeyMarker = '$o'

/** Validates organization syntax once without supplying a host default or changing letter case. */
export function assertStorageOrgId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length !== 36 || !storageOrgIdPattern.test(value))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.orgId)
    })
}

/**
 * Wraps a detached logical key in one organization segment. Tuple keys remain nested in the third
 * slot so scalar and tuple identities stay distinct. The internal envelope does not consume the
 * logical key's depth or node budget.
 */
export const prefixStorageOrgKey = (
  orgId: string,
  key: IStorageKey,
  backend?: IBackendKind
): IStorageKey => {
  assertStorageOrgId(orgId)
  return [storageOrgKeyMarker, orgId, snapshotStorageKey(key, backend)]
}

/**
 * Checks the exact three-part envelope and organization before returning a detached logical key. A
 * malformed or foreign envelope throws INVALID_ARGUMENT; an invalid contained logical key retains
 * INVALID_KEY. Getter failures stay reachable as the original cause.
 */
export const unprefixStorageOrgKey = (orgId: string, key: IStorageKey): IStorageKey => {
  assertStorageOrgId(orgId)
  /** Captured envelope components prevent a changing getter from changing organization admission. */
  let marker: unknown
  /** Captured identity must match the requested organization exactly. */
  let capturedOrgId: unknown
  /** Only the contained logical key is subject to the public logical key-domain budget. */
  let logicalKey: unknown
  try {
    if (!Array.isArray(key) || key.length !== 3)
      throw new TypeError(StorageContractErrorText.orgKeyEnvelope)
    marker = key[0]
    capturedOrgId = key[1]
    logicalKey = key[2]
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (marker !== storageOrgKeyMarker || capturedOrgId !== orgId)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.orgKeyEnvelope)
    })
  return snapshotStorageKey(logicalKey, undefined)
}
