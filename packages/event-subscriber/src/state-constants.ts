/** Stable event protocol values; consumers should compare the exported constants, not inline text. */
export const EventSubscriberState = {
  /** Event name used when installing or removing a signal's abort observer. */
  abort: 'abort',
  /** A settled listener completed successfully and carries its awaited value. */
  fulfilled: 'fulfilled',
  /** A settled listener failed and carries the original reason. */
  rejected: 'rejected'
} as const

/** Selects the listener argument without changing channel dispatch or registration ownership. */
export const EventDelivery = {
  /** Default delivery exposes the payload together with live registration controls. */
  context: 'context',
  /** Delivers the original payload without allocating or exposing a listener context. */
  value: 'value'
} as const

/** Public listener-argument choices; omitted delivery retains the context contract. */
export type EventDelivery = keyof typeof EventDelivery

/** Stable synchronous fanout policies; queued delivery is opt-in for consumers that need it. */
export const EventDispatchPolicy = {
  /** Default: synchronously deliver a nested publish before resuming its caller's snapshot. */
  recursive: 'recursive',
  /** Complete the current snapshot before delivering values published during that snapshot. */
  queued: 'queued'
} as const

/** Supported nested synchronous dispatch choices; recursive is the construction default. */
export type IEventDispatchPolicy = (typeof EventDispatchPolicy)[keyof typeof EventDispatchPolicy]

/** Stable channel admission modes; unique registration is opt-in for identity-based consumers. */
export const EventAdmissionPolicy = {
  /** Default: each subscribe call owns a separate registration, even for the same function. */
  multiple: 'multiple',
  /** Reuse one live registration for the same function identity and matching task label. */
  unique: 'unique'
} as const

/** Supported listener admission choices; unique is opt-in and scoped to one channel. */
export type IEventAdmissionPolicy = (typeof EventAdmissionPolicy)[keyof typeof EventAdmissionPolicy]

/** Result-status discriminant for settled asynchronous invocation helpers. */
export type IEventSubscriberResultStatus = (typeof EventSubscriberState)[keyof Pick<
  typeof EventSubscriberState,
  'fulfilled' | 'rejected'
>]

/** Controls whether a channel handle releases one registration or every equal listener identity. */
export const EventRemovalPolicy = {
  /** Default: a subscription release removes only the registration it owns. */
  handle: 'handle',
  /** A release removes all currently live registrations with the same listener function identity. */
  listenerAll: 'listener-all'
} as const

/** Supported subscription-release scope; handle is the default and listener-all is explicit. */
export type IEventRemovalPolicy = (typeof EventRemovalPolicy)[keyof typeof EventRemovalPolicy]
