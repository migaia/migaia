import { EventSubscriberErrorCode } from './error-code.js';
import {
  attachEventErrorCode,
  codeExistingError,
  createEventAggregateError,
  createEventTypeError,
  eventErrorText
} from './errors.js';
import type {
  ICanonicalEventChannel,
  IEventChannelLike,
  IEventChannelOptions,
  IEventContext,
  IEventDispatchSnapshot,
  IEventListener,
  IEventAbortSignal,
  IFilteredEventChannel,
  IUnsubscribe
} from './types.js';
import { createSubscriptionHandle } from './internal/subscription.js';
import { EventSubscriberState } from './state-constants.js';
import {
  createSystemTerminalRuntime,
  type IEventTerminalRuntime
} from './internal/terminal-runtime.js';

type IRegistrationOwner<T, R> = {
  listener: IEventListener<T, R>;
  active: boolean;
  aborted: boolean;
  abortReason: unknown;
  currentTaskId: string | undefined;
  previous: IRegistrationOwner<T, R> | undefined;
  next: IRegistrationOwner<T, R> | undefined;
  release: IUnsubscribe;
};

type IChannelCapability<T, R> = {
  snapshot(taskId?: string): readonly IEventDispatchSnapshot<T, R>[];
};

type IFilteredCapability<T, R> = {
  readonly channel: ICanonicalEventChannel<T, R>;
  readonly taskId: string;
};

type IValidatedChannel<T, R> = IEventChannelLike<T, R> & {
  readonly subscribe: IEventChannelLike<T, R>['subscribe'];
};

/** Runtime identity for canonical channels; structural lookalikes never enter async helpers. */
const channelCapabilities = new WeakMap<object, IChannelCapability<unknown, unknown>>();

/** Runtime identity for filtered views; the public object carries no mutable channel state. */
const filteredCapabilities = new WeakMap<object, IFilteredCapability<unknown, unknown>>();

/** The host adapter is lazy and does not inspect globals until a terminal failure occurs. */
const systemTerminalRuntime = createSystemTerminalRuntime();

/** Reads an own/public option object without accepting null, arrays, or functions. */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  return !Array.isArray(value);
};

/** Validates a task label before it can enter a registration or selection index. */
export const validateTaskId = (value: unknown, allowUndefined: boolean): string | undefined => {
  if (value === undefined && allowUndefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidTaskId,
      eventErrorText(EventSubscriberErrorCode.invalidTaskId)
    );
  }
  return value;
};

/** Validates a listener option record and reads taskId once. */
const readTaskOption = (options: unknown): string | undefined => {
  if (options === undefined) return undefined;
  try {
    if (!isRecord(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      );
    }
    return validateTaskId(options.taskId, true);
  } catch (error) {
    let isTaskIdError = false;
    try {
      isTaskIdError =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        (error as { readonly code?: unknown }).code === EventSubscriberErrorCode.invalidTaskId;
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions);
    }
    if (isTaskIdError) throw error;
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions);
  }
};

/** Validates a structural channel before registration state can be changed. */
export const validateChannelLike = <T, R>(channel: unknown): IValidatedChannel<T, R> => {
  try {
    if (!isRecord(channel) && typeof channel !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
    if (!('subscribe' in (channel as object))) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
  }
  return {
    subscribe(listener, options) {
      try {
        return (channel as IEventChannelLike<T, R>).subscribe(listener, options);
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
      }
    }
  };
};

/** Creates a live event context over a registration owner. */
export const createEventContext = <T, R>(
  value: T,
  snapshot: IEventDispatchSnapshot<T, R>
): IEventContext<T> => ({
  get value() {
    return value;
  },
  get aborted() {
    return snapshot.control.aborted;
  },
  get abortReason() {
    return snapshot.control.abortReason;
  },
  get taskId() {
    return snapshot.taskId;
  },
  abort(reason?: unknown) {
    snapshot.control.abort(reason);
  },
  setTaskId(taskId: string | undefined) {
    snapshot.control.setTaskId(taskId);
  }
});

/** Builds a snapshot whose task label is frozen while abort state remains live. */
const snapshotOwner = <T, R>(owner: IRegistrationOwner<T, R>): IEventDispatchSnapshot<T, R> =>
  Object.freeze({
    listener: owner.listener,
    taskId: owner.currentTaskId,
    control: Object.freeze({
      get active() {
        return owner.active;
      },
      get aborted() {
        return owner.aborted;
      },
      get abortReason() {
        return owner.abortReason;
      },
      abort(reason?: unknown) {
        if (!owner.active) return;
        owner.aborted = true;
        owner.abortReason = reason;
        owner.release();
      },
      setTaskId(taskId: string | undefined) {
        if (!owner.active) return;
        owner.currentTaskId = validateTaskId(taskId, true);
      }
    })
  });

/** Invokes one snapshot entry and returns its raw listener result. */
export const invokeSnapshot = <T, R>(
  snapshot: IEventDispatchSnapshot<T, R>,
  value: T
): R | PromiseLike<R> => snapshot.listener(createEventContext(value, snapshot));

/** Reads one dispatch snapshot from a canonical channel or filtered capability. */
export const getCapability = <T, R>(
  channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>
): { readonly capability: IChannelCapability<T, R>; readonly taskId: string | undefined } => {
  const filtered = filteredCapabilities.get(channel as object) as
    | IFilteredCapability<T, R>
    | undefined;
  if (filtered) {
    const capability = channelCapabilities.get(filtered.channel as object) as
      | IChannelCapability<T, R>
      | undefined;
    if (!capability)
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    return { capability, taskId: filtered.taskId };
  }
  const capability = channelCapabilities.get(channel as object) as
    | IChannelCapability<T, R>
    | undefined;
  if (!capability)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    );
  return { capability, taskId: undefined };
};

