import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode, ERROR_SOURCE } from '../error-code.js'
import {
  normalizePortable,
  hasRpcPortableBinary,
  rpcPortableBackingLength,
  rpcPortableViewLength,
  RPC_PORTABLE_MAX_DEPTH
} from '../normalize.js'
import { RpcBatchPhysical } from '../wire-constants.js'
import { wrapRuntimeCarrier } from './carrier.js'
import { measureRpcPhysicalFrame } from '../batch-frame.js'
import type { IRpcRuntimeEnvelope } from './types.js'
import type { IRpcPortableValue } from '../types.js'
import { compareRpcFieldNames } from '../v1/route.js'
import { normalizeRuntimeEnvelope } from './normalize.js'
import {
  RpcBinaryProfile,
  RpcBinaryStorage,
  RpcNativeBinaryKind,
  RpcBinaryViolation,
  RpcBinaryField as F,
  RpcBinaryTag as T
} from './binary-constants.js'

/**
 * The original authentication owner supplies a whole-backing digest; this codec owns no crypto
 * state.
 */
export type IRpcBinaryDigest = (backing: ArrayBuffer) => Promise<string>

/** Closed wire metadata describes complete unique backings, including bytes outside a view. */
export type IRpcBinaryBacking = Readonly<{ byteLength: number; sha256: string }>

/** Only portable business slots in the original runtime union are tagged. */
export type IRpcBinaryManifest = Readonly<{
  profile: typeof RpcBinaryProfile
  storage: RpcBinaryStorage
  envelope: IRpcRuntimeEnvelope
  backings: readonly IRpcBinaryBacking[]
}>

/** Prepared native buffers preserve the exact original identity for explicit ownership transfer. */
export type IRpcPreparedBinary = Readonly<{
  manifest: IRpcBinaryManifest
  sidecars: readonly ArrayBuffer[]
  backingBytes: number
}>

/** Intrinsic getters read actual slots rather than shadowed properties on caller-owned views. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)

/** Captured backing accessor cannot execute an application's .buffer getter. */
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!

/** Captured offset accessor preserves the real view boundary across realms. */
const offsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!

/** Native-bearing business snapshots select the codec without a second recursive payload scan. */
export function hasRpcBinaryEnvelope(envelope: IRpcRuntimeEnvelope): boolean {
  if ('payload' in envelope && hasRpcPortableBinary(envelope.payload)) return true
  if ('steps' in envelope) return envelope.steps.some((step) => hasRpcPortableBinary(step.payload))
  if (
    'stream' in envelope &&
    'value' in envelope.stream &&
    hasRpcPortableBinary(envelope.stream.value)
  )
    return true
  /** Complete group reports retain their structural wrapper rather than tagging it as business data. */
  const completion =
    'completion' in envelope
      ? envelope.completion
      : 'outcome' in envelope
        ? envelope.outcome.completion
        : undefined
  if (!completion?.ok) return false
  if (hasRpcPortableBinary(completion.result)) return true
  if (Array.isArray(completion.result))
    return completion.result.some(
      (step) =>
        step && typeof step === 'object' && 'result' in step && hasRpcPortableBinary(step.result)
    )
  return false
}

/**
 * Contract failures remain native TypeErrors; the original core boundary determines
 * payload/protocol code.
 */
export function invalid(cause?: unknown): never {
  throw createContractError(RpcContractErrorCode.invalidEnvelope, cause)
}

/** Complete-length or SHA mismatch is a local integrity fact, never a field supplied by the wire. */
export function invalidIntegrity(): never {
  const error = createContractError(RpcContractErrorCode.invalidEnvelope)
  Object.defineProperty(error, 'violation', {
    value: RpcBinaryViolation.integrity,
    enumerable: true
  })
  throw error
}

/** Original wrapper causes preserve the decoder's classification without a second error registry. */
export function isRpcBinaryIntegrityFailure(error: unknown): boolean {
  /** Binary decoding adds bounded contract wrappers; it cannot manufacture a serialized error here. */
  let current = error
  for (let depth = 0; depth < RPC_PORTABLE_MAX_DEPTH && current instanceof Error; depth++) {
    const failure = current as Error & {
      source?: string
      code?: string
      violation?: string
      cause?: unknown
    }
    if (
      failure.source === ERROR_SOURCE &&
      failure.code === RpcContractErrorCode.invalidEnvelope &&
      failure.violation === RpcBinaryViolation.integrity
    )
      return true
    current = failure.cause
  }
  return false
}

/** Read full backing bytes using genuine ArrayBuffer internal slots. */
export function rpcBinaryBackingLength(backing: ArrayBuffer): number {
  if (!isArrayBuffer(backing)) invalid()
  return rpcPortableBackingLength(backing)
}

