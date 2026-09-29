/** Coroutine task settlement as data rather than a rejecting exited promise. */
export const CoroutineOutcome = { fulfilled: 'fulfilled', rejected: 'rejected' } as const
export type CoroutineOutcome = (typeof CoroutineOutcome)[keyof typeof CoroutineOutcome]

/** Cooperative termination cannot enforce isolation from the shared event loop. */
export const coroutineCapabilities = Object.freeze({
  termination: 'cooperative',
  'fault-isolation': 'unsupported'
} as const)
