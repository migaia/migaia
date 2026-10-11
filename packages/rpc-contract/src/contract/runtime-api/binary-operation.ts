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

/** Prepare protocol data with the actual held codec; raw coordination callbacks remain private. */
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

/** Capture one binary-bearing envelope at a caller-selected synchronous snapshot point. */
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
