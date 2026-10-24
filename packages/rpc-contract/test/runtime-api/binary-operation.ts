import { prepareRpcBinary as prepareCanonicalBinary } from '../../dist/contract/runtime-api/binary.js'
import { rejectRpcBinaryPreparation } from '../../dist/contract/runtime-api/binary-capture.js'
import type {
  IRpcBinaryDigest,
  IRpcPreparedBinary
} from '../../dist/contract/runtime-api/binary-capture.js'
import { binaryPreparationData } from '../../dist/contract/runtime-api/binary-data-codec.js'
import type { IRpcBinaryDataCodec } from '../../dist/contract/runtime-api/binary-data-codec.js'
import type { RpcBinaryStorage } from '../../dist/contract/runtime-api/binary-constants.js'
import { RpcBatchPhysical } from '../../dist/contract/wire-constants.js'
import type { IRpcRuntimeEnvelope } from '../../dist/contract/runtime-api/types.js'

/**
 * Adapt the fixture's actually held data codec to canonical binary preparation arguments.
 * Synchronous codec-admission failures use the same canonical rejected preparation boundary;
 * capture, digest, representation accounting and backing identity stay with production owners.
 */
export function prepareWithBinaryDataCodec(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  codec?: IRpcBinaryDataCodec
): Promise<IRpcPreparedBinary> {
  try {
    /** Data-resource adaptation adds no asynchronous stage before canonical capture. */
    const data = binaryPreparationData(codec, limit)
    return prepareCanonicalBinary(message, storage, limit, digest, data.beforeDigest, data.encoding)
  } catch (cause) {
    return rejectRpcBinaryPreparation(cause)
  }
}
