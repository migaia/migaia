import { isUint8Array, isArrayBuffer } from '@migaia/utils/bytes'
import { RpcContractErrorCode } from './error-code.js'
import { createContractError } from './contract-error.js'
import { RPC_CONTRACT_SOURCE } from './error-text.js'
import type {
  IRpcPortableBytes,
  IRpcPortableRecord,
  IRpcPortableValue,
  IRpcWirePortableValue
} from './types.js'

const RESERVED = '$rpc'
/** Existing portable recursion budget is also reused by cold Runtime API method compilation. */
export const RPC_PORTABLE_MAX_DEPTH = 64

/** Private value proof identifies native-bearing snapshots; it owns no endpoint or replay state. */
const binarySnapshots = new WeakSet<object>()

/** Native binary admission and stream budgets share the same captured backing-length slot. */
const backingLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!
/** The typed-array intrinsic counts visible bytes without invoking a caller's shadow property. */
const viewLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)!.get!

/** Read the true length of an already brand-admitted backing; this is an internal contract seam. */
export function rpcPortableBackingLength(value: ArrayBuffer): number {
  return Reflect.apply(backingLengthGetter, value, []) as number
}

/** Read the true visible byte length of an already brand-admitted view without application hooks. */
export function rpcPortableViewLength(value: Uint8Array): number {
  return Reflect.apply(viewLengthGetter, value, []) as number
}

/** The canonical binary decoder records the same proof while constructing its admitted snapshot. */
export function markRpcPortableBinary(value: object): void {
  binarySnapshots.add(value)
}

/** Sender branch selection reads the proof minted during the original single portable walk. */
export function hasRpcPortableBinary(value: unknown): boolean {
  return typeof value === 'object' && value !== null && binarySnapshots.has(value)
}

/** The new profile preserves native values while retaining the same canonical portable graph owner. */
export function normalizeRuntimePortable(value: unknown): IRpcPortableValue {
  return normalizePortable(value, 0, new Set<object>(), true)
}

/** Validate the unpadded base64url spelling, including unused-bit canonicality. */
function isCanonicalBase64url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return false
  if (value.length === 0) return true
  const last = value[value.length - 1]!
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bits = alphabet.indexOf(last)
  if (bits < 0) return false
  if (value.length % 4 === 2) return (bits & 15) === 0
  if (value.length % 4 === 3) return (bits & 3) === 0
  return true
}

/** Convert a byte array to canonical unpadded base64url without Node dependencies. */
function toBase64url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    if (third !== undefined) output += alphabet[third & 63]
  }
  return output.replaceAll('+', '-').replaceAll('/', '_')
}

