/** Shared-state wait modes used when Atomics.waitAsync is available. */
export const SharedWaitMode = { async: 'async' } as const

export type ISharedWaitMode = (typeof SharedWaitMode)[keyof typeof SharedWaitMode]
