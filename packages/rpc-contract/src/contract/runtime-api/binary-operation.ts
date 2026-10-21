import {
  prepareRpcBinary as prepareCanonicalBinary,
  restoreRpcBinary,
  restoreRpcBinaryDecoded,
  finishRpcBinaryCapture
} from './binary.js'
import { captureRpcBinary, invalid, rejectRpcBinaryPreparation } from './binary-capture.js'
import type { IRpcBinaryCapture, IRpcBinaryDigest, IRpcPreparedBinary } from './binary-capture.js'
import { binaryPreparationData } from './binary-data-codec.js'
import type { IRpcBinaryDataCodec, IRpcBinaryPreparationData } from './binary-data-codec.js'
import { RpcBinaryStorage } from './binary-constants.js'
import { RpcBatchPhysical } from '../wire-constants.js'
import type { IRpcRuntimeEnvelope } from './types.js'

export { restoreRpcBinary, restoreRpcBinaryDecoded }
export type { IRpcBinaryDataCodec } from './binary-data-codec.js'
export type {
  IRpcBinaryBacking,
  IRpcBinaryDigest,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './binary-capture.js'
export { RpcBinaryProfile, RpcBinaryStorage, RpcNativeBinaryKind } from './binary-constants.js'

/**
 * Snapshot binary-bearing runtime business data synchronously, then finish a frozen manifest and
 * backing list asynchronously. The default allocation budget is 16 MiB; native storage requires a
 * whole-backing digest and preserves original sidecar identity. An optional held codec owns exact
 * representation accounting. Invalid grammar, budgets or digest failures reject with the original
 * cause reachable; preparation grants no authentication or transfer authority.
 */
export function prepareRpcBinary(
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

/**
 * A caller can capture now and finish later without exposing mutable codec scratch or trusted
 * flags.
 */
export type IRpcCapturedBinaryData = Readonly<{
  /** Finish the captured graph/backings through the canonical digest/codec path; failures reject. */
  prepare(): Promise<IRpcPreparedBinary>
}>

/** This resource owns only the canonical captured protocol graph and its actual backing references. */
class CapturedBinaryData implements IRpcCapturedBinaryData {
  /** Keep the sole canonical walk's graph, sidecars and deferred inline bytes private. */
  #captured: IRpcBinaryCapture
  /** The selected wire representation remains the one used when bytes were captured. */
  #storage: RpcBinaryStorage
  /** The held digest operates on the original native backings when preparation begins. */
  #digest: IRpcBinaryDigest | undefined
  /** Internal data operations preserve the canonical capture/prehash/finish invocation points. */
  #data: IRpcBinaryPreparationData

  /** Capture synchronously; caller graph changes afterwards cannot alter captured inline data. */
  constructor(
    message: IRpcRuntimeEnvelope,
    storage: RpcBinaryStorage,
    limit: number,
    digest: IRpcBinaryDigest | undefined,
    codec: IRpcBinaryDataCodec | undefined
  ) {
    this.#storage = storage
    this.#digest = digest
    this.#data = binaryPreparationData(codec, limit)
    this.#captured = captureRpcBinary(
      message,
      storage,
      limit,
      digest,
      this.#data.encoding,
      undefined
    )
  }

  /** Complete the held protocol data through the single canonical finish implementation. */
  prepare(): Promise<IRpcPreparedBinary> {
    return finishRpcBinaryCapture(
      this.#captured,
      this.#storage,
      this.#digest,
      this.#data.beforeDigest,
      this.#data.encoding
    )
  }
}

/**
 * Capture one binary-bearing envelope synchronously for a later prepare call. Inline visible bytes
 * are snapshotted now; native sidecars retain original backing references until digest/preparation.
 * The default budget is 16 MiB. Invalid input throws INVALID_ENVELOPE with its cause, rather than
 * returning a rejected capture resource; this operation performs no physical transfer.
 */
export function captureRpcBinaryData(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  codec?: IRpcBinaryDataCodec
): IRpcCapturedBinaryData {
  try {
    return new CapturedBinaryData(message, storage, limit, digest, codec)
  } catch (cause) {
    invalid(cause)
  }
}
