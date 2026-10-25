/**
 * Supplies the pure wire and native policies consumed by the shared portable walker, including
 * getter capture order, byte representation, scalar limits and frozen output. Traversal state stays
 * with the invoking walker rather than this policy module.
 */
import { isArrayBuffer } from '@migaia/utils/bytes'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import type { IPortableWalkerStrategy } from '@migaia/serialize'
import { createContractError } from '../contract/contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RPC_CONTRACT_SOURCE } from '../contract/error-text.js'
import { rpcPortableBackingLength, rpcPortableViewLength } from './intrinsics.js'

/** Preserve the wire strategy's inline-only binary branch in portable package declarations. */
type IRpcWirePortableStrategy = Extract<
  IPortableWalkerStrategy,
  Readonly<{ nativeByteLength?: never }>
>
/** Native policy must keep its intrinsic reader mandatory when SDK composes its binary hook. */
type IRpcNativePortableStrategy = Extract<
  IPortableWalkerStrategy,
  Readonly<{
    nativeByteLength: NonNullable<IPortableWalkerStrategy['nativeByteLength']>
  }>
>

/** Existing portable recursion budget is also reused by cold Runtime API method compilation. */
export const RPC_PORTABLE_MAX_DEPTH = 64

/** RPC's tag grammar belongs to Contract; serialize only supplies the canonical base64url tools. */
export const RpcPortableField = {
  marker: '$rpc',
  data: 'base64url',
  kind: 'bytes'
} as const

/** Distinct internal failure routing preserves the original prototype and raw binary boundaries. */
export const RpcPortableViolation = {
  invalid: 'rpc portable input is invalid',
  rawBinary: 'rpc portable binary operation failed',
  ancestor: 'ancestor',
  prototype: 'rpc portable prototype access failed'
} as const

/** Strategy context is inferred from the public factory contract without duplicating its helpers. */
type IRpcPortableContext = Parameters<IPortableWalkerStrategy['scalar']>[1]

/** Shallow record capture borrows only rejection and the canonical bytes-tag predicate. */
type IRpcPortableRecordContext = Pick<IRpcPortableContext, 'reject' | 'isCanonicalBase64url'>
/** Captured parent fields retain their original order before either walker visits descendants. */
type IRpcCapturedPortableRecord = Readonly<{
  entries: readonly (readonly [string, unknown])[]
  output?: Record<string, unknown>
  tag?: string
}>

/** Admitted scalar results remain unboxed to keep the request hot path allocation-free. */
type IRpcPortableScalar = null | boolean | number | string

/** Detect existing Contract errors so ordinary nested getter failures retain their exact identity. */
function isContractError(value: unknown): value is Error & { readonly code: string } {
  return (
    value instanceof Error &&
    (value as { readonly source?: unknown }).source === RPC_CONTRACT_SOURCE &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  )
}

/** Preserve native Contract classes and source/code while retaining trapped failures on cause. */
export function raiseRpcPortableViolation(
  reason: string,
  cause?: unknown,
  errorMetadata?: IRpcErrorWireMetadata
): never {
  if (reason === RpcPortableViolation.rawBinary || reason === RpcPortableViolation.ancestor)
    throw cause
  if (reason !== RpcPortableViolation.prototype && isContractError(cause)) throw cause
  throw createContractError(RpcContractErrorCode.invalidEnvelope, cause, errorMetadata)
}

/** RPC accepts only the existing scalar domain; returning the primitive avoids a node allocation. */
function rpcPortableScalar(value: unknown, context: IRpcPortableContext): IRpcPortableScalar {
  if (
    !(
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
  )
    context.reject(RpcPortableViolation.invalid)
  return value
}

/** Keep the original binary-brand and Date/Map/Set rejection inside their dedicated catch boundary. */
function rpcPortableByteView(value: object, context: IRpcPortableContext): value is Uint8Array {
  try {
    /** Genuine Uint8Array slots determine admission; public tags cannot forge this domain. */
    const bytes = context.isUint8Array(value)
    if (!bytes && (value instanceof Date || value instanceof Map || value instanceof Set))
      context.reject(RpcPortableViolation.invalid)
    return bytes
  } catch (cause) {
    return context.reject(RpcPortableViolation.invalid, cause)
  }
}

/** Ordinary records are plain or null-prototype; prototype traps always get a Contract wrapper. */
function admitRpcPortableRecord(value: object, context: Pick<IRpcPortableContext, 'reject'>): void {
  /** Capture the prototype once, with the old unconditional wrapper for a trapping lookup. */
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch (cause) {
    return context.reject(RpcPortableViolation.prototype, cause)
  }
  if (prototype !== Object.prototype && prototype !== null)
    context.reject(RpcPortableViolation.invalid)
}

/** Captured fields avoid a Map and never read tag getters a second time. */
function rpcPortableRecordResult(
  entries: (readonly [string, unknown])[],
  context: IRpcPortableRecordContext
): IRpcCapturedPortableRecord {
  /** Only two-field records can satisfy the complete RPC bytes tag shape. */
  if (entries.length === 2) {
    /** Captured discriminator, independent of the original record's getters. */
    let tag: unknown
    /** Captured text still needs alphabet, length and unused-bit canonicality. */
    let base64url: unknown
    for (const [key, child] of entries) {
      if (key === RpcPortableField.marker) tag = child
      else if (key === RpcPortableField.data) base64url = child
    }
    if (
      tag === RpcPortableField.kind &&
      typeof base64url === 'string' &&
      context.isCanonicalBase64url(base64url)
    )
      return { entries, tag: base64url }
  }
  return { entries, output: Object.create(null) as Record<string, unknown> }
}

/** Wire records capture every parent field before visiting children, preserving getter order. */
export function captureRpcWirePortableRecord(
  value: object,
  context: IRpcPortableRecordContext
): IRpcCapturedPortableRecord | undefined {
  if (Array.isArray(value)) return undefined
  admitRpcPortableRecord(value, context)
  /** The enumerable string-key domain retains its original own-key order. */
  const keys = Object.keys(value)
  /** Reuse the private key array for captured tuples instead of allocating a second array. */
  const entries = keys as unknown as (readonly [string, unknown])[]
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    entries[index] = [key, (value as Record<string, unknown>)[key]]
  }
  return rpcPortableRecordResult(entries, context)
}

