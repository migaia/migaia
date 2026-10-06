import { isArrayBuffer, isUint8Array, bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode, ERROR_SOURCE } from '../error-code.js'
import {
  normalizePortable,
  hasRpcPortableBinary,
  markRpcPortableBinary,
  rpcPortableBackingLength,
  rpcPortableViewLength,
  RPC_PORTABLE_MAX_DEPTH
} from '../normalize.js'
import { RpcBatchPhysical } from '../wire-constants.js'
import { compareRpcFieldNames } from '../v1/route.js'
import type { IRpcPortableValue } from '../types.js'
import { normalizeRuntimeEnvelope } from './normalize.js'
import { wrapRuntimeCarrier } from './carrier.js'
import { measureRpcPhysicalFrame } from '../batch-frame.js'
import type { IRpcRuntimeEnvelope } from './types.js'
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
function invalid(cause?: unknown): never {
  throw createContractError(RpcContractErrorCode.invalidEnvelope, cause)
}

/** Complete-length or SHA mismatch is a local integrity fact, never a field supplied by the wire. */
function invalidIntegrity(): never {
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
function array(value: unknown): readonly unknown[] {
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
function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
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

/** Preserve the original reserved-field policy; a legacy bytes descriptor remains ordinary data. */
function keys(value: Record<string, unknown>): string[] {
  if (Object.hasOwn(value, '$rpc')) normalizePortable(value)
  return Object.keys(value).sort(compareRpcFieldNames)
}

/** A scoped byte budget bounds restored allocation and full sidecars before expensive digest work. */
function budget(limit: number): (bytes: number) => void {
  /** Allocation totals belong to one manifest operation, never a second endpoint quota. */
  let remaining = Math.min(limit, RpcBatchPhysical.maxBytes)
  return (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) invalid()
    remaining -= bytes
  }
}

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

/** Nonnegative safe integers are the complete offset/length/index domain. */
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid()
  return value as number
}

/** Digest spellings are exact lowercase SHA-256 values, not caller-controlled algorithm labels. */
function digestString(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) invalid()
  return value
}

/**
 * Tag only business data using the original closed runtime-envelope grammar. The synchronous graph
 * snapshot and complete byte budget precede every native hash or asynchronous transform.
 */
export async function prepareRpcBinary(
  message: IRpcRuntimeEnvelope,
  storage: RpcBinaryStorage,
  limit = RpcBatchPhysical.maxBytes,
  digest?: IRpcBinaryDigest,
  beforeDigest?: (manifest: IRpcBinaryManifest, backingBytes: number) => void
): Promise<IRpcPreparedBinary> {
  try {
    if (!Object.values(RpcBinaryStorage).includes(storage)) invalid()
    /**
     * Original buffer identities determine dense index allocation and explicit transfer
     * eligibility.
     */
    const sidecars: ArrayBuffer[] = []
    /** A single scoped index preserves aliases without introducing any persistent buffer registry. */
    const indices = new Map<ArrayBuffer, number>()
    /** Cycles are rejected while separate occurrences of ordinary records are independently copied. */
    const active = new Set<object>()
    /**
     * Every allocated inline backing and every unique whole native backing counts toward this
     * limit.
     */
    const consume = budget(limit)
    /** Full backing bytes are retained for the original sender's exact physical-size accounting. */
    let backingBytes = 0
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
      if (value === null) return [T.null]
      if (typeof value === 'boolean') return [T.boolean, value]
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) invalid()
        return [T.number, value]
      }
      if (typeof value === 'string') return [T.string, value]
      if (isArrayBuffer(value)) {
        if (storage === RpcBinaryStorage.native) return [T.buffer, index(value)]
        consume(rpcBinaryBackingLength(value))
        return [T.buffer, encodeBytes(new Uint8Array(value).slice())]
      }
      if (isUint8Array(value)) {
        const selected = rpcBinaryView(value)
        if (storage === RpcBinaryStorage.native)
          return [T.uint8array, index(selected.backing), selected.offset, selected.length]
        consume(selected.offset + selected.length)
        return [
          T.uint8array,
          selected.offset,
          encodeBytes(new Uint8Array(selected.backing, selected.offset, selected.length).slice())
        ]
      }
      if (!value || typeof value !== 'object' || active.has(value)) invalid()
      active.add(value)
      try {
        if (Array.isArray(value))
          return [T.array, array(value).map((item) => encode(item, depth + 1))]
        const data = record(value)
        return [T.object, keys(data).map((key) => [key, encode(data[key], depth + 1)])]
      } finally {
        active.delete(value)
      }
    }
    /** Header/task/errors remain in the original grammar; only its portable slots call this codec. */
    const envelope = normalizeRuntimeEnvelope(message, encode)
    if (storage === RpcBinaryStorage.native && !digest) invalid()
    /** The original sender can prove the selected codec's full metadata budget before any hash. */
    if (storage === RpcBinaryStorage.native && beforeDigest)
      beforeDigest(
        {
          profile: RpcBinaryProfile,
          storage,
          envelope,
          backings: sidecars.map((backing) => ({
            byteLength: rpcBinaryBackingLength(backing),
            sha256: '0'.repeat(64)
          }))
        },
        backingBytes
      )
    /** All hashes cover complete original backings after the synchronous graph/budget checks. */
    const backings: IRpcBinaryBacking[] = []
    for (const backing of sidecars)
      backings.push(
        Object.freeze({
          byteLength: rpcBinaryBackingLength(backing),
          sha256: digestString(await digest!(backing))
        })
      )
    return Object.freeze({
      manifest: Object.freeze({
        profile: RpcBinaryProfile,
        storage,
        envelope,
        backings: Object.freeze(backings)
      }),
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
