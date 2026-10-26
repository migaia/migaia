/** Original tagged binary restore belongs to the held SDK codec, including digest suspension. */
import { isArrayBuffer, base64ToBytes } from '@migaia/utils/bytes'
import {
  normalizeRpcFrame,
  isRpcOperationalFrame,
  RpcWirePointer as P,
  RpcWireField as F,
  type IRpcEnvelope,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import { RPC_PORTABLE_MAX_DEPTH } from '@migaia/rpc-contract/portable'
import { BinaryShape } from './binary-shape.js'
import { RpcBinaryProfile, RpcBinaryStorage, RpcBinaryTag as T } from './binary-constants.js'
import { markRpcPortableBinary, hasRpcPortableBinary } from './portable.js'
import { projectRpcFrameSlots } from './frame-slots.js'
import type { IRpcBinaryRestoreOptions } from './binary-types.js'

/** Decode the original unpadded byte spelling into the final offset view with no temporary backing. */
function decodeBytes(value: string, offset: number, shape: BinaryShape): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) shape.invalid()
  /** Base64 validation belongs to the existing byte owner; this constructs its padded spelling. */
  const encoded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  if (offset === 0) return base64ToBytes(encoded)
  /** The operation already charged the complete zero-prefix allocation before reaching this call. */
  const backing = new ArrayBuffer(offset + Math.floor((value.length * 3) / 4))
  return base64ToBytes(encoded, new Uint8Array(backing, offset))
}

/**
 * One restore holds its exact original manifest/buffers until the supplied whole-backing digest
 * ends.
 */
class BinaryRestore {
  /** Storage, digest and local error metadata belong only to this actual restore operation. */
  readonly #options: IRpcBinaryRestoreOptions
  /** Closed descriptor admission and allocation accounting remain the original single owner. */
  readonly #shape: BinaryShape
  /** Original sidecars are retained once, in the caller's exact physical order. */
  #sidecars: readonly unknown[] = []
  /** Logical indexes retain each decoded inline or original native whole backing exactly once. */
  readonly #backings: ArrayBuffer[] = []
  /** Every logical backing must have at least one legitimate tagged business reference. */
  readonly #used = new Set<number>()
  /** Admission order retains each decoded root once, independent from repeated input identity. */
  readonly #roots: IRpcPortableValue[] = []
  /** Fixed slot projection consumes the original decoder results without another graph walk. */
  #root = 0
  /** Capture only operation options; no graph traversal begins before run's normal admission order. */
  constructor(options: IRpcBinaryRestoreOptions) {
    this.#options = options
    this.#shape = new BinaryShape(options.limit, options.errorMetadata)
  }

