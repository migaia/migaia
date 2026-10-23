import { isArrayBuffer } from '@migaia/utils/bytes'

/** Native view constructors recreate internal slots without reading a payload's constructor getter. */
const NativeViewConstructor = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array
}
/** Intrinsic typed-array access reads internal slots rather than caller-defined payload getters. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)

/** Read byte payload length without serializing structured-clone values or allocating a buffer. */
export function carrierSizeBytes(message: unknown): number {
  if (message instanceof ArrayBuffer)
    return Reflect.get(ArrayBuffer.prototype, 'byteLength', message)
  if (ArrayBuffer.isView(message)) {
    /** DataView lacks a typed-array tag but shares the native view byte-length contract. */
    const prototype =
      Reflect.get(typedArrayPrototype, Symbol.toStringTag, message) === undefined
        ? DataView.prototype
        : typedArrayPrototype
    return Reflect.get(prototype, 'byteLength', message)
  }
  return -1
}

/**
 * Captured containers remain references under the closure nested-transfer ruling. Only a directly
 * captured native backing/view in this send's transfer list needs preservation; no member scan
 * runs.
 */
export function captureTransferredContent(
  message: unknown,
  transfer: readonly unknown[] | undefined
): unknown {
  if (transfer === undefined) return message
  if (isArrayBuffer(message)) {
    if (!transfer.includes(message)) return message
    // This directly captured backing would detach at the actual send boundary.
    return new Uint8Array(message).slice().buffer
  }
  if (!ArrayBuffer.isView(message)) return message
  /** Intrinsic slots avoid additional caller getter execution during capture. */
  const tag = Reflect.get(typedArrayPrototype, Symbol.toStringTag, message) as
    | keyof typeof NativeViewConstructor
    | undefined
  /** DataView's slots live on its own prototype; typed arrays share one intrinsic owner. */
  const prototype = tag === undefined ? DataView.prototype : typedArrayPrototype
  /** Only the directly captured backing is compared with the actual send's transfer list. */
  const backing = Reflect.get(prototype, 'buffer', message) as ArrayBuffer
  if (!transfer.includes(backing)) return message
  // One native backing conversion preserves the directly captured view before detachment.
  /** Captured views retain their original offsets and native element representation. */
  const copied = new Uint8Array(backing).slice().buffer
  /** Intrinsic offset reads never evaluate custom payload properties. */
  const offset = Reflect.get(prototype, 'byteOffset', message) as number
  // The replacement native view is required to address the preserved backing.
  return tag === undefined
    ? new DataView(copied, offset, Reflect.get(prototype, 'byteLength', message))
    : new NativeViewConstructor[tag](copied, offset, Reflect.get(prototype, 'length', message))
}
