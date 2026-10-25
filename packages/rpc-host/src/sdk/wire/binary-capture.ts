/** Original synchronous binary capture migrated to its executing SDK owner. */
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import {
  normalizeRpcFrame,
  isRpcOperationalFrame,
  type IRpcEnvelope,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import {
  RPC_PORTABLE_MAX_DEPTH,
  captureRpcWirePortableRecord,
  assertRpcPortableRecordKey,
  raiseRpcPortableViolation,
  RpcPortableViolation
} from '@migaia/rpc-contract/portable'
import { isCanonicalBase64url } from '@migaia/serialize/core'
import type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'
import { BinaryShape } from './binary-shape.js'
import { projectRpcFrameSlots } from './frame-slots.js'
import { markRpcPortableBinary } from './portable.js'
import { RpcBinaryStorage, RpcBinaryTag as T } from './binary-constants.js'
import type { IRpcBinaryDigest, IRpcBinaryEncoding, IRpcBinaryCapture } from './binary-types.js'
/** One original visit builds both semantic snapshots and tags without rescanning business data. */
type IBinaryValue = { encoded: IRpcPortableValue; semantic: IRpcPortableValue; native: boolean }
/** Only the real ordinary JSON codec borrows this existing shallow wire-capture policy. */
type IRecordCapture = typeof captureRpcWirePortableRecord
/** Capture the original graph, byte budget and inline snapshots before any asynchronous handoff. */
/** Allocate one synchronous binary capture traversal before installing behavior callbacks. */
function binaryCaptureState(
  message: IRpcEnvelope,
  storage: RpcBinaryStorage,
  limit: number,
  digest: IRpcBinaryDigest | undefined,
  encoding: IRpcBinaryEncoding | undefined,
  fallbackEncodeInline: ((bytes: Uint8Array) => string) | undefined,
  errorMetadata?: IRpcErrorWireMetadata,
  captureRecord?: IRecordCapture
) {
  /** One explicit shape/budget owner serves this operation without a second graph walker. */
  const shape = new BinaryShape(limit, errorMetadata)
  if (!Object.values(RpcBinaryStorage).includes(storage)) shape.invalid()
  /** Original buffer identities determine dense index allocation and explicit transfer eligibility. */
  const sidecars: ArrayBuffer[] = []
  /** A single scoped index preserves aliases without introducing any persistent buffer registry. */
  const indices = new Map<ArrayBuffer, number>()
  /** Cycles are rejected while separate occurrences of ordinary records are independently copied. */
  const active = new Set<object>()
  /** Every allocated inline backing and every unique whole native backing counts toward this limit. */
  const consume = shape.consume
  /** Full backing bytes are retained for the original sender's exact physical-size accounting. */
  let backingBytes = 0
  /** A held byte encoder is supplied by the original platform adapter, never inferred here. */
  const encodeInline = encoding?.encodeInline ?? fallbackEncodeInline
  /** Only business roots survive the walk; no persistent per-node registry is introduced. */
  const capturedRoots = encoding ? new Map<object, number>() : undefined
  /** JSON bounds are accumulated as tag tuples are constructed, without a later sizing walk. */
  let jsonByteUpperBound = 0
  /** Inline JSON owns its constructed tags; native signer inputs retain their original mutability. */
  const immutableInline = encoding !== undefined && storage === RpcBinaryStorage.inline

  return {
    sidecars,
    indices,
    active,
    consume,
    backingBytes,
    encodeInline,
    capturedRoots,
    jsonByteUpperBound,
    immutableInline,
    message,
    storage,
    limit,
    digest,
    encoding,
    fallbackEncodeInline,
    shape,
    errorMetadata,
    captureRecord,
    roots: [] as IBinaryValue[],
    encodedRoot: 0,
    semanticRoot: 0,
    hasBinary: false
  }
}

/** Own one synchronous binary capture traversal; callbacks access only this explicit instance. */
class BinaryCapture {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof binaryCaptureState>
  /** Pure shallow capture shares the walker's canonical tag predicate and explicit error policy. */
  readonly #recordContext = {
    isCanonicalBase64url,
    reject: (reason: string, cause?: unknown): never =>
      raiseRpcPortableViolation(reason, cause, this.#state.errorMetadata)
  }
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcBinaryCapture
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    message: IRpcEnvelope,
    storage: RpcBinaryStorage,
    limit: number,
    digest: IRpcBinaryDigest | undefined,
    encoding: IRpcBinaryEncoding | undefined,
    fallbackEncodeInline: ((bytes: Uint8Array) => string) | undefined,
    errorMetadata?: IRpcErrorWireMetadata,
    captureRecord?: IRecordCapture
  ) {
    this.#state = binaryCaptureState(
      message,
      storage,
      limit,
      digest,
      encoding,
      fallbackEncodeInline,
      errorMetadata,
      captureRecord
    )
    /** Header/task/errors remain in the original grammar; only its portable slots call this codec. */
    const envelope = normalizeRpcFrame(
      this.#state.message,
      this.#state.errorMetadata,
      this.#project
    )
    /** An explicit shape receiver retains its never-returning admission gate for type narrowing. */
    const shape: BinaryShape = this.#state.shape
    if (!isRpcOperationalFrame(envelope)) shape.invalid()
    if (
      this.#state.hasBinary &&
      this.#state.storage === RpcBinaryStorage.native &&
      !this.#state.digest
    )
      this.#state.shape.invalid()
    this.value = {
      envelope: projectRpcFrameSlots(envelope, this.#encodedRoot),
      semanticEnvelope: projectRpcFrameSlots(envelope, this.#semanticRoot),
      hasBinary: this.#state.hasBinary,
      sidecars: this.#state.sidecars,
      backingBytes: this.#state.backingBytes,
      capturedRoots: this.#state.capturedRoots
    }
  }
  /**
   * One metadata admission projects a portable slot and charges original semantic bytes in that
   * same walk.
   */
  readonly #project = (
    value: unknown,
    _metadata?: IRpcErrorWireMetadata,
    maxBytes?: number
  ): IRpcPortableValue => {
    /** Captured before-values belong only to this root slot, including nested reentrant input. */
    const before = this.#state.jsonByteUpperBound
    /**
     * Stream value accounting comes from the original native/string domain, never base64 tuple
     * size.
     */
    if (maxBytes !== undefined) this.#state.shape.beginSemantic()
    try {
      /** The existing sole encoder visits this original business graph once. */
      const captured = this.#encode(value)
      const encoded = captured.encoded
      this.#state.roots.push(captured)
      if (maxBytes !== undefined) this.#state.shape.semanticLimit(maxBytes)
      if (this.#state.capturedRoots && encoded !== null && typeof encoded === 'object')
        this.#state.capturedRoots.set(encoded, this.#state.jsonByteUpperBound - before)
      return encoded
    } finally {
      if (maxBytes !== undefined) this.#state.shape.endSemantic()
    }
  }

  /** Canonical slot order retains each occurrence's encoded snapshot, including repeated roots. */
  readonly #encodedRoot = (): IRpcPortableValue =>
    this.#state.roots[this.#state.encodedRoot++]!.encoded

  /** The same slot order selects semantic snapshots without another business traversal. */
  readonly #semanticRoot = (): IRpcPortableValue =>
    this.#state.roots[this.#state.semanticRoot++]!.semantic

  /** Inline callers retain parent getter capture and exact original getter-failure classification. */
  #wireRecord(value: object) {
    try {
      return this.#state.captureRecord!(value, this.#recordContext)!
    } catch (cause) {
      return raiseRpcPortableViolation(
        RpcPortableViolation.invalid,
        cause,
        this.#state.errorMetadata
      )
    }
  }

  /** Newly constructed tags and semantic containers share one original visit and native proof. */
  #publish(
    tuple: IRpcPortableValue[],
    ownBound: number,
    semantic: IRpcPortableValue,
    native = false
  ): IBinaryValue {
    if (this.#state.encoding) this.#state.jsonByteUpperBound += ownBound
    if (native) {
      this.#state.hasBinary = true
      markRpcPortableBinary(semantic as object)
    }
    return { encoded: this.#state.immutableInline ? Object.freeze(tuple) : tuple, semantic, native }
  }

  #index = (backing: ArrayBuffer): number => {
    const known = this.#state.indices.get(backing)
    if (known !== undefined) return known
    /** Each distinct backing contributes its whole native byte length to the physical budget. */
    const length = this.#state.shape.backingLength(backing)
    ;(0, this.#state.consume)(length)
    this.#state.backingBytes += length
    const next = this.#state.sidecars.length
    this.#state.indices.set(backing, next)
    this.#state.sidecars.push(backing)
    return next
  }

  #encode = (value: unknown, depth = 0): IBinaryValue => {
    if (depth > RPC_PORTABLE_MAX_DEPTH) this.#state.shape.invalid()
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    )
      this.#state.shape.semanticValue(value as IRpcPortableValue)
    if (value === null) return this.#publish([T.null], T.null.length + 4, null)
    if (typeof value === 'boolean')
      return this.#publish([T.boolean, value], T.boolean.length + 10, value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) this.#state.shape.invalid()
      return this.#publish([T.number, value], T.number.length + 37, value)
    }
    if (typeof value === 'string')
      return this.#publish([T.string, value], T.string.length + value.length * 6 + 7, value)
    if (isArrayBuffer(value)) {
      this.#state.shape.semanticValue(value)
      if (this.#state.storage === RpcBinaryStorage.native)
        return this.#publish([T.buffer, this.#index(value)], T.buffer.length + 37, value, true)
      ;(0, this.#state.consume)(this.#state.shape.backingLength(value))
      /** The original inline capture occurs before the first asynchronous digest handoff. */
      const bytes = new Uint8Array(value).slice()
      /** Invoke the held encoder with its original receiverless callback semantics. */
      const encodeInline = this.#state.encodeInline!
      /** Recursive encode remains the original canonical binary visitor. */
      const encoded = encodeInline(bytes)
      return this.#publish([T.buffer, encoded], T.buffer.length + encoded.length + 7, value, true)
    }
    if (isUint8Array(value)) {
      this.#state.shape.semanticValue(value)
      const selected = this.#state.shape.view(value)
      if (this.#state.storage === RpcBinaryStorage.native)
        return this.#publish(
          [T.uint8array, this.#index(selected.backing), selected.offset, selected.length],
          T.uint8array.length + 103,
          value,
          true
        )
      ;(0, this.#state.consume)(selected.offset + selected.length)
      /** The visible-byte snapshot retains the original offset and zero-prefix semantics. */
      const bytes = new Uint8Array(selected.backing, selected.offset, selected.length).slice()
      /** Invoke the held encoder with its original receiverless callback semantics. */
      const encodeInline = this.#state.encodeInline!
      /** Recursive encode remains the original canonical binary visitor. */
      const encoded = encodeInline(bytes)
      return this.#publish(
        [T.uint8array, selected.offset, encoded],
        T.uint8array.length + encoded.length + 40,
        value,
        true
      )
    }
    if (!value || typeof value !== 'object' || this.#state.active.has(value))
      return this.#state.shape.invalid()
    this.#state.active.add(value)
    try {
      if (Array.isArray(value)) {
        /** Dense children retain their original codec order, each visited exactly once. */
        const items = this.#state.shape.array(value)
        this.#state.shape.semanticContainer(items.length)
        /** Child pairs populate both output arrays during this same original traversal. */
        const children: IRpcPortableValue[] = []
        /** Only newly constructed semantic containers are frozen; native leaves retain identity. */
        const semantic: IRpcPortableValue[] = []
        /** Native descendant evidence comes from the same child visit, never a second scan. */
        let native = false
        for (const item of items) {
          const child = this.#encode(item, depth + 1)
          children.push(child.encoded)
          semantic.push(child.semantic)
          native ||= child.native
        }
        return this.#publish(
          [T.array, this.#state.immutableInline ? Object.freeze(children) : children],
          T.array.length + 7 + Math.max(0, children.length - 1),
          Object.freeze(semantic),
          native
        )
      }
      /** Explicit binary and native operations keep strict own-data admission by default. */
      const data = this.#state.captureRecord ? undefined : this.#state.shape.record(value)
      /** Captured inline fields are reused directly, with no second graph copy or normalize walk. */
      const record = data ? undefined : this.#wireRecord(value)
      /** Pair delimiters and escaped key bounds are charged during the same business walk. */
      let keyBound = 0
      /** Independent repeated references keep their existing independently encoded tuples. */
      const fields = data ? this.#state.shape.keys(data) : record!.entries
      this.#state.shape.semanticContainer(fields.length)
      /** Own-key order is retained while both semantic and physical bounds are charged. */
      const children: IRpcPortableValue[] = []
      /** Reuse the pure capture's output instead of allocating a second ordinary record. */
      const semantic: Record<string, IRpcPortableValue> = record?.output ?? Object.create(null)
      /** Each child supplies its existing native-descendant flag. */
      let native = false
      for (const field of fields) {
        /** Each branch reads its existing captured representation without allocating another map. */
        const key = typeof field === 'string' ? field : field[0]
        if (record && record.tag === undefined) assertRpcPortableRecordKey(key, this.#recordContext)
        this.#state.shape.semanticKey(key)
        keyBound += key.length * 6 + 5
        /** Only constructed pair containers are frozen for the private owned JSON capture. */
        const child = this.#encode(typeof field === 'string' ? data![key] : field[1], depth + 1)
        semantic[key] = child.semantic
        native ||= child.native
        const pair = [key, child.encoded]
        children.push(this.#state.immutableInline ? Object.freeze(pair) : pair)
      }
      return this.#publish(
        [T.object, this.#state.immutableInline ? Object.freeze(children) : children],
        T.object.length + 7 + Math.max(0, children.length - 1) + keyBound,
        Object.freeze(semantic),
        native
      )
    } finally {
      this.#state.active.delete(value)
    }
  }
}

/** Capture all business slots before digest suspension, preserving original backing aliases. */
export function captureRpcBinary(
  message: IRpcEnvelope,
  storage: RpcBinaryStorage,
  limit: number,
  digest: IRpcBinaryDigest | undefined,
  encoding: IRpcBinaryEncoding | undefined,
  encodeInline: (bytes: Uint8Array) => string,
  errorMetadata?: IRpcErrorWireMetadata,
  captureRecord?: IRecordCapture
): IRpcBinaryCapture {
  return new BinaryCapture(
    message,
    storage,
    limit,
    digest,
    encoding,
    encodeInline,
    errorMetadata,
    captureRecord
  ).value
}