/**
 * Charge the exact selector/protected-metadata representation and full backing bytes without
 * serializing caller-owned sidecars. Native ArrayBuffer properties are not carried by clone.
 */
export function measureRpcNativeBinaryFrame(
  protectedMetadata: unknown,
  sidecarCount: number,
  backingBytes: number
): number {
  /** Each native backing contributes an empty object to the existing object-frame accounting. */
  const sidecars = Array.from({ length: sidecarCount }, () => Object.create(null))
  return (
    measureRpcPhysicalFrame(
      wrapRuntimeCarrier({ kind: RpcNativeBinaryKind, protectedMetadata, sidecars })
    ) + backingBytes
  )
}

/** Pre-auth admission checks the closed outer wrapper and full backing count/size without hashing. */
export function readRpcNativeBinary(
  value: unknown,
  limit: number
):
  | Readonly<{
      protectedMetadata: unknown
      sidecars: readonly ArrayBuffer[]
      backingBytes: number
    }>
  | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getOwnPropertyDescriptor(value, F.kind)?.value !== RpcNativeBinaryKind
  )
    return undefined
  const outer = record(value, [F.kind, F.protectedMetadata, F.sidecars])
  const sidecars = array(outer.sidecars)
  const unique = new Set<ArrayBuffer>()
  const consume = budget(limit)
  let backingBytes = 0
  for (const backing of sidecars) {
    if (!isArrayBuffer(backing) || unique.has(backing)) invalid()
    unique.add(backing)
    const length = rpcBinaryBackingLength(backing)
    consume(length)
    backingBytes += length
  }
  return {
    protectedMetadata: outer.protectedMetadata,
    sidecars: sidecars as readonly ArrayBuffer[],
    backingBytes
  }
}

/** The only supported native view is Uint8Array on a non-shared ArrayBuffer. */
export function rpcBinaryView(
  value: Uint8Array
): Readonly<{ backing: ArrayBuffer; offset: number; length: number }> {
  /** A shared backing fails its genuine ArrayBuffer brand, even when exposed through a Uint8Array. */
  const backing = Reflect.apply(bufferGetter, value, []) as ArrayBuffer
  if (!isArrayBuffer(backing)) invalid()
  return {
    backing,
    offset: Reflect.apply(offsetGetter, value, []) as number,
    length: rpcPortableViewLength(value)
  }
}

/** Snapshot dense own data arrays without invoking accessors or retaining caller-owned containers. */
export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid()
  /** The length and all elements enter one descriptor snapshot. */
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    string,
    PropertyDescriptor
  >
  /** Non-index fields, symbols and holes are outside the closed tuple/array grammar. */
  const length = descriptors.length!.value as number
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(descriptors).length !== length + 1
  )
    invalid()
  /** Admitted elements are copied once before any asynchronous digest or authentication. */
  const output: unknown[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
    output.push(descriptor.value)
  }
  return output
}

/** Snapshot a plain own data record; reflection failures retain the original cause. */
export function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  /** Plain portable records never borrow a prototype's configuration or callable fields. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid()
  /** A single descriptor snapshot rejects getters without executing them. */
  const descriptors = Object.getOwnPropertyDescriptors(value)
  /** Null prototype prevents an admitted **proto** key from executing a setter. */
  const output: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || (fields && !fields.includes(key))) invalid()
    const descriptor = descriptors[key]!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
    output[key] = descriptor.value
  }
  if (fields && fields.some((key) => !Object.hasOwn(output, key))) invalid()
  return output
}

/** A scoped byte budget bounds restored allocation and full sidecars before expensive digest work. */
export function budget(limit: number): (bytes: number) => void {
  /** Allocation totals belong to one manifest operation, never a second endpoint quota. */
  let remaining = Math.min(limit, RpcBatchPhysical.maxBytes)
  return (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) invalid()
    remaining -= bytes
  }
}

/** Nonnegative safe integers are the complete offset/length/index domain. */
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid()
  return value as number
}

/** Digest spellings are exact lowercase SHA-256 values, not caller-controlled algorithm labels. */
export function digestString(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) invalid()
  return value
}

/** The original platform byte encoder and Core sink share this one preparation boundary. */
export type IRpcBinaryEncoding = Readonly<{
  encodeInline?: (bytes: Uint8Array) => string
  capture: (manifest: IRpcBinaryManifest, roots: ReadonlyMap<object, number>) => void
}>

/** One synchronous preparation owns the graph and exact original backing identities. */
export type IRpcBinaryCapture = {
  envelope: IRpcRuntimeEnvelope
  sidecars: ArrayBuffer[]
  backingBytes: number
  capturedRoots: Map<object, number> | undefined
  /** Only a cold inline encoder retains these already copied visible-byte slots. */
  inline: IDeferredRpcBinaryBytes[] | undefined
  /** Deferred tuple containers freeze after their encoded byte slots have been filled. */
  frozen: object[] | undefined
  /** The original pre-hash callback must run once even when cold loading crosses that boundary. */
  beforeDigestComplete: boolean
}