/** Native records capture only enumerable own data descriptors, without executing getters. */
function rpcNativePortableRecord(
  value: object,
  context: IRpcPortableContext
): ReturnType<IPortableWalkerStrategy['record']> {
  if (Array.isArray(value)) return undefined
  admitRpcPortableRecord(value, context)
  /** Key order remains Object.keys order even though values come from the descriptor snapshot. */
  const keys = Object.keys(value)
  /** Descriptor capture excludes accessor, hidden and symbol fields from the negotiated domain. */
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).length !== keys.length)
    context.reject(RpcPortableViolation.invalid)
  /** Reuse the key array for captured tuples; no application accessor participates. */
  const entries = keys as unknown as (readonly [string, unknown])[]
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      context.reject(RpcPortableViolation.invalid)
    entries[index] = [key, descriptor.value]
  }
  return rpcPortableRecordResult(entries, context)
}

/** Reserved marker fields belong only to admitted atomic tags, never ordinary portable records. */
export function assertRpcPortableRecordKey(
  key: string,
  context: Pick<IRpcPortableContext, 'reject'>
): void {
  if (key === RpcPortableField.marker) context.reject(RpcPortableViolation.invalid)
}

/** Fresh null-prototype snapshots accept data assignments without a per-field descriptor object. */
function writeRpcPortableRecord(
  output: Record<string, unknown>,
  key: string,
  child: unknown
): void {
  output[key] = child
}

/** Native accounting uses Contract's existing intrinsic length readers without observing hooks. */
function rpcPortableNativeByteLength(value: Uint8Array | ArrayBuffer): number {
  return isArrayBuffer(value) ? rpcPortableBackingLength(value) : rpcPortableViewLength(value)
}

/** Contract's wire policy delegates all recursion, depth, base64url and ancestor ownership inward. */
export const rpcWirePortableStrategy: IRpcWirePortableStrategy = {
  maxDepth: RPC_PORTABLE_MAX_DEPTH,
  scalar: rpcPortableScalar,
  binary(value, context) {
    if (rpcPortableByteView(value, context)) {
      try {
        /** The public callback was a bare invocation, with no context object as its receiver. */
        const guard = context.beforeNativeBinary
        guard?.()
        return context.bytesToBase64url(new Uint8Array(value))
      } catch (cause) {
        return context.reject(RpcPortableViolation.rawBinary, cause)
      }
    }
    // A supplied unsupported-binary guard sees native backings at the original admission point.
    /** Capture the invocation guard as a lexical function, preserving its original receiver. */
    const guard = context.beforeNativeBinary
    if (guard !== undefined && isArrayBuffer(value)) {
      try {
        guard()
      } catch (cause) {
        return context.reject(RpcPortableViolation.rawBinary, cause)
      }
    }
    return undefined
  },
  record: captureRpcWirePortableRecord,
  arrayValue(value, visit, depth, ancestors, guard, bounds) {
    /** The existing mapper borrows one explicit traversal context without changing species. */
    const context = { visit, depth, ancestors, guard, bounds }
    /** Preserve map/species output without reading or probing its application-owned properties. */
    return value.map((child) => {
      /** Preserve the original bare visitor receiver rather than invoking it as a context method. */
      const visit = context.visit
      return visit(child, context.depth, context.ancestors, context.guard, context.bounds)
    })
  },
  key: assertRpcPortableRecordKey,
  write: writeRpcPortableRecord,
  finish: Object.freeze,
  violation: raiseRpcPortableViolation
}

/** Negotiated native policy keeps borrowed native identities and strict own-data snapshots. */
export const rpcNativePortableStrategy: IRpcNativePortableStrategy = {
  maxDepth: RPC_PORTABLE_MAX_DEPTH,
  scalar: rpcPortableScalar,
  binary(value, context) {
    if (rpcPortableByteView(value, context)) {
      try {
        /** Shared backings remain rejected even when presented through a genuine byte view. */
        if (
          !isArrayBuffer(Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'buffer', value))
        )
          context.reject(RpcPortableViolation.invalid)
        return value
      } catch (cause) {
        return context.reject(RpcPortableViolation.rawBinary, cause)
      }
    }
    if (isArrayBuffer(value)) {
      return value
    }
    return undefined
  },
  nativeByteLength: rpcPortableNativeByteLength,
  record: rpcNativePortableRecord,
  array(value, visit, context) {
    /** Capture genuine array slots together; inherited methods never observe application data. */
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      string,
      PropertyDescriptor
    >
    /** Native arrays require exactly their length slot and dense enumerable own data indices. */
    const length = descriptors.length!.value as number
    if (Reflect.ownKeys(descriptors).length !== length + 1)
      context.reject(RpcPortableViolation.invalid)
    /** Fresh plain array owns the normalized elements and receives binary proof at finish. */
    const output: unknown[] = []
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)]
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        context.reject(RpcPortableViolation.invalid)
      output.push(visit(descriptor.value))
    }
    return output
  },
  key: assertRpcPortableRecordKey,
  write: writeRpcPortableRecord,
  finish: Object.freeze,
  violation: raiseRpcPortableViolation
}