/** Reports a late listener rejection without making synchronous publish awaitable. */
export const reportLateFailure = <T>(
  options: IEventChannelOptions<T>,
  event: IEventContext<T>,
  failure: unknown
): void => {
  const diagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    [failure],
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  );
  const report = options.report;
  if (report) {
    let reportResult: void | PromiseLike<void>;
    try {
      reportResult = report({ event, error: failure });
    } catch (error) {
      reportTerminal(options, diagnostic, error);
      return;
    }
    observePromiseLike(
      reportResult,
      () => undefined,
      (error) => reportTerminal(options, diagnostic, error)
    );
    return;
  }
  reportTerminal(options, diagnostic, undefined);
};

/**
 * Observes any promise-like value through native Promise assimilation. Native assimilation
 * preserves the original thenable receiver and turns a hostile `then` getter into an asynchronously
 * observed rejection instead of a synchronous publish failure.
 */
export const observePromiseLike = (
  value: unknown,
  onFulfilled: () => void,
  onRejected: (error: unknown) => void
): void => {
  Promise.resolve(value).then(onFulfilled, onRejected);
};

/** Final fallback chain. Runtime access is isolated here so core channel code has no host branch. */
const reportTerminal = <T>(
  options: IEventChannelOptions<T>,
  diagnostic: AggregateError,
  failure: unknown
): void => {
  const errors = failure === undefined ? diagnostic.errors : [...diagnostic.errors, failure];
  const nextDiagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    errors,
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  );
  const terminal = options.terminalReport;
  if (terminal) {
    try {
      const result = terminal(nextDiagnostic);
      observePromiseLike(
        result,
        () => undefined,
        (error) => reportSystemTerminal(nextDiagnostic, error)
      );
      return;
    } catch (error) {
      reportSystemTerminal(nextDiagnostic, error);
      return;
    }
  }
  reportSystemTerminal(nextDiagnostic, undefined);
};

/** Uses host terminal sinks only after user-owned reporters have failed or are absent. */
const reportSystemTerminal = (
  diagnostic: AggregateError,
  failure: unknown,
  runtime: IEventTerminalRuntime = systemTerminalRuntime
): void => {
  const errors = failure === undefined ? [...diagnostic.errors] : [...diagnostic.errors, failure];
  const appendFailure = (error: unknown): void => {
    errors.push(error);
  };
  const currentDiagnostic = (): AggregateError =>
    createEventAggregateError(
      EventSubscriberErrorCode.unhandledListenerFailure,
      errors,
      eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
    );
  try {
    if (runtime.reportError(currentDiagnostic())) {
      return;
    }
  } catch (error) {
    appendFailure(error);
  }
  try {
    if (runtime.consoleError(currentDiagnostic())) {
      return;
    }
  } catch (error) {
    appendFailure(error);
  }
  runtime.enqueueThrow(currentDiagnostic());
};