/** One byte snapshot fills one canonical tuple slot without revisiting the business graph. */
type IDeferredRpcBinaryBytes = {
  bytes: Uint8Array
  tuple: IRpcPortableValue[]
  index: number
}

/** Preserve the original reserved-field policy; a legacy bytes descriptor remains ordinary data. */
export function keys(value: Record<string, unknown>): string[] {
  if (Object.hasOwn(value, '$rpc')) normalizePortable(value)
  return Object.keys(value).sort(compareRpcFieldNames)
}

/** Capture the original graph, byte budget and inline snapshots before any asynchronous handoff. */
export function captureRpcBinary(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit: number,
  digest: IRpcBinaryDigest | undefined,
  encoding: IRpcBinaryEncoding | undefined,
  fallbackEncodeInline: ((bytes: Uint8Array) => string) | undefined
): IRpcBinaryCapture {
  if (!Object.values(RpcBinaryStorage).includes(storage)) invalid()
  /** Original buffer identities determine dense index allocation and explicit transfer eligibility. */
  const sidecars: ArrayBuffer[] = []
  /** A single scoped index preserves aliases without introducing any persistent buffer registry. */
  const indices = new Map<ArrayBuffer, number>()
  /** Cycles are rejected while separate occurrences of ordinary records are independently copied. */
  const active = new Set<object>()
  /** Every allocated inline backing and every unique whole native backing counts toward this limit. */
  const consume = budget(limit)
  /** Full backing bytes are retained for the original sender's exact physical-size accounting. */
  let backingBytes = 0
  /** A held byte encoder is supplied by the original platform adapter, never inferred here. */
  const encodeInline = encoding?.encodeInline ?? fallbackEncodeInline
  /** First cold inline use owns byte snapshots while its canonical encoder module loads. */
  const inline: IDeferredRpcBinaryBytes[] | undefined =
    encodeInline === undefined && storage === RpcBinaryStorage.inline ? [] : undefined
  /** Native or already loaded encoders retain the original immediate freeze timing. */
  const frozen: object[] | undefined = inline ? [] : undefined
  /** Only business roots survive the walk; no persistent per-node registry is introduced. */
  const capturedRoots = encoding ? new Map<object, number>() : undefined
  /** JSON bounds are accumulated as tag tuples are constructed, without a later sizing walk. */
  let jsonByteUpperBound = 0
  /** Inline JSON owns its constructed tags; native signer inputs retain their original mutability. */
  const immutableInline = encoding !== undefined && storage === RpcBinaryStorage.inline
  /** Owned Core preparation freezes only newly constructed inline tags, never caller backings/views. */
  const publish = (tuple: IRpcPortableValue[], ownBound: number): IRpcPortableValue => {
    if (!encoding) return tuple
    jsonByteUpperBound += ownBound
    if (immutableInline && frozen) frozen.push(tuple)
    return immutableInline && !frozen ? Object.freeze(tuple) : tuple
  }
  const index = (backing: ArrayBuffer): number => {
    const known = indices.get(backing)
    if (known !== undefined) return known
    const length = rpcBinaryBackingLength(backing)
    consume(length)
    backingBytes += length
    const next = sidecars.length
    indices.set(backing, next)
    sidecars.push(backing)
    return next
  }
  const encode = (value: unknown, depth = 0): IRpcPortableValue => {
    if (depth > RPC_PORTABLE_MAX_DEPTH) invalid()
    if (value === null) return publish([T.null], T.null.length + 4)
    if (typeof value === 'boolean') return publish([T.boolean, value], T.boolean.length + 10)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid()
      return publish([T.number, value], T.number.length + 37)
    }
    if (typeof value === 'string')
      return publish([T.string, value], T.string.length + value.length * 6 + 7)
    if (isArrayBuffer(value)) {
      if (storage === RpcBinaryStorage.native)
        return publish([T.buffer, index(value)], T.buffer.length + 37)
      consume(rpcBinaryBackingLength(value))
      /** The original inline capture occurs before the first asynchronous digest handoff. */
      const bytes = new Uint8Array(value).slice()
      if (inline) {
        /** The pending slot belongs only to this freshly constructed tuple. */
        const tuple: IRpcPortableValue[] = [T.buffer, '']
        inline.push({ bytes, tuple, index: 1 })
        return publish(tuple, T.buffer.length + Math.ceil((bytes.byteLength * 4) / 3) + 7)
      }
      const encoded = encodeInline!(bytes)
      return publish([T.buffer, encoded], T.buffer.length + encoded.length + 7)
    }
    if (isUint8Array(value)) {
      const selected = rpcBinaryView(value)
      if (storage === RpcBinaryStorage.native)
        return publish(
          [T.uint8array, index(selected.backing), selected.offset, selected.length],
          T.uint8array.length + 103
        )
      consume(selected.offset + selected.length)
      /** The visible-byte snapshot retains the original offset and zero-prefix semantics. */
      const bytes = new Uint8Array(selected.backing, selected.offset, selected.length).slice()
      if (inline) {
        /** Offset and copied visible bytes preserve the original zero-prefix representation. */
        const tuple: IRpcPortableValue[] = [T.uint8array, selected.offset, '']
        inline.push({ bytes, tuple, index: 2 })
        return publish(tuple, T.uint8array.length + Math.ceil((bytes.byteLength * 4) / 3) + 40)
      }
      const encoded = encodeInline!(bytes)
      return publish(
        [T.uint8array, selected.offset, encoded],
        T.uint8array.length + encoded.length + 40
      )
    }
    if (!value || typeof value !== 'object' || active.has(value)) invalid()
    active.add(value)
    try {
      if (Array.isArray(value)) {
        /** Dense children retain their original codec order, each visited exactly once. */
        const children = array(value).map((item) => encode(item, depth + 1))
        if (immutableInline && frozen) frozen.push(children)
        return publish(
          [T.array, immutableInline && !frozen ? Object.freeze(children) : children],
          T.array.length + 7 + Math.max(0, children.length - 1)
        )
      }
      /** The original closed record capture and canonical field sort remain the sole owner. */
      const data = record(value)
      /** Pair delimiters and escaped key bounds are charged during the same business walk. */
      let keyBound = 0
      /** Independent repeated references keep their existing independently encoded tuples. */
      const children = keys(data).map((key) => {
        keyBound += key.length * 6 + 5
        /** Only constructed pair containers are frozen for the private owned JSON capture. */
        const pair = [key, encode(data[key], depth + 1)]
        if (immutableInline && frozen) frozen.push(pair)
        return immutableInline && !frozen ? Object.freeze(pair) : pair
      })
      if (immutableInline && frozen) frozen.push(children)
      return publish(
        [T.object, immutableInline && !frozen ? Object.freeze(children) : children],
        T.object.length + 7 + Math.max(0, children.length - 1) + keyBound
      )
    } finally {
      active.delete(value)
    }
  }
  /** Header/task/errors remain in the original grammar; only its portable slots call this codec. */
  const envelope = normalizeRuntimeEnvelope(
    message,
    capturedRoots
      ? (value) => {
          /** Each top-level portable slot records only its own constructed subtree bound. */
          const before = jsonByteUpperBound
          /** Recursive encode remains the original canonical binary visitor. */
          const encoded = encode(value)
          if (encoded !== null && typeof encoded === 'object')
            capturedRoots.set(encoded, jsonByteUpperBound - before)
          return encoded
        }
      : encode
  )
  if (storage === RpcBinaryStorage.native && !digest) invalid()
  return {
    envelope,
    sidecars,
    backingBytes,
    capturedRoots,
    inline,
    frozen,
    beforeDigestComplete: false
  }
}

