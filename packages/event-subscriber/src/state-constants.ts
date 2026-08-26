/** Stable event protocol values; consumers should compare the exported constants, not inline text. */
export const EventSubscriberState = {
  abort: 'abort',
  fulfilled: 'fulfilled',
  rejected: 'rejected'
} as const

/** Stable synchronous fanout policies; queued delivery is opt-in for consumers that need it. */
export const EventDispatchPolicy = {
  recursive: 'recursive',
  queued: 'queued'
} as const

export type IEventDispatchPolicy = (typeof EventDispatchPolicy)[keyof typeof EventDispatchPolicy]

export type IEventSubscriberResultStatus = (typeof EventSubscriberState)[keyof Pick<
  typeof EventSubscriberState,
  'fulfilled' | 'rejected'
>]