/** Creates a canonical transient channel backed by an O(1) linked registration list. */
export const createCanonicalChannel = <T, R = void>(
  options: IEventChannelOptions<T> = {}
): ICanonicalEventChannel<T, R> => {
  let report: IEventChannelOptions<T>['report'];
  let terminalReport: IEventChannelOptions<T>['terminalReport'];
  try {
    if (!isRecord(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      );
    }
    report = options.report;
    terminalReport = options.terminalReport;
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions);
  }
  if (report !== undefined && typeof report !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    );
  }
  if (terminalReport !== undefined && typeof terminalReport !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    );
  }
  const normalizedOptions: IEventChannelOptions<T> = { report, terminalReport };
  let first: IRegistrationOwner<T, R> | undefined;
  let last: IRegistrationOwner<T, R> | undefined;
  let count = 0;
  const registerRaw = (
    listener: IEventListener<T, R>,
    taskId: string | undefined
  ): (() => void) => {
    let released = false;
    const owner = {} as IRegistrationOwner<T, R>;
    const release = (): void => {
      if (released || !owner.active) return;
      released = true;
      owner.active = false;
      if (owner.previous) owner.previous.next = owner.next;
      else first = owner.next;
      if (owner.next) owner.next.previous = owner.previous;
      else last = owner.previous;
      owner.previous = undefined;
      owner.next = undefined;
      count -= 1;
    };
    owner.listener = listener;
    owner.active = true;
    owner.aborted = false;
    owner.abortReason = undefined;
    owner.currentTaskId = taskId;
    owner.previous = last;
    owner.next = undefined;
    owner.release = release;
    if (last) last.next = owner;
    else first = owner;
    last = owner;
    count += 1;
    return release;
  };
  const channel = {
    subscribe(listener, listenerOptions) {
      if (typeof listener !== 'function') {
        throw createEventTypeError(
          EventSubscriberErrorCode.invalidListener,
          eventErrorText(EventSubscriberErrorCode.invalidListener)
        );
      }
      const taskId = readTaskOption(listenerOptions);
      const release = registerRaw(listener, taskId);
      return createSubscriptionHandle(release, (nextListener, nextOptions) => {
        if (typeof nextListener !== 'function') {
          throw createEventTypeError(
            EventSubscriberErrorCode.invalidListener,
            eventErrorText(EventSubscriberErrorCode.invalidListener)
          );
        }
        const nextTaskId = readTaskOption(nextOptions);
        return registerRaw(nextListener, nextTaskId);
      });
    },
    subscribeOnce(listener, listenerOptions) {
      return subscribeOnce(channel, listener, listenerOptions);
    },
    subscribeUntil(signal, listener, listenerOptions) {
      return subscribeUntil(channel, signal, listener, listenerOptions);
    },
    publish(value) {
      const snapshots = capability.snapshot();
      const failures: unknown[] = [];
      for (const snapshot of snapshots) {
        let result: R | PromiseLike<R>;
        try {
          result = invokeSnapshot(snapshot, value);
        } catch (error) {
          failures.push(error);
          continue;
        }
        const context = createEventContext(value, snapshot);
        observePromiseLike(
          result,
          () => undefined,
          (error) => reportLateFailure(normalizedOptions, context, error)
        );
      }
      if (failures.length > 0) {
        throw createEventAggregateError(
          EventSubscriberErrorCode.publishFailed,
          failures,
          eventErrorText(EventSubscriberErrorCode.publishFailed)
        );
      }
    },
    filterTaskId(taskId) {
      const validated = validateTaskId(taskId, false) as string;
      const filtered = {} as IFilteredEventChannel<T, R>;
      filteredCapabilities.set(filtered as object, {
        channel: channel as ICanonicalEventChannel<unknown, unknown>,
        taskId: validated
      });
      return filtered;
    },
    clear() {
      let current = first;
      while (current) {
        const next = current.next;
        current.active = false;
        current.previous = undefined;
        current.next = undefined;
        current = next;
      }
      first = undefined;
      last = undefined;
      count = 0;
    },
    get size() {
      return count;
    }
  } as ICanonicalEventChannel<T, R>;
  const capability: IChannelCapability<T, R> = {
    snapshot(taskId) {
      const snapshots: IEventDispatchSnapshot<T, R>[] = [];
      let current = first;
      while (current) {
        if (taskId === undefined || current.currentTaskId === taskId)
          snapshots.push(snapshotOwner(current));
        current = current.next;
      }
      return Object.freeze(snapshots);
    }
  };
  channelCapabilities.set(channel as object, capability as IChannelCapability<unknown, unknown>);
  return channel;
};

