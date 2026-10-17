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

/** Read the true length of an already brand-admitted backing without invoking application hooks. */
export function rpcPortableBackingLength(value: ArrayBuffer): number {
  return Reflect.apply(backingLengthGetter, value, []) as number
}

/** Read the true visible byte length of an already brand-admitted view without application hooks. */
export function rpcPortableViewLength(value: Uint8Array): number {
  return Reflect.apply(viewLengthGetter, value, []) as number
}

/** Preserve normalization's original data-only proof write without claiming an SDK realm. */
export function recordRpcPortableSnapshot(value: object): void {
  binarySnapshots.add(value)
}

/** Marks a value as a portable binary snapshot for later protocol capture. */
export function markRpcPortableBinary(value: object): void {
  recordRpcPortableSnapshot(value)
}

/** Sender branch selection reads the proof minted during the original single portable walk. */
export function hasRpcPortableBinary(value: unknown): boolean {
  return typeof value === 'object' && value !== null && binarySnapshots.has(value)
}
