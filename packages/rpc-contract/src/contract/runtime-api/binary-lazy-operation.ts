import {
  prepareRpcBinaryLazy as prepareCanonicalBinaryLazy,
  restoreRpcBinaryLazy,
  restoreRpcBinaryDecodedLazy
} from './binary-lazy.js'
import { rejectRpcBinaryPreparation } from './binary-capture.js'
import type { IRpcBinaryDigest, IRpcPreparedBinary } from './binary-capture.js'
import { binaryPreparationData } from './binary-data-codec.js'
import type { IRpcBinaryDataCodec } from './binary-data-codec.js'
import { RpcBinaryStorage } from './binary-constants.js'
import { RpcBatchPhysical } from '../wire-constants.js'
import type { IRpcRuntimeEnvelope } from './types.js'

export { restoreRpcBinaryLazy, restoreRpcBinaryDecodedLazy }
export type { IRpcBinaryDataCodec } from './binary-data-codec.js'
export type {
  IRpcBinaryBacking,
  IRpcBinaryDigest,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './binary-capture.js'
export { RpcBinaryProfile, RpcBinaryStorage, RpcNativeBinaryKind } from './binary-constants.js'

/**
 * Prepare through the same 16 MiB default budget, held codec and whole-backing digest contract as
 * the ordinary binary entry. Capture and the first native digest begin before cold codec loading;
 * the Promise resolves to the same frozen manifest/list shape or rejects with the original cause
 * reachable. Module loading adds no authentication, replay or physical-transfer authority.
 */
export function prepareRpcBinaryLazy(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  codec?: IRpcBinaryDataCodec
): Promise<IRpcPreparedBinary> {
  try {
    /** A held codec supplies ordinary data operations, never prehash/finish coordination callbacks. */
    const data = binaryPreparationData(codec, limit)
    return prepareCanonicalBinaryLazy(
      message,
      storage,
      limit,
      digest,
      data.beforeDigest,
      data.encoding
    )
  } catch (cause) {
    return rejectRpcBinaryPreparation(cause)
  }
}