/** Registers a subscriber object without introducing a class hierarchy. */
export const subscribeSubscriber = <T, R>(
  channel: IEventChannelLike<T, R>,
  subscriber: { readonly handle?: unknown }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R>(channel);
  let handleValue: unknown;
  try {
    if (!isRecord(subscriber)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSubscriber,
        eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
      );
    }
    handleValue = subscriber.handle;
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSubscriber);
  }
  if (typeof handleValue !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSubscriber,
      eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
    );
  }
  const typedSubscriber = subscriber as {
    handle(event: IEventContext<T>): R | PromiseLike<R>;
  };
  let released = false;
  let releaseReady = false;
  let sourceReleaseCalled = false;
  let syncDelivered = false;
  let sourceRelease: IUnsubscribe | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    if (releaseReady && !sourceReleaseCalled) {
      sourceReleaseCalled = true;
      try {
        sourceRelease?.();
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
      }
    }
  };
  let candidate: IUnsubscribe;
  try {
    candidate = validated.subscribe((event) => {
      if (released) return undefined as R;
      if (!releaseReady) {
        syncDelivered = true;
        return undefined as R;
      }
      return typedSubscriber.handle(event);
    });
    if (typeof candidate !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
    sourceRelease = candidate;
    releaseReady = true;
    if (released) release();
    if (syncDelivered) {
      const primary = createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
      try {
        release();
      } catch (error) {
        throw createEventAggregateError(
          EventSubscriberErrorCode.invalidChannel,
          [primary, error],
          eventErrorText(EventSubscriberErrorCode.invalidChannel)
        );
      }
      throw primary;
    }
  } catch (error) {
    let hasCode = false;
    try {
      hasCode =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        'code' in error;
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
    }
    if (hasCode) throw error;
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
  }
  return release;
};

/** Installs once semantics on any event-subscriber-compatible structural channel. */
export const subscribeOnce = <T, R>(
  channel: IEventChannelLike<T, R>,
  listener: IEventListener<T, R>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R>(channel);
  const taskId = readTaskOption(options);
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    );
  }
  let sourceRelease: IUnsubscribe | undefined;
  let released = false;
  let syncDelivered = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      sourceRelease?.();
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel);
    }
  };
  let releaseReady = false;
  let fired = false;
  const candidate = validated.subscribe(
    (event) => {
      if (released) return undefined as R;
      if (!releaseReady) {
        syncDelivered = true;
        return undefined as R;
      }
      if (fired) return undefined as R;
      fired = true;
      release();
      return listener(event);
    },
    taskId === undefined ? undefined : { taskId }
  );
  if (typeof candidate !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    );
  }
  sourceRelease = candidate;
  releaseReady = true;
  if (syncDelivered) {
    const primary = createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    );
    try {
      release();
    } catch (error) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.invalidChannel,
        [primary, error],
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
    throw primary;
  }
  return release;
};

