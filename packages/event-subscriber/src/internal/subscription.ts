import { EventSubscriberErrorCode } from '../error-code.js';
import { createEventError, eventErrorText } from '../errors.js';
import type { IUnsubscribe } from '../types.js';

/** Builds one callable, chain-owning subscription handle. */
type ISubscriptionHandle<T> = IUnsubscribe & {
  readonly unsubscribe: ISubscriptionHandle<T>;
  readonly subscribe: (...args: never[]) => ISubscriptionHandle<T>;
};

export const createRawSubscriptionOwner = <T extends ISubscriptionHandle<unknown>>(
  first: () => void,
  extend: (...args: never[]) => void | (() => void)
): T => {
  const disposers: Array<() => void> = [first];
  let closed = false;
  const handle = (() => {
    if (closed) return;
    closed = true;
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      disposers[index]();
    }
    disposers.length = 0;
  }) as T;
  Object.defineProperties(handle, {
    unsubscribe: { value: handle, enumerable: false, writable: false, configurable: false },
    subscribe: {
      value: (...args: never[]) => {
        if (closed) {
          throw createEventError(
            EventSubscriberErrorCode.subscriptionClosed,
            eventErrorText(EventSubscriberErrorCode.subscriptionClosed)
          );
        }
        const disposer = extend(...args);
        if (typeof disposer === 'function') disposers.push(disposer);
        return handle;
      },
      enumerable: false,
      writable: false,
      configurable: false
    }
  });
  return handle;
};

/** Builds public subscription handles through the shared raw owner. */
export const createSubscriptionHandle = createRawSubscriptionOwner;
