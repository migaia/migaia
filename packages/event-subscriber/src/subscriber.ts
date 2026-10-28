/** Public entry for subscription helpers that operate through the canonical `subscribe()` contract. */
export {
  subscribeOnce,
  subscribeSubscriber,
  subscribeUntil
} from './internal/source-subscription.ts'
export type {
  IEventChannelLike,
  IEventContext,
  IEventListener,
  IEventSubscriber,
  IUnsubscribe
} from './types.ts'
