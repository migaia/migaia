import { assertRpcNativeBinaryFrameSize } from './binary-frame.js'
import type { IRpcBinaryEncoding, IRpcBinaryManifest } from './binary-capture.js'
import { RpcBinaryStorage } from './binary-constants.js'

/**
 * A held codec resource encodes actual metadata. Its optional whole JSON-data capture consumes
 * canonical binary roots and owns its representation's quota policy; it grants no runtime
 * admission.
 */
export type IRpcBinaryDataCodec = Readonly<{
  /** Encode actual protected metadata for exact physical-size accounting when capture is absent. */
  encode(value: unknown): unknown
  /** Optional canonical whole-JSON capture; the resource owns its representation's quota policy. */
  captureJsonData?(value: object, roots: ReadonlyMap<object, number>, backingBytes: number): unknown
  /** Optional inline-byte spelling operation used by the same canonical binary preparation. */
  encodeInline?: (bytes: Uint8Array) => string
}>

/** Only the private canonical prepare machinery sees its original coordination callbacks. */
export type IRpcBinaryPreparationData = Readonly<{
  encoding?: IRpcBinaryEncoding
  beforeDigest?: (manifest: IRpcBinaryManifest, backingBytes: number) => void
}>

/** Adapt held data capabilities at their original capture and prehash points without exposing sinks. */
export function binaryPreparationData(
  codec: IRpcBinaryDataCodec | undefined,
  limit: number
): IRpcBinaryPreparationData {
  if (!codec) return {}
  /** Retain only the actual first native capture until its original byte total is delivered. */
  let pendingNativeCapture:
    | Readonly<{ manifest: IRpcBinaryManifest; roots: ReadonlyMap<object, number> }>
    | undefined
  /** The original capture byte total survives later backing detachment and the final manifest. */
  let nativeBackingBytes: number | undefined
  /** Only a real JSON-capture capability requests the original one-walk binary root accounting. */
  const encoding: IRpcBinaryEncoding | undefined = codec.captureJsonData
    ? {
        encodeInline: codec.encodeInline,
        capture: (manifest, roots) => {
          if (manifest.storage === RpcBinaryStorage.native && nativeBackingBytes === undefined)
            pendingNativeCapture = { manifest, roots }
          else codec.captureJsonData!(manifest, roots, nativeBackingBytes ?? 0)
        }
      }
    : undefined
  return {
    encoding,
    beforeDigest: encoding
      ? (_manifest, backingBytes) => {
          /** The canonical visitor delivers its original byte total before any digest can detach. */
          nativeBackingBytes = backingBytes
          if (pendingNativeCapture) {
            codec.captureJsonData!(
              pendingNativeCapture.manifest,
              pendingNativeCapture.roots,
              backingBytes
            )
            pendingNativeCapture = undefined
          }
        }
      : (manifest, backingBytes) => {
          /** Encode-only resources retain the original exact representation measurement. */
          const metadata = codec.encode(manifest)
          assertRpcNativeBinaryFrameSize(metadata, manifest.backings.length, backingBytes, limit)
        }
  }
}
