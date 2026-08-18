import { EventSubscriberErrorCode } from './error-code.js';
import { createEventAggregateError, createEventTypeError, eventErrorText } from './errors.js';
import { getCapability, invokeSnapshot, validateTaskId } from './channel.js';
import { EventSubscriberState } from './state-constants.js';
import type {
  ICanonicalEventChannel,
  IEventDispatchSnapshot,
  IFilteredEventChannel,
  IListenerResult
} from './types.js';

type IAsyncChannel<T, R> = ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>;

/** Adds task-selection diagnostics without changing the stable public error message. */
const createTaskSelectionError = (
  code:
    | typeof EventSubscriberErrorCode.taskNotFound
    | typeof EventSubscriberErrorCode.taskNotUnique,
  taskId: string,
  matchCount: number
) => {
  const error = createEventTypeError(code, eventErrorText(code));
  Object.defineProperties(error, {
    taskId: { configurable: false, enumerable: true, value: taskId },
    matchCount: { configurable: false, enumerable: true, value: matchCount }
  });
  return error;
};

/** Converts one raw listener return into a settled result without invoking a reporter. */
const settleSnapshot = async <T, R>(
  snapshot: IEventDispatchSnapshot<T, R>,
  value: T
): Promise<IListenerResult<R>> => {
  try {
    return { status: EventSubscriberState.fulfilled, value: await invokeSnapshot(snapshot, value) };
  } catch (reason) {
    return { status: EventSubscriberState.rejected, reason };
  }
};

/** Takes an immutable target snapshot before any async wait begins. */
const targetSnapshots = <T, R>(
  channel: IAsyncChannel<T, R>
): readonly IEventDispatchSnapshot<T, R>[] => {
  const { capability, taskId } = getCapability(channel);
  return capability.snapshot(taskId);
};

/** Runs all listener calls immediately, then waits for all settlements in registration order. */
export const publishParallelSettled = <T, R>(
  channel: IAsyncChannel<T, R>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const snapshots = targetSnapshots(channel);
  const pending = snapshots.map((snapshot) => settleSnapshot(snapshot, value));
  return Promise.all(pending);
};

/** Runs one listener only after the previous listener has settled. */
export const publishSerialSettled = <T, R>(
  channel: IAsyncChannel<T, R>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const snapshots = targetSnapshots(channel);
  return (async (): Promise<readonly IListenerResult<R>[]> => {
    const results: IListenerResult<R>[] = [];
    for (const snapshot of snapshots) results.push(await settleSnapshot(snapshot, value));
    return results;
  })();
};

/** Converts settled results to throwing values while retaining every listener failure. */
const throwOnFailures = <R>(results: readonly IListenerResult<R>[]): readonly Awaited<R>[] => {
  const failures = results.filter(
    (result) => result.status === EventSubscriberState.rejected
  ) as readonly {
    readonly status: typeof EventSubscriberState.rejected;
    readonly reason: unknown;
  }[];
  if (failures.length > 0) {
    throw createEventAggregateError(
      EventSubscriberErrorCode.publishFailed,
      failures.map((failure) => failure.reason),
      eventErrorText(EventSubscriberErrorCode.publishFailed)
    );
  }
  return results.map(
    (result) =>
      (
        result as {
          readonly status: typeof EventSubscriberState.fulfilled;
          readonly value: Awaited<R>;
        }
      ).value
  );
};

/** Parallel throwing publish; no listener failure is reported twice. */
export const publishParallel = <T, R>(
  channel: IAsyncChannel<T, R>,
  value: T
): Promise<readonly Awaited<R>[]> => publishParallelSettled(channel, value).then(throwOnFailures);

/** Serial throwing publish; all listeners still run before failure is returned. */
export const publishSerial = <T, R>(
  channel: IAsyncChannel<T, R>,
  value: T
): Promise<readonly Awaited<R>[]> => publishSerialSettled(channel, value).then(throwOnFailures);

/** Selects exactly one task registration synchronously before returning its settlement Promise. */
const selectTask = <T, R>(
  channel: ICanonicalEventChannel<T, R>,
  taskId: string
): IEventDispatchSnapshot<T, R> => {
  const validated = validateTaskId(taskId, false) as string;
  const { capability } = getCapability(channel);
  const snapshots = capability.snapshot(validated);
  if (snapshots.length === 0) {
    throw createTaskSelectionError(EventSubscriberErrorCode.taskNotFound, validated, 0);
  }
  if (snapshots.length !== 1) {
    throw createTaskSelectionError(
      EventSubscriberErrorCode.taskNotUnique,
      validated,
      snapshots.length
    );
  }
  return snapshots[0];
};

/** Strict single-task settled publish; selection errors are synchronous throws. */
export const publishTaskSettled = <T, R>(
  channel: ICanonicalEventChannel<T, R>,
  taskId: string,
  value: T
): Promise<IListenerResult<R>> => settleSnapshot(selectTask(channel, taskId), value);

/** Strict single-task throwing publish; selection errors are synchronous throws. */
export const publishTask = <T, R>(
  channel: ICanonicalEventChannel<T, R>,
  taskId: string,
  value: T
): Promise<Awaited<R>> => {
  return publishTaskSettled(channel, taskId, value).then((result) => {
    if (result.status === EventSubscriberState.rejected) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.publishFailed,
        [result.reason],
        eventErrorText(EventSubscriberErrorCode.publishFailed)
      );
    }
    return result.value;
  });
};
