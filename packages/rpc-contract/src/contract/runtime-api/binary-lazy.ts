import {
  beforeRpcBinaryDigest,
  captureRpcBinary,
  rejectRpcBinaryPreparation,
  rpcBinaryBackingLength
} from './binary-capture.js'
import type {
  IRpcBinaryDigest,
  IRpcBinaryEncoding,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './binary-capture.js'
import { RpcBinaryStorage } from './binary-constants.js'
import type { IRpcRuntimeEnvelope } from './types.js'
import { RpcBatchPhysical } from '../wire-constants.js'

/** Only canonical implementation functions survive successful cold loading in this isolate. */
type IRpcBinaryCodec = typeof import('./binary.js')
/** A loaded implementation serves later operations directly, without another Promise wrapper. */
let codec: IRpcBinaryCodec | undefined
/** Concurrent cold operations share module loading, while retaining their own captured input. */
let loading: Promise<IRpcBinaryCodec> | undefined

/** Load one canonical codec; a failed import stays observable and permits a later cold replacement. */
function loadBinaryCodec(): Promise<IRpcBinaryCodec> {
  if (loading) return loading
  loading = import('./binary.js').then(
    (loaded) => {
      codec = loaded
      return loaded
    },
    (cause) => {
      loading = undefined
      throw cause
    }
  )
  return loading
}

/**
 * Capture bytes and native identity at the original synchronous point. Only the implementation
 * handoff waits; the first native digest starts before loading and later backings remain serial.
 */
export function prepareRpcBinaryLazy(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  beforeDigest?: (manifest: IRpcBinaryManifest, backingBytes: number) => void,
  encoding?: IRpcBinaryEncoding
): Promise<IRpcPreparedBinary> {
  try {
    if (codec)
      return codec.prepareRpcBinary(message, storage, limit, digest, beforeDigest, encoding)
    /** The sole canonical walk owns every byte snapshot before the first asynchronous boundary. */
    const captured = captureRpcBinary(message, storage, limit, digest, encoding, undefined)
    beforeRpcBinaryDigest(captured, storage, beforeDigest, encoding)
    if (storage === RpcBinaryStorage.native && captured.sidecars.length > 0) {
      /** Length is read before hashing, including when a digest callback detaches its backing. */
      const byteLength = rpcBinaryBackingLength(captured.sidecars[0]!)
      /** Promise.all observes rejection immediately while the original first digest is in flight. */
      const first = digest!(captured.sidecars[0]!)
      return Promise.all([first, loadBinaryCodec()]).then(
        ([sha256, loaded]) =>
          loaded.finishRpcBinaryCapture(captured, storage, digest, beforeDigest, encoding, {
            byteLength,
            sha256
          }),
        rejectRpcBinaryPreparation
      )
    }
    return loadBinaryCodec().then(
      (loaded) => loaded.finishRpcBinaryCapture(captured, storage, digest, beforeDigest, encoding),
      rejectRpcBinaryPreparation
    )
  } catch (cause) {
    return rejectRpcBinaryPreparation(cause)
  }
}

/**
 * Restore through the canonical binary validator after loading it if necessary. Sidecars default to
 * an empty list and the allocation budget to 16 MiB; native storage requires a whole-backing
 * digest. Grammar, budget and integrity failures reject as in the ordinary strict restore entry.
 */
export function restoreRpcBinaryLazy(
  value: unknown,
  storage: RpcBinaryStorage,
  sidecars: unknown = [],
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest
): Promise<IRpcRuntimeEnvelope> {
  if (codec) return codec.restoreRpcBinary(value, storage, sidecars, limit, digest)
  return loadBinaryCodec().then((loaded) =>
    loaded.restoreRpcBinary(value, storage, sidecars, limit, digest)
  )
}

/**
 * Restore only canonical codec output while preserving the existing cold/warm Promise schedule.
 * Reading own enumerable properties executes getters; this entry does not accept or validate
 * caller-constructed objects. Use this subpath's `restoreRpcBinary` strict entry instead. The
 * receive owner must select this entry from the actual canonical decoder's provenance.
 */
export function restoreRpcBinaryDecodedLazy(
  value: unknown,
  storage: RpcBinaryStorage,
  sidecars: unknown = [],
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest
): Promise<IRpcRuntimeEnvelope> {
  if (codec) return codec.restoreRpcBinaryDecoded(value, storage, sidecars, limit, digest)
  return loadBinaryCodec().then((loaded) =>
    loaded.restoreRpcBinaryDecoded(value, storage, sidecars, limit, digest)
  )
}
