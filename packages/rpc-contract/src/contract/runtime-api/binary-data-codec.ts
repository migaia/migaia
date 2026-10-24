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

/** Own only the pending native capture between the canonical capture and prehash callbacks. */
class BinaryPreparationData {
  /** The original held codec remains the sole representation and quota authority. */
  #codec: IRpcBinaryDataCodec
  /** Physical accounting uses the caller's existing byte ceiling. */
  #limit: number
  /** The first native roots wait only until the original visitor publishes its byte total. */
  #pending:
    | Readonly<{ manifest: IRpcBinaryManifest; roots: ReadonlyMap<object, number> }>
    | undefined
  /** Preserve the prehash byte total even if a digest later detaches backing storage. */
  #backingBytes: number | undefined
  /** Stable coordination callbacks retain their original conditional presence. */
  readonly value: IRpcBinaryPreparationData

  /** Capture the original capabilities without reading or encoding any business data. */
  constructor(codec: IRpcBinaryDataCodec, limit: number) {
    this.#codec = codec
    this.#limit = limit
    /** Only a real JSON capability asks the canonical visitor to retain binary roots. */
    const encoding: IRpcBinaryEncoding | undefined = codec.captureJsonData
      ? { encodeInline: codec.encodeInline, capture: this.#capture }
      : undefined
    this.value = {
      encoding,
      beforeDigest: encoding ? this.#publishBackingBytes : this.#measure
    }
  }

  /** Preserve capture timing while waiting for the canonical native byte total when needed. */
  #capture = (manifest: IRpcBinaryManifest, roots: ReadonlyMap<object, number>): void => {
    if (manifest.storage === RpcBinaryStorage.native && this.#backingBytes === undefined)
      this.#pending = { manifest, roots }
    else this.#codec.captureJsonData!(manifest, roots, this.#backingBytes ?? 0)
  }

  /** Deliver the visitor's original total before digest work can detach native backing storage. */
  #publishBackingBytes = (_manifest: IRpcBinaryManifest, backingBytes: number): void => {
    this.#backingBytes = backingBytes
    if (this.#pending) {
      this.#codec.captureJsonData!(this.#pending.manifest, this.#pending.roots, backingBytes)
      this.#pending = undefined
    }
  }

  /** Encode-only codecs retain exact original physical-size accounting at the prehash boundary. */
  #measure = (manifest: IRpcBinaryManifest, backingBytes: number): void => {
    /** The held codec owns this representation; no substitute JSON sizing is introduced. */
    const metadata = this.#codec.encode(manifest)
    assertRpcNativeBinaryFrameSize(metadata, manifest.backings.length, backingBytes, this.#limit)
  }
}

/** Adapt the held codec at its original capture and prehash points without exposing sinks. */
export function binaryPreparationData(
  codec: IRpcBinaryDataCodec | undefined,
  limit: number
): IRpcBinaryPreparationData {
  return codec ? new BinaryPreparationData(codec, limit).value : {}
}
