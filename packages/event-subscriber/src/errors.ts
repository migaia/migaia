import {
  EVENT_SUBSCRIBER_SOURCE,
  EventSubscriberErrorCode,
  type IEventSubscriberErrorCode
} from './error-code.js';
import { EventSubscriberErrorText } from './error-text.js';

type IEventError = Error & {
  readonly source?: string;
  readonly code?: string;
  readonly cause?: unknown;
};

/**
 * Detects native Error-family objects across realms without invoking user-provided methods.
 * Prototype inspection is guarded because revoked proxies can throw from every structural read.
 */
const isNativeErrorValue = (value: object): boolean => {
  try {
    if (value instanceof Error) return true;
    let prototype: object | null = Object.getPrototypeOf(value);
    for (let depth = 0; prototype !== null && depth < 32; depth += 1) {
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      const constructorPrototype =
        typeof constructor === 'function'
          ? Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value
          : undefined;
      const name = Object.getOwnPropertyDescriptor(prototype, 'name')?.value;
      const toString = Object.getOwnPropertyDescriptor(prototype, 'toString')?.value;
      if (
        constructorPrototype === prototype &&
        name === 'Error' &&
        typeof toString === 'function'
      ) {
        return true;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return false;
  } catch {
    throw value;
  }
};

/** Adds the package contract without replacing the original native error object. */
export const attachEventErrorCode = <T extends object>(
  error: T,
  code: IEventSubscriberErrorCode
): T & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
  readonly code: IEventSubscriberErrorCode;
} => {
  try {
    Object.defineProperty(error, 'source', { value: EVENT_SUBSCRIBER_SOURCE, enumerable: true });
    Object.defineProperty(error, 'code', { value: code, enumerable: true });
    return error as T & {
      readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
      readonly code: IEventSubscriberErrorCode;
    };
  } catch (attachError) {
    const wrapped = new TypeError(eventErrorText(code), { cause: error });
    Object.defineProperty(wrapped, 'source', { value: EVENT_SUBSCRIBER_SOURCE, enumerable: true });
    Object.defineProperty(wrapped, 'code', { value: code, enumerable: true });
    Object.defineProperty(wrapped, 'detail', { value: { attachError }, enumerable: true });
    return wrapped as unknown as T & {
      readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
      readonly code: IEventSubscriberErrorCode;
    };
  }
};

/** Creates a native TypeError while preserving the original hostile value as cause. */
export const createEventTypeError = (
  code: IEventSubscriberErrorCode,
  message: string,
  cause?: unknown
): TypeError & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
  readonly code: IEventSubscriberErrorCode;
} => {
  const error = new TypeError(message, cause === undefined ? undefined : { cause });
  return attachEventErrorCode(error, code);
};

/**
 * Codes genuine Error values in place and wraps every other thrown value in a native TypeError.
 * Hostile proxy inspection is itself converted to a coded TypeError so no shape probe can escape
 * the package boundary uncoded.
 */
export const codeExistingError = (value: unknown, code: IEventSubscriberErrorCode): unknown => {
  const objectLike = (typeof value === 'object' && value !== null) || typeof value === 'function';
  if (!objectLike) return createEventTypeError(code, eventErrorText(code), value);
  try {
    return isNativeErrorValue(value as object)
      ? attachEventErrorCode(value as object, code)
      : createEventTypeError(code, eventErrorText(code), value);
  } catch {
    return createEventTypeError(code, eventErrorText(code), value);
  }
};

/** Creates the AggregateError shape required for publish and late-failure diagnostics. */
export const createEventAggregateError = (
  code: IEventSubscriberErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
  readonly code: IEventSubscriberErrorCode;
} => {
  const error = new AggregateError(errors, message, { cause: errors[0] });
  return attachEventErrorCode(error, code);
};

/** Returns a stable text for a package error code. */
export const eventErrorText = (code: IEventSubscriberErrorCode): string => {
  const entry: Record<IEventSubscriberErrorCode, string> = {
    [EventSubscriberErrorCode.invalidListener]: EventSubscriberErrorText.invalidListener,
    [EventSubscriberErrorCode.invalidReporter]: EventSubscriberErrorText.invalidReporter,
    [EventSubscriberErrorCode.invalidChannel]: EventSubscriberErrorText.invalidChannel,
    [EventSubscriberErrorCode.invalidSignal]: EventSubscriberErrorText.invalidSignal,
    [EventSubscriberErrorCode.invalidSubscriber]: EventSubscriberErrorText.invalidSubscriber,
    [EventSubscriberErrorCode.invalidEventKey]: EventSubscriberErrorText.invalidEventKey,
    [EventSubscriberErrorCode.taskNotFound]: EventSubscriberErrorText.taskNotFound,
    [EventSubscriberErrorCode.taskNotUnique]: EventSubscriberErrorText.taskNotUnique,
    [EventSubscriberErrorCode.invalidTaskId]: EventSubscriberErrorText.invalidTaskId,
    [EventSubscriberErrorCode.invalidOptions]: EventSubscriberErrorText.invalidOptions,
    [EventSubscriberErrorCode.publishFailed]: EventSubscriberErrorText.publishFailed,
    [EventSubscriberErrorCode.unhandledListenerFailure]:
      EventSubscriberErrorText.unhandledListenerFailure
  };
  return entry[code];
};

export type IEventErrorWithCode = IEventError & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE;
  readonly code: IEventSubscriberErrorCode;
};
