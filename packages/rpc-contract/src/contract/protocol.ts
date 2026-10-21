import { RpcContractErrorCode } from './error-code.js'
import { createContractError } from './contract-error.js'
import type { IRpcDescriptor } from './types.js'

/**
 * Construct a frozen component descriptor from a lowercase token and positive safe-integer version.
 * Use this for codec/framer component identity, independently of protocol negotiation; invalid
 * arguments throw INVALID_DESCRIPTOR before a descriptor is exposed.
 */
export function createDescriptor<const TId extends string, const TVersion extends number>(
  id: TId,
  version: TVersion
): IRpcDescriptor<TId, TVersion> {
  if (!/^[a-z][a-z0-9.-]*$/u.test(id) || !Number.isSafeInteger(version) || version <= 0) {
    throw createContractError(RpcContractErrorCode.invalidDescriptor)
  }
  return Object.freeze({ id, version })
}
