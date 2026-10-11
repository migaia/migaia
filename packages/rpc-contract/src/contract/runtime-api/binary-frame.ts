import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import { measureRpcNativeBinaryFrame } from './binary-capture.js'

/** Enforce actual native metadata, backing count and bytes using the sole physical measurement. */
export function assertRpcNativeBinaryFrameSize(
  protectedMetadata: unknown,
  sidecarCount: number,
  backingBytes: number,
  limit: number
): void {
  if (measureRpcNativeBinaryFrame(protectedMetadata, sidecarCount, backingBytes) > limit)
    throw createContractError(RpcContractErrorCode.frameLimitExceeded)
}
