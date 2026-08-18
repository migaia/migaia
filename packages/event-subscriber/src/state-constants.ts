/** Stable event protocol values; consumers should compare the exported constants, not inline text. */
export const EventSubscriberState = {
  abort: 'abort',
  fulfilled: 'fulfilled',
  rejected: 'rejected'
} as const;

export type IEventSubscriberResultStatus = (typeof EventSubscriberState)[keyof Pick<
  typeof EventSubscriberState,
  'fulfilled' | 'rejected'
>];
