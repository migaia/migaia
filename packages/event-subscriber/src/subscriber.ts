/** Public entry for subscription helpers that operate through the canonical `subscribe()` contract. */
export { subscribeOnce, subscribeSubscriber, subscribeUntil } from './channel.js'
export type {
  IEventAbortSignal,
  IEventChannelLike,
  IEventContext,
  IEventListener,
  IEventSubscriber,
  IUnsubscribe
} from './types.js'
