/** Original binary descriptor/array/budget gates with explicit per-operation error ownership. */
import {
  measurePortableStreamValue,
  RpcStreamViolation,
  RpcWirePointer
} from '@migaia/rpc-contract/protocol'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { isCanonicalBase64url } from '@migaia/serialize/core'
import {
  createContractError,
  safeRead,
  type IRpcErrorWireMetadata
} from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import {
  normalizePortable,
  rpcPortableBackingLength,
  rpcPortableViewLength
} from '@migaia/rpc-contract/portable'
import { RpcBinaryViolation } from './binary-constants.ts'

/** Actual binary default allocation ceiling retains the existing sixteen MiB bounded codec domain. */
export const RPC_BINARY_MAX_BYTES = 16 * 1024 * 1024
/** Intrinsic typed-array reads preserve original slots rather than application shadow properties. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
/** One captured intrinsic retrieves the genuine non-shared backing identity. */
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!
/** One captured intrinsic preserves the original visible-view offset. */
const offsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!

/** One binary operation borrows the actual caller's error presentation maps without a singleton. */
export class BinaryShape {
  /** Contract error provenance is explicit and remains owned by the actual host/codec. */
  readonly #metadata: IRpcErrorWireMetadata | undefined
  /** Allocation is charged to this operation alone, never a provider quota or retained global. */
  #remaining: number
  /** Undefined disables accounting; a bounded stream root fuses bytes into the existing walk. */
  #semanticBytes: number | undefined
  /** Capture the original byte bound and metadata before touching caller graph data. */
  constructor(limit = RPC_BINARY_MAX_BYTES, errorMetadata?: IRpcErrorWireMetadata) {
    this.#metadata = errorMetadata
    this.#remaining = Math.min(limit, RPC_BINARY_MAX_BYTES)
  }
  /** Only a bounded stream root activates accounting during the existing codec traversal. */
  beginSemantic(): void {
    this.#semanticBytes = 0
  }
  /** Leaving the original root disables all scalar/key work for ordinary portable slots. */
  endSemantic(): void {
    this.#semanticBytes = undefined
  }
  /** Scalar/native leaf accounting reuses the exact established stream measurement rules. */
  semanticValue(value: IRpcPortableValue): void {
    if (this.#semanticBytes !== undefined) this.#semanticBytes += measurePortableStreamValue(value)
  }
  /** Container punctuation is charged once as the original codec descends its captured children. */
  semanticContainer(length: number): void {
    if (this.#semanticBytes !== undefined) this.#semanticBytes += 2 + Math.max(0, length - 1)
  }
  /** Existing JSON string rules account for one captured original key plus its colon. */
  semanticKey(key: string): void {
    if (this.#semanticBytes !== undefined)
      this.#semanticBytes += measurePortableStreamValue(key) + 1
  }
  /**
   * A custom slot projection must enforce the original value limit rather than its encoded tuple
   * size.
   */
  semanticLimit(limit: number): void {
    if (this.#semanticBytes !== undefined && this.#semanticBytes > limit) {
      /** The existing stream budget diagnostic identifies this exact portable-value boundary. */
      const error = createContractError(
        RpcContractErrorCode.invalidEnvelope,
        undefined,
        this.#metadata
      )
      Object.defineProperties(error, {
        violation: { value: RpcStreamViolation.budget, enumerable: true },
        pointer: { value: RpcWirePointer.stream, enumerable: true }
      })
      throw error
    }
  }

  /** Preserve Contract native TypeError and original cause at the same invalid-envelope boundary. */
  invalid(cause?: unknown, pointer?: string): never {
    /** Rewrapping retains the original boundary diagnostic as well as the native cause. */
    const error = createContractError(RpcContractErrorCode.invalidEnvelope, cause, this.#metadata)
    /** Existing Contract failures carry their first invalid field through the restore boundary. */
    const location = pointer ?? safeRead(cause, 'pointer')
    if (typeof location === 'string')
      Object.defineProperty(error, 'pointer', { value: location, enumerable: true })
    /** The stream budget distinction remains observable after the original restore wrapper. */
    const violation = safeRead(cause, 'violation')
    if (typeof violation === 'string')
      Object.defineProperty(error, 'violation', { value: violation, enumerable: true })
    throw error
  }
  /** Integrity is actual local digest/length evidence, separate from structural shape failure. */
  integrity(): never {
    /** Existing callers identify this violation through the original cause chain. */
    const error = createContractError(
      RpcContractErrorCode.invalidEnvelope,
      undefined,
      this.#metadata
    )
    Object.defineProperty(error, 'violation', {
      value: RpcBinaryViolation.integrity,
      enumerable: true
    })
    throw error
  }
  /** Whole native backing budgets use genuine internal length rather than shadow properties. */
  backingLength(value: unknown): number {
    if (!isArrayBuffer(value)) this.invalid()
    return rpcPortableBackingLength(value)
  }
  /** Supported byte views retain exact original backing, offset and visible length. */
  view(value: Uint8Array): Readonly<{ backing: ArrayBuffer; offset: number; length: number }> {
    /** Shared backing admission stays at the original intrinsic binary boundary. */
    const backing = Reflect.apply(bufferGetter, value, []) as ArrayBuffer
    if (!isArrayBuffer(backing)) this.invalid()
    return {
      backing,
      offset: Reflect.apply(offsetGetter, value, []) as number,
      length: rpcPortableViewLength(value)
    }
  }
  /** Dense own-data arrays retain descriptor admission and one original snapshot. */
  array(value: unknown, pointer?: string): readonly unknown[] {
    if (!Array.isArray(value)) this.invalid(undefined, pointer)
    /** The same single descriptor capture excludes symbols, holes and application accessors. */
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      string,
      PropertyDescriptor
    >
    /** Actual length is an intrinsic array data slot, never an evaluated getter. */
    const length = descriptors.length!.value as number
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      Reflect.ownKeys(descriptors).length !== length + 1
    )
      this.invalid(undefined, pointer)
    /** Accepted items are copied once before any asynchronous digest operation. */
    const output: unknown[] = []
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)]
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        this.invalid(undefined, pointer)
      output.push(descriptor.value)
    }
    return output
  }
  /** Snapshot original enumerable own data fields in own-key order without executing getters. */
  record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) this.invalid()
    /** Plain or null prototype is the established portable record domain. */
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) this.invalid()
    /** Exactly one descriptor capture retains original own-key ordering. */
    const descriptors = Object.getOwnPropertyDescriptors(value)
    /** Null prototype preserves explicit **proto** business keys. */
    const output: Record<string, unknown> = Object.create(null)
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') this.invalid()
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) this.invalid()
      output[key] = descriptor.value
    }
    return output
  }
  /**
   * Reserved bytes tags retain existing admission, while ordinary keys preserve JSON insertion
   * order.
   */
  keys(value: Record<string, unknown>): string[] {
    if (Object.hasOwn(value, '$rpc')) normalizePortable(value, 0, undefined, false, this.#metadata)
    return Object.keys(value)
  }
  /** One original allocation budget charges whole backing bytes and inline view prefixes. */
  readonly consume = (bytes: number): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#remaining) this.invalid()
    this.#remaining -= bytes
  }
  /** Offset, length and index share the exact original nonnegative safe-integer domain. */
  integer(value: unknown, pointer?: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) this.invalid(undefined, pointer)
    return value as number
  }
  /** SHA-256 spellings remain exact lowercase hex and never select a digest algorithm. */
  digest(value: unknown, pointer?: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value))
      this.invalid(undefined, pointer)
    return value
  }

  /** Complete signed inline backings reuse the canonical unpadded byte spelling. */
  inlineData(value: unknown, pointer?: string): string {
    if (typeof value !== 'string' || !isCanonicalBase64url(value)) this.invalid(undefined, pointer)
    return value
  }
}