/** Complete only owned byte slots; no caller container or payload is walked after cold loading. */
export function completeRpcBinaryCapture(
  capture: IRpcBinaryCapture,
  encodeInline: (bytes: Uint8Array) => string
): void {
  if (!capture.inline) return
  for (const entry of capture.inline) entry.tuple[entry.index] = encodeInline(entry.bytes)
  for (const value of capture.frozen!) Object.freeze(value)
  capture.inline = undefined
  capture.frozen = undefined
}

/** Preserve the original metadata bound and sink before the first native digest starts. */
export function beforeRpcBinaryDigest(
  capture: IRpcBinaryCapture,
  storage: RpcBinaryStorage,
  beforeDigest: ((manifest: IRpcBinaryManifest, backingBytes: number) => void) | undefined,
  encoding: IRpcBinaryEncoding | undefined
): void {
  if (capture.beforeDigestComplete) return
  if (storage === RpcBinaryStorage.native && beforeDigest) {
    /** SHA spelling has fixed width; the real backing identities remain untouched. */
    const manifest: IRpcBinaryManifest = {
      profile: RpcBinaryProfile,
      storage,
      envelope: capture.envelope,
      backings: capture.sidecars.map((backing) => ({
        byteLength: rpcBinaryBackingLength(backing),
        sha256: '0'.repeat(64)
      }))
    }
    if (encoding && capture.capturedRoots) encoding.capture(manifest, capture.capturedRoots)
    beforeDigest(manifest, capture.backingBytes)
  }
  capture.beforeDigestComplete = true
}

/** Preserve the original asynchronous preparation failure and its native contract cause chain. */
export function rejectRpcBinaryPreparation(cause: unknown): Promise<never> {
  try {
    invalid(cause)
  } catch (error) {
    return Promise.reject(error)
  }
}
