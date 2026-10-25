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

/** Read the true length of an already brand-admitted backing without invoking application hooks. */
export function rpcPortableBackingLength(value: ArrayBuffer): number {
  return Reflect.apply(backingLengthGetter, value, []) as number
}

/** Read the true visible byte length of an already brand-admitted view without application hooks. */
export function rpcPortableViewLength(value: Uint8Array): number {
  return Reflect.apply(viewLengthGetter, value, []) as number
}
