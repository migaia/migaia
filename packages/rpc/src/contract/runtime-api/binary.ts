import {
  invalid,
  invalidIntegrity,
  rpcBinaryBackingLength,
  array,
  record,
  budget,
  integer,
  digestString,
  captureRpcBinary,
  keys,
  completeRpcBinaryCapture,
  beforeRpcBinaryDigest,
  rejectRpcBinaryPreparation
} from './binary-capture.js'
import type {
  IRpcBinaryDigest,
  IRpcBinaryBacking,
  IRpcBinaryManifest,
  IRpcPreparedBinary,
  IRpcBinaryEncoding,
  IRpcBinaryCapture
} from './binary-capture.js'
export {
  hasRpcBinaryEnvelope,
  isRpcBinaryIntegrityFailure,
  rpcBinaryBackingLength,
  measureRpcNativeBinaryFrame,
  readRpcNativeBinary,
  rpcBinaryView
} from './binary-capture.js'
export type {
  IRpcBinaryDigest,
  IRpcBinaryBacking,
  IRpcBinaryManifest,
  IRpcPreparedBinary
} from './binary-capture.js'
import { isArrayBuffer, bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import {
  hasRpcPortableBinary,
  markRpcPortableBinary,
  RPC_PORTABLE_MAX_DEPTH
} from '../normalize.js'
import { RpcBatchPhysical } from '../wire-constants.js'
import { compareRpcFieldNames } from '../v1/route.js'
import type { IRpcPortableValue } from '../types.js'
import { normalizeRuntimeEnvelope } from './normalize.js'
import type { IRpcRuntimeEnvelope } from './types.js'
import {
  RpcBinaryProfile,
  RpcBinaryStorage,
  RpcBinaryField as F,
  RpcBinaryTag as T
} from './binary-constants.js'

/** Encode the canonical unpadded spelling through the existing base64 implementation. */
function encodeBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** Decode only canonical unpadded base64url, retaining the underlying decoder's cause. */
function decodeBytes(value: unknown, offset = 0): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1)
    invalid()
  /** The original decoder writes into the final view, avoiding a temporary backing plus copy. */
  const encoded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  if (offset === 0) return base64ToBytes(encoded)
  /** The original caller has already charged this full zero-prefix allocation to its byte budget. */
  const length = Math.floor((value.length * 3) / 4)
  const backing = new ArrayBuffer(offset + length)
  return base64ToBytes(encoded, new Uint8Array(backing, offset, length))
}

/**
 * Tag only business data using the original closed runtime-envelope grammar. The synchronous graph
 * snapshot and complete byte budget precede every native hash or asynchronous transform.
 */
export function prepareRpcBinary(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  beforeDigest?: (manifest: IRpcBinaryManifest, backingBytes: number) => void,
  encoding?: IRpcBinaryEncoding
): Promise<IRpcPreparedBinary> {
  try {
    /** The canonical capture runs before the returned preparation Promise can yield. */
    const captured = captureRpcBinary(message, storage, limit, digest, encoding, encodeBytes)
    return finishRpcBinaryCapture(captured, storage, digest, beforeDigest, encoding)
  } catch (cause) {
    return rejectRpcBinaryPreparation(cause)
  }
}

/** Keep one asynchronous finish over the exact graph/backings captured by the original owner. */
export async function finishRpcBinaryCapture(
  captured: IRpcBinaryCapture,
  storage: RpcBinaryStorage,
  digest: IRpcBinaryDigest | undefined,
  beforeDigest: ((manifest: IRpcBinaryManifest, backingBytes: number) => void) | undefined,
  encoding: IRpcBinaryEncoding | undefined,
  firstDigest?: IRpcBinaryBacking
): Promise<IRpcPreparedBinary> {
  try {
    completeRpcBinaryCapture(captured, encodeBytes)
    beforeRpcBinaryDigest(captured, storage, beforeDigest, encoding)
    const { envelope, sidecars, backingBytes, capturedRoots } = captured

    /** All hashes cover complete original backings after the synchronous graph/budget checks. */
    const backings: IRpcBinaryBacking[] = []
    for (const backing of sidecars)
      backings.push(
        Object.freeze({
          byteLength:
            backings.length === 0 && firstDigest !== undefined
              ? firstDigest.byteLength
              : rpcBinaryBackingLength(backing),
          sha256: digestString(
            backings.length === 0 && firstDigest !== undefined
              ? firstDigest.sha256
              : await digest!(backing)
          )
        })
      )
    /** The visible public result retains its original fields, prototypes and insertion order. */
    const manifest: IRpcBinaryManifest = Object.freeze({
      profile: RpcBinaryProfile,
      storage,
      envelope,
      backings: Object.freeze(backings)
    })
    if (encoding && capturedRoots) encoding.capture(manifest, capturedRoots)
    return Object.freeze({
      manifest,
      sidecars: Object.freeze(sidecars),
      backingBytes
    })
  } catch (cause) {
    invalid(cause)
  }
}

/**
 * Restore one completely validated manifest. Native digests finish before this result can be
 * committed by the original authentication owner; no replay or provider state exists in this
 * codec.
 */
