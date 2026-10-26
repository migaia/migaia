import { chunk } from '@migaia/rpc-host/plugins/chunk'

/** Assembly expiry uses the supported timer admission and cancellation callbacks. */
chunk({ assemblyTimeoutMs: 10, schedule: () => 1, cancel: () => undefined })

// @ts-expect-error The unused clock option was removed; expiry belongs to schedule/cancel.
chunk({ now: () => 0 })