/** Installs abort-linked subscription with a helper-owned overlay and closed race protocol. */
export const subscribeUntil = <T, R>(
  channel: IEventChannelLike<T, R>,
  signal: IEventAbortSignal,
  listener: IEventListener<T, R>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  const validated = validateChannelLike<T, R>(channel);
  const taskId = readTaskOption(options);
  if (typeof listener !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    );
  }
  let firstAborted: unknown;
  try {
    if (!isRecord(signal)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      );
    }
    if (
      !('addEventListener' in signal) ||
      !('removeEventListener' in signal) ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function'
    ) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      );
    }
    firstAborted = signal.aborted;
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal);
  }
  if (typeof firstAborted !== 'boolean') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSignal,
      eventErrorText(EventSubscriberErrorCode.invalidSignal)
    );
  }
  if (firstAborted) return () => undefined;
  let overlayAborted = false;
  let overlayReason: unknown;
  let captured = false;
  let captureFailed = false;
  let captureFailure: unknown;
  const captureReason = (): unknown => {
    if (captured) {
      if (captureFailed) throw captureFailure;
      return overlayReason;
    }
    captured = true;
    try {
      overlayReason = signal.reason;
      return overlayReason;
    } catch (error) {
      captureFailed = true;
      captureFailure = error;
      throw error;
    }
  };
  let sourceRelease: IUnsubscribe = () => undefined;
  let sourceReleaseReady = false;
  let released = false;
  let sourceReleaseCalled = false;
  let abortInstallAttempted = false;
  let sourceSubscriptionFailed = false;
  let observerInstallComplete = false;
  let removeRequested = false;
  let observerRemoved = false;
  const removeObserver = (force = false): void => {
    removeRequested = true;
    if (observerRemoved || (!observerInstallComplete && !force)) return;
    observerRemoved = true;
    signal.removeEventListener(EventSubscriberState.abort, abortListener);
  };
  const releaseSourceIfReady = (): void => {
    if (sourceReleaseReady && !sourceReleaseCalled) {
      sourceReleaseCalled = true;
      sourceRelease();
    }
  };
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      releaseSourceIfReady();
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal);
    }
  };
  const eventWrapper = (sourceEvent: IEventContext<T>): IEventContext<T> => ({
    get value() {
      return sourceEvent.value;
    },
    get aborted() {
      return overlayAborted || sourceEvent.aborted;
    },
    get abortReason() {
      return overlayAborted ? overlayReason : sourceEvent.abortReason;
    },
    get taskId() {
      return sourceEvent.taskId;
    },
    abort(reason?: unknown) {
      sourceEvent.abort(reason);
    },
    setTaskId(taskId: string | undefined) {
      sourceEvent.setTaskId(taskId);
    }
  });
  const completeAbort = (removeSignalListener: boolean): void => {
    let primary: unknown;
    let hasPrimary = false;
    const cleanup: unknown[] = [];
    try {
      captureReason();
    } catch (error) {
      primary = codeExistingError(error, EventSubscriberErrorCode.invalidSignal);
      hasPrimary = true;
    }
    if (removeSignalListener) {
      try {
        removeObserver();
      } catch (error) {
        cleanup.push(error);
      }
    }
    try {
      release();
    } catch (error) {
      cleanup.push(error);
    }
    if (hasPrimary || cleanup.length > 0) {
      const errors = [...(hasPrimary ? [primary] : []), ...cleanup];
      const first = errors[0];
      throw attachEventErrorCode(
        new AggregateError(errors, eventErrorText(EventSubscriberErrorCode.invalidSignal), {
          cause: first
        }),
        EventSubscriberErrorCode.invalidSignal
      );
    }
  };
  const abortListener = (): void => {
    if (released) return;
    overlayAborted = true;
    completeAbort(true);
  };
  let installing = true;
  let syncDelivered = false;
  try {
    abortInstallAttempted = true;
    signal.addEventListener(EventSubscriberState.abort, abortListener, { once: true });
    observerInstallComplete = true;
    if (removeRequested) removeObserver();
    let candidate: IUnsubscribe;
    try {
      candidate = validated.subscribe(
        (event) => {
          if (released) return undefined as R;
          if (installing) {
            syncDelivered = true;
            return undefined as R;
          }
          if (overlayAborted) return undefined as R;
          return listener(eventWrapper(event));
        },
        taskId === undefined ? undefined : { taskId }
      );
    } catch (error) {
      sourceSubscriptionFailed = true;
      throw error;
    }
    if (typeof candidate !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
    sourceRelease = candidate;
    sourceReleaseReady = true;
    if (released) releaseSourceIfReady();
    if (syncDelivered) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      );
    }
    const secondAborted = signal.aborted;
    if (typeof secondAborted !== 'boolean') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      );
    }
    if (secondAborted) {
      overlayAborted = true;
      completeAbort(true);
    }
    installing = false;
  } catch (primary) {
    const cleanup: unknown[] = [];
    observerInstallComplete = true;
    if (abortInstallAttempted) {
      try {
        removeObserver(true);
      } catch (error) {
        cleanup.push(error);
      }
    }
    try {
      release();
    } catch (error) {
      cleanup.push(error);
    }
    if (cleanup.length > 0) {
      throw attachEventErrorCode(
        new AggregateError(
          [primary, ...cleanup],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      );
    }
    let hasExistingCode = false;
    try {
      hasExistingCode =
        ((typeof primary === 'object' && primary !== null) || typeof primary === 'function') &&
        'code' in primary;
    } catch {
      throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal);
    }
    if (hasExistingCode) throw primary;
    if (sourceSubscriptionFailed) throw primary;
    throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal);
  }
  return (): void => {
    if (observerRemoved && released) return;
    let removeError: unknown;
    let hasRemoveError = false;
    let releaseError: unknown;
    let hasReleaseError = false;
    try {
      removeObserver();
    } catch (error) {
      hasRemoveError = true;
      removeError = error;
    }
    try {
      release();
    } catch (error) {
      hasReleaseError = true;
      releaseError = error;
    }
    if (hasRemoveError && hasReleaseError) {
      const primary = codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal);
      const secondary = codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal);
      throw attachEventErrorCode(
        new AggregateError(
          [primary, secondary],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      );
    }
    if (hasRemoveError)
      throw codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal);
    if (hasReleaseError)
      throw codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal);
  };
};

export { channelCapabilities, filteredCapabilities };
