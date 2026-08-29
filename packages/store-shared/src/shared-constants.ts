/** Shared-state wait modes used when Atomics.waitAsync is available. */
export const SharedWaitMode = { async: 'async' } as const

export type ISharedWaitMode = (typeof SharedWaitMode)[keyof typeof SharedWaitMode]

/** Magic word for the only supported shared-state ABI; old layouts fail closed. */
export const SHARED_ABI_MAGIC = 0x4d474149

/** Layout revision for the 64-bit generation/cursor ABI. */
export const SHARED_ABI_VERSION = 1

/** Self-describing layout kinds, preventing signal/array cross-attachment. */
export const SharedAbiKind = { signal: 1, array: 2 } as const

/** Header publication states; attachers accept only the fully initialized state. */
export const SharedAbiReady = { initializing: 0, ready: 1 } as const