export async function restoreRpcBinary(
  value: unknown,
  storage: RpcBinaryStorage,
  sidecarInput: unknown = [],
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest
): Promise<IRpcRuntimeEnvelope> {
  try {
    /** Manifest storage/profile and every field are closed before native buffers are read or hashed. */
    const manifest = record(value, [F.profile, F.storage, F.envelope, F.backings])
    if (manifest.profile !== RpcBinaryProfile || manifest.storage !== storage) invalid()
    /** Dense unique native sidecars have no index holes or extra application-controlled fields. */
    const sidecars = array(sidecarInput)
    /** Full-backing metadata is checked before any expensive digest. */
    const backings = array(manifest.backings)
    if (
      sidecars.length !== backings.length ||
      (storage === RpcBinaryStorage.inline && backings.length)
    )
      invalid()
    /** Every restored inline allocation and complete unique sidecar counts, including view prefixes. */
    const consume = budget(limit)
    /** A backing identity may appear in multiple refs but only once in the physical sidecar list. */
    const unique = new Set<ArrayBuffer>()
    /** At least one business reference must use every native manifest backing. */
    const used = new Set<number>()
    /** Admission retains only the exact checked digest/length for the forthcoming comparison. */
    const metadata: IRpcBinaryBacking[] = []
    for (let index = 0; index < backings.length; index++) {
      const backing = sidecars[index]
      if (!isArrayBuffer(backing) || unique.has(backing)) invalid()
      unique.add(backing)
      const data = record(backings[index], [F.byteLength, F.sha256])
      const length = integer(data.byteLength)
      if (length !== rpcBinaryBackingLength(backing)) invalidIntegrity()
      consume(length)
      metadata.push({ byteLength: length, sha256: digestString(data.sha256) })
    }
    const native = (selected: unknown): ArrayBuffer => {
      const index = integer(selected)
      const backing = sidecars[index]
      if (!isArrayBuffer(backing)) invalid()
      used.add(index)
      markRpcPortableBinary(backing)
      return backing
    }
    const decode = (value: unknown, depth = 0): IRpcPortableValue => {
      if (depth > RPC_PORTABLE_MAX_DEPTH) invalid()
      const tuple = array(value)
      const tag = tuple[0]
      if (tag === T.null && tuple.length === 1) return null
      if (tag === T.boolean && tuple.length === 2 && typeof tuple[1] === 'boolean') return tuple[1]
      if (
        tag === T.number &&
        tuple.length === 2 &&
        typeof tuple[1] === 'number' &&
        Number.isFinite(tuple[1])
      )
        return tuple[1]
      if (tag === T.string && tuple.length === 2 && typeof tuple[1] === 'string') return tuple[1]
      if (tag === T.array && tuple.length === 2) {
        /** Propagate existing child proof during restoration without rescanning the business graph. */
        let binary = false
        const restored = array(tuple[1]).map((item) => {
          const child = decode(item, depth + 1)
          if (hasRpcPortableBinary(child)) binary = true
          return child
        })
        if (binary) markRpcPortableBinary(restored)
        return Object.freeze(restored)
      }
      if (tag === T.object && tuple.length === 2) {
        const output: Record<string, IRpcPortableValue> = Object.create(null)
        let previous: string | undefined
        for (const item of array(tuple[1])) {
          const entry = array(item)
          if (
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            (previous !== undefined && compareRpcFieldNames(previous, entry[0]) >= 0)
          )
            invalid()
          previous = entry[0]
          output[entry[0]] = decode(entry[1], depth + 1)
          if (hasRpcPortableBinary(output[entry[0]])) markRpcPortableBinary(output)
        }
        keys(output)
        return Object.freeze(output)
      }
      if (tag === T.buffer && tuple.length === 2) {
        if (storage === RpcBinaryStorage.native) return native(tuple[1])
        if (typeof tuple[1] !== 'string') invalid()
        consume(Math.floor((tuple[1].length * 3) / 4))
        const bytes = decodeBytes(tuple[1])
        markRpcPortableBinary(bytes.buffer)
        return bytes.buffer as ArrayBuffer
      }
      if (tag === T.uint8array) {
        if (storage === RpcBinaryStorage.native && tuple.length === 4) {
          const backing = native(tuple[1])
          const offset = integer(tuple[2])
          const length = integer(tuple[3])
          if (
            !Number.isSafeInteger(offset + length) ||
            offset + length > rpcBinaryBackingLength(backing)
          )
            invalid()
          const restored = new Uint8Array(backing, offset, length)
          markRpcPortableBinary(restored)
          return restored
        }
        if (storage === RpcBinaryStorage.inline && tuple.length === 3) {
          const offset = integer(tuple[1])
          if (typeof tuple[2] !== 'string') invalid()
          consume(offset + Math.floor((tuple[2].length * 3) / 4))
          const view = decodeBytes(tuple[2], offset)
          markRpcPortableBinary(view)
          return view
        }
      }
      invalid()
    }
    /**
     * All headers, mode-specific slots, errors and stored outcome members retain original
     * validation.
     */
    const envelope = normalizeRuntimeEnvelope(manifest.envelope, decode)
    if (used.size !== sidecars.length) invalid()
    if (storage === RpcBinaryStorage.native && !digest) invalid()
    for (let index = 0; index < sidecars.length; index++)
      if (digestString(await digest!(sidecars[index] as ArrayBuffer)) !== metadata[index]!.sha256)
        invalidIntegrity()
    return envelope
  } catch (cause) {
    invalid(cause)
  }
}