/** Validate and snapshot a portable value, reading each ordinary object field once. */
export function normalizePortable(
  value: unknown,
  depth?: number,
  active?: Set<object>
): IRpcWirePortableValue
/** Only the negotiated runtime branch may preserve a native value in the semantic snapshot. */
export function normalizePortable(
  value: unknown,
  depth: number,
  active: Set<object>,
  nativeBinary: boolean | (() => never)
): IRpcPortableValue
/** Keep the existing wire return domain distinct from the new runtime-native semantic domain. */
export function normalizePortable(
  value: unknown,
  depth = 0,
  active = new Set<object>(),
  nativeBinary: boolean | (() => never) = false
): IRpcPortableValue {
  if (depth > RPC_PORTABLE_MAX_DEPTH)
    throw createContractError(RpcContractErrorCode.invalidEnvelope)
  if (value === null) return null
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value
    case 'number':
      if (!Number.isFinite(value)) throw createContractError(RpcContractErrorCode.invalidEnvelope)
      return value
    case 'object':
      break
    default:
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
  }
  /** Whether the value has genuine Uint8Array slots; nearby checks may still trap. */
  let bytes: boolean
  try {
    bytes = isUint8Array(value)
    if (!bytes && (value instanceof Date || value instanceof Map || value instanceof Set))
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
  } catch (error) {
    if (isContractError(error)) throw error
    throw createContractError(RpcContractErrorCode.invalidEnvelope, error)
  }
  if (bytes) {
    if (typeof nativeBinary === 'function') nativeBinary()
    if (nativeBinary === true) {
      /** Shared backings are never permitted, including when exposed by an otherwise genuine view. */
      if (!isArrayBuffer(Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'buffer', value)))
        throw createContractError(RpcContractErrorCode.invalidEnvelope)
      binarySnapshots.add(value)
      return value as Uint8Array
    }
    return Object.freeze({
      $rpc: 'bytes',
      base64url: toBase64url(new Uint8Array(value as Uint8Array))
    }) as IRpcPortableBytes
  }
  if (typeof nativeBinary === 'function' && isArrayBuffer(value)) nativeBinary()
  if (nativeBinary === true && isArrayBuffer(value)) {
    binarySnapshots.add(value)
    return value
  }
  if (active.has(value)) throw createContractError(RpcContractErrorCode.invalidEnvelope)
  active.add(value)
  if (Array.isArray(value)) {
    try {
      /** Native-profile arrays are dense own data snapshots, with no getter execution. */
      if (nativeBinary === true) {
        const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
          string,
          PropertyDescriptor
        >
        /** Array length is a genuine own data slot in the same snapshot as its elements. */
        const length = descriptors.length!.value as number
        if (Reflect.ownKeys(descriptors).length !== length + 1)
          throw createContractError(RpcContractErrorCode.invalidEnvelope)
        /** Consume descriptors directly; inherited array methods never observe application data. */
        const result: IRpcPortableValue[] = []
        /** Binary proof is minted during this one normalization traversal. */
        let binary = false
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)]
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw createContractError(RpcContractErrorCode.invalidEnvelope)
          const normalized = normalizePortable(descriptor.value, depth + 1, active, nativeBinary)
          if (hasRpcPortableBinary(normalized)) binary = true
          result.push(normalized)
        }
        if (binary) binarySnapshots.add(result)
        return Object.freeze(result)
      }
      /** Legacy arrays retain their existing traversal and do not record native binary proof. */
      return Object.freeze(
        value.map((item) => normalizePortable(item, depth + 1, active, nativeBinary))
      ) as readonly IRpcPortableValue[]
    } catch (error) {
      if (isContractError(error)) throw error
      throw createContractError(RpcContractErrorCode.invalidEnvelope, error)
    } finally {
      active.delete(value)
    }
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch (error) {
    active.delete(value)
    throw createContractError(RpcContractErrorCode.invalidEnvelope, error)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    active.delete(value)
    throw createContractError(RpcContractErrorCode.invalidEnvelope)
  }
  try {
    const source = value as Record<string, unknown>
    const keys = Object.keys(source)
    /** Only the negotiated binary profile tightens the graph to own data descriptors. */
    const descriptors = nativeBinary === true ? Object.getOwnPropertyDescriptors(source) : undefined
    if (descriptors && Reflect.ownKeys(descriptors).length !== keys.length)
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
    const entries = keys.map((key) => {
      const descriptor = descriptors?.[key]
      if (descriptors && (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')))
        throw createContractError(RpcContractErrorCode.invalidEnvelope)
      return [key, descriptors ? descriptor!.value : source[key]] as const
    })
    const values = new Map(entries)
    if (
      keys.length === 2 &&
      keys.includes('$rpc') &&
      values.get('$rpc') === 'bytes' &&
      typeof values.get('base64url') === 'string' &&
      isCanonicalBase64url(values.get('base64url') as string)
    ) {
      return Object.freeze({
        $rpc: 'bytes',
        base64url: values.get('base64url') as string
      }) as IRpcPortableBytes
    }
    const output: Record<string, IRpcPortableValue> = Object.create(null) as Record<
      string,
      IRpcPortableValue
    >
    for (const [key, child] of entries) {
      if (key === RESERVED) throw createContractError(RpcContractErrorCode.invalidEnvelope)
      output[key] = normalizePortable(child, depth + 1, active, nativeBinary)
      if (nativeBinary === true && hasRpcPortableBinary(output[key])) binarySnapshots.add(output)
    }
    return Object.freeze(output) as IRpcPortableRecord
  } catch (error) {
    if (isContractError(error)) throw error
    throw createContractError(RpcContractErrorCode.invalidEnvelope, error)
  } finally {
    active.delete(value)
  }
}

/** Detect an already-classified contract error so nested causes remain stable. */
function isContractError(value: unknown): value is Error & { readonly code: string } {
  return (
    value instanceof Error &&
    (value as { readonly source?: unknown }).source === RPC_CONTRACT_SOURCE &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  )
}
