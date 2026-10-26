/** Execute the original bounded capture/whole-backing digest algorithm outside contract. */
import { bytesToBase64 } from '@migaia/utils/bytes'
import type { IRpcEnvelope, IRpcBinaryManifest } from '@migaia/rpc-contract/protocol'
import { BinaryShape, RPC_BINARY_MAX_BYTES } from './binary-shape.js'
import { captureRpcBinary } from './binary-capture.js'
import { RpcBinaryProfile, RpcBinaryStorage } from './binary-constants.js'
import type { IRpcBinaryOptions, IRpcPreparedBinary } from './binary-types.js'
export { restoreRpcBinary } from './binary-restore.js'
export { RpcBinaryStorage, RpcBinaryProfile } from './binary-constants.js'
export type * from './binary-types.js'

/** Canonical unpadded base64url delegates byte conversion to the existing native-neutral utility. */
export function encodeBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** Synchronous capture precedes the first digest Promise and retains original backing identities. */
export function prepareRpcBinary(
  message: IRpcEnvelope,
  options: IRpcBinaryOptions
): Promise<IRpcPreparedBinary> {
  try {
    /** One operation-local shape owner retains the original error presentation and byte bound. */
    const shape = new BinaryShape(options.limit, options.errorMetadata)
    /** Actual graph capture happens before this public call can yield. */
    const capture = captureRpcBinary(
      message,
      options.storage,
      options.limit ?? RPC_BINARY_MAX_BYTES,
      options.digest,
      options.encoding,
      encodeBytes,
      options.errorMetadata,
      undefined,
      options.transferRequiresIntegrity,
      options.transfer
    )
    return finishRpcBinaryCapture(capture, options, shape)
  } catch (cause) {
    try {
      return new BinaryShape(options.limit, options.errorMetadata).invalid(cause)
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

/**
 * Finish exactly the captured graph once; no caller payload is reread after native digest
 * suspension.
 */
export async function finishRpcBinaryCapture(
  capture: import('./binary-types.js').IRpcBinaryCapture,
  options: IRpcBinaryOptions,
  shape: BinaryShape
): Promise<IRpcPreparedBinary> {
  try {
    if (options.storage === RpcBinaryStorage.native && options.beforeDigest) {
      /** The existing prehash hook receives exact lengths before a digest could detach storage. */
      const pending: IRpcBinaryManifest = {
        profile: RpcBinaryProfile,
        storage: options.storage,
        envelope: capture.envelope,
        backings: capture.backings.map((backing) =>
          backing.data !== undefined || !options.transferRequiresIntegrity
            ? backing
            : { ...backing, sha256: '0'.repeat(64) }
        )
      }
      options.encoding?.capture(pending, capture.capturedRoots!)
      ;(0, options.beforeDigest)(pending, capture.backingBytes)
    }
    /**
     * Each native hash covers its complete original backing, including bytes outside referenced
     * views.
     */
    const backings: IRpcBinaryManifest['backings'][number][] = []
    /** Only logical native rows consume the next original physical sidecar. */
    let physical = 0
    for (const row of capture.backings) {
      if (row.data !== undefined) {
        backings.push(row)
        continue
      }
      /** Validate the retained complete backing before invoking the one operation's digest. */
      const backing = capture.sidecars[physical++]!
      if (shape.backingLength(backing) !== row.byteLength) shape.integrity()
      if (options.transferRequiresIntegrity) {
        /** Configuration lends a receiverless callback; native crypto retains its own wrapper. */
        const digest = options.digest!
        backings.push(Object.freeze({ ...row, sha256: shape.digest(await digest(backing)) }))
      } else backings.push(row)
    }
    /** Only newly constructed metadata is frozen; original buffers/views remain borrowed untouched. */
    const manifest: IRpcBinaryManifest = Object.freeze({
      profile: RpcBinaryProfile,
      storage: options.storage,
      envelope: capture.envelope,
      backings: Object.freeze(backings)
    })
    if (options.encoding && capture.capturedRoots)
      options.encoding.capture(manifest, capture.capturedRoots)
    return Object.freeze({
      manifest,
      sidecars: Object.freeze(capture.sidecars),
      backingBytes: capture.backingBytes
    })
  } catch (cause) {
    shape.invalid(cause)
  }
}
