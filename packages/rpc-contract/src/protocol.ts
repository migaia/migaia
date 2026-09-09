import { RpcContractErrorCode } from './error-code.js'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from './error-text.js'
import type { IRpcDescriptor } from './types.js'

/** Construct a frozen descriptor after validating stable lowercase token identity. */
export function createDescriptor<const TId extends string, const TVersion extends number>(
  id: TId,
  version: TVersion
): IRpcDescriptor<TId, TVersion> {
  if (!/^[a-z][a-z0-9.-]*$/u.test(id) || !Number.isSafeInteger(version) || version <= 0) {
    const error = new TypeError(RpcContractErrorText.invalidDescriptor)
    Object.defineProperty(error, 'source', { value: RPC_CONTRACT_SOURCE, enumerable: true })
    Object.defineProperty(error, 'code', {
      value: RpcContractErrorCode.invalidDescriptor,
      enumerable: true
    })
    throw error
  }
  return Object.freeze({ id, version })
}