  /**
   * Admit all protected metadata before allocation/digest, then return one normalized new-profile
   * frame.
   */
  async run(value: unknown): Promise<IRpcEnvelope> {
    try {
      /** Known manifest fields are checked before caller-owned native backings are read or hashed. */
      const manifest = this.#manifest(value)
      if (manifest.profile !== RpcBinaryProfile)
        this.#shape.invalid(undefined, `${P.manifest}/${F.profile}`)
      if (manifest.storage !== this.#options.storage)
        this.#shape.invalid(undefined, `${P.manifest}/${F.storage}`)
      this.#sidecars = this.#shape.array(this.#options.sidecars ?? [])
      /** Declared full backing records are captured before every expensive digest. */
      const backings = this.#shape.array(manifest.backings, `${P.manifest}/${F.backings}`)
      if (
        this.#options.storage === RpcBinaryStorage.inline &&
        (backings.length || this.#sidecars.length)
      )
        this.#shape.invalid()
      /** A complete backing identity may be referenced repeatedly, but appear only once physically. */
      const unique = new Set<ArrayBuffer>()
      /** Captured original digest/length metadata remains unchanged through asynchronous hash calls. */
      const metadata: { backing: ArrayBuffer; sha256: string }[] = []
      /** Inline rows consume no physical sidecar, preserving the original native subsequence order. */
      let physical = 0
      for (let index = 0; index < backings.length; index++) {
        /** One protected record describes the complete backing, including bytes outside a view. */
        const data = this.#backing(backings[index], `${P.manifest}/${index}`)
        /** Actual length equality is established before digest work can suspend or detach storage. */
        const length = this.#shape.integer(
          data.byteLength,
          `${P.manifest}/${index}/${F.byteLength}`
        )
        this.#shape.consume(length)
        /** An own inline field selects this representation even when its value is malformed. */
        if (Object.hasOwn(data, F.data)) {
          /**
           * Inline signed bytes are charged before allocation and materialized once for all
           * aliases.
           */
          const encoded = this.#shape.inlineData(data.data, `${P.manifest}/${index}/${F.data}`)
          if (Math.floor((encoded.length * 3) / 4) !== length) this.#shape.integrity()
          this.#backings.push(decodeBytes(encoded, 0, this.#shape).buffer as ArrayBuffer)
          continue
        }
        /** Only native logical rows borrow the next original whole physical backing. */
        const backing = this.#sidecars[physical++]
        if (!isArrayBuffer(backing) || unique.has(backing)) this.#shape.invalid()
        unique.add(backing)
        if (length !== this.#shape.backingLength(backing)) this.#shape.integrity()
        this.#backings.push(backing)
        /**
         * Validate any own SHA field once without granting authority; only local signing requires
         * hashing.
         */
        const sha256 = Object.hasOwn(data, F.sha256)
          ? this.#shape.digest(data.sha256, `${P.manifest}/${index}/${F.sha256}`)
          : undefined
        if (this.#options.transferRequiresIntegrity) {
          if (sha256 === undefined || !this.#options.digest) this.#shape.invalid()
          metadata.push({ backing, sha256 })
        }
      }
      if (physical !== this.#sidecars.length) this.#shape.invalid()
      /**
       * Exactly one existing metadata admission delegates only portable slots to the original
       * decoder.
       */
      const sourceEnvelope = manifest.envelope
      if (sourceEnvelope === undefined)
        this.#shape.invalid(undefined, `${P.manifest}/${F.envelope}`)
      /** The same single known field read enters the canonical semantic frame admission. */
      const envelope = normalizeRpcFrame(sourceEnvelope, this.#options.errorMetadata, this.#project)
      if (!isRpcOperationalFrame(envelope)) this.#shape.invalid()
      if (this.#used.size !== this.#backings.length) this.#shape.invalid()
      for (const entry of metadata)
        if (this.#shape.digest(await this.#options.digest!(entry.backing)) !== entry.sha256)
          this.#shape.integrity()
      return projectRpcFrameSlots(envelope, this.#restoredRoot)
    } catch (cause) {
      this.#shape.invalid(cause)
    }
  }

  /** Decode one actual slot and enforce its original semantic budget in the same tagged-data walk. */
  readonly #project = (
    value: unknown,
    _metadata?: import('@migaia/rpc-contract/errors').IRpcErrorWireMetadata,
    maxBytes?: number
  ): IRpcPortableValue => {
    /** Only this root's exact delta is compared with a caller-supplied stream value ceiling. */
    if (maxBytes !== undefined) this.#shape.beginSemantic()
    try {
      /** The original decoder retains native backing aliases and object insertion order. */
      const restored = this.#decode(value)
      this.#roots.push(restored)
      if (maxBytes !== undefined) this.#shape.semanticLimit(maxBytes)
      return restored
    } finally {
      if (maxBytes !== undefined) this.#shape.endSemantic()
    }
  }

  /** Codec output follows exactly the pure parser's original extension/operation slot order. */
  readonly #restoredRoot = (): IRpcPortableValue => this.#roots[this.#root++]!

  /** Manifest metadata uses its original object; run checks known fields in admission order. */
  #manifest(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      this.#shape.invalid(undefined, P.manifest)
    return value as Record<string, unknown>
  }

  /** Backing metadata is read directly; length, integrity and digest checks remain in run. */
  #backing(value: unknown, pointer: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      this.#shape.invalid(undefined, pointer)
    return value as Record<string, unknown>
  }

  /** Resolve one admitted backing index without copying or granting native transfer authority. */
  #native(selected: unknown): ArrayBuffer {
    const index = this.#shape.integer(selected)
    const backing = this.#backings[index]
    if (!isArrayBuffer(backing)) this.#shape.invalid()
    this.#used.add(index)
    markRpcPortableBinary(backing)
    return backing
  }

  /** The original sole tagged-data decoder preserves insertion order and repeated native references. */
  readonly #decode = (value: unknown, depth = 0): IRpcPortableValue => {
    if (depth > RPC_PORTABLE_MAX_DEPTH) this.#shape.invalid()
    const tuple = this.#shape.array(value)
    const tag = tuple[0]
    if (tag === T.null && tuple.length === 1) {
      this.#shape.semanticValue(null)
      return null
    }
    if (tag === T.boolean && tuple.length === 2 && typeof tuple[1] === 'boolean') {
      this.#shape.semanticValue(tuple[1])
      return tuple[1]
    }
    if (
      tag === T.number &&
      tuple.length === 2 &&
      typeof tuple[1] === 'number' &&
      Number.isFinite(tuple[1])
    ) {
      this.#shape.semanticValue(tuple[1] as number)
      return tuple[1] as number
    }
    if (tag === T.string && tuple.length === 2 && typeof tuple[1] === 'string') {
      this.#shape.semanticValue(tuple[1])
      return tuple[1]
    }
    if (tag === T.array && tuple.length === 2) {
      /** Propagate existing child proof during restoration without rescanning the business graph. */
      let binary = false
      const items = this.#shape.array(tuple[1])
      this.#shape.semanticContainer(items.length)
      /** Child proof and accounting are fused into the original recursive decode. */
      const restored: IRpcPortableValue[] = []
      for (const item of items) {
        const child = this.#decode(item, depth + 1)
        if (hasRpcPortableBinary(child)) binary = true
        restored.push(child)
      }
      if (binary) markRpcPortableBinary(restored)
      return Object.freeze(restored)
    }
    if (tag === T.object && tuple.length === 2) {
      const output: Record<string, IRpcPortableValue> = Object.create(null)
      const entries = this.#shape.array(tuple[1])
      this.#shape.semanticContainer(entries.length)
      for (const item of entries) {
        const entry = this.#shape.array(item)
        if (entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(output, entry[0]))
          this.#shape.invalid()
        this.#shape.semanticKey(entry[0])
        output[entry[0]] = this.#decode(entry[1], depth + 1)
        if (hasRpcPortableBinary(output[entry[0]])) markRpcPortableBinary(output)
      }
      this.#shape.keys(output)
      return Object.freeze(output)
    }
    if (tag === T.buffer && tuple.length === 2) {
      if (this.#options.storage === RpcBinaryStorage.native) {
        const backing = this.#native(tuple[1])
        this.#shape.semanticValue(backing)
        return backing
      }
      if (typeof tuple[1] !== 'string') this.#shape.invalid()
      this.#shape.consume(Math.floor((tuple[1].length * 3) / 4))
      const bytes = decodeBytes(tuple[1], 0, this.#shape)
      markRpcPortableBinary(bytes.buffer)
      this.#shape.semanticValue(bytes.buffer as ArrayBuffer)
      return bytes.buffer as ArrayBuffer
    }
    if (tag === T.uint8array) {
      if (this.#options.storage === RpcBinaryStorage.native && tuple.length === 4) {
        const backing = this.#native(tuple[1])
        const offset = this.#shape.integer(tuple[2])
        const length = this.#shape.integer(tuple[3])
        if (
          !Number.isSafeInteger(offset + length) ||
          offset + length > this.#shape.backingLength(backing)
        )
          this.#shape.invalid()
        const restored = new Uint8Array(backing, offset, length)
        markRpcPortableBinary(restored)
        this.#shape.semanticValue(restored)
        return restored
      }
      if (this.#options.storage === RpcBinaryStorage.inline && tuple.length === 3) {
        const offset = this.#shape.integer(tuple[1])
        if (typeof tuple[2] !== 'string') this.#shape.invalid()
        this.#shape.consume(offset + Math.floor((tuple[2].length * 3) / 4))
        const view = decodeBytes(tuple[2], offset, this.#shape)
        markRpcPortableBinary(view)
        this.#shape.semanticValue(view)
        return view
      }
    }
    this.#shape.invalid()
  }
}

/**
 * Restore through the actual SDK owner; semantic shape validation remains the sole pure contract
 * entry.
 */
export function restoreRpcBinary(
  value: unknown,
  options: IRpcBinaryRestoreOptions
): Promise<IRpcEnvelope> {
  return new BinaryRestore(options).run(value)
}
