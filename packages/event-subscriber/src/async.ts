import { EventSubscriberErrorCode } from './error-code.js'
import { createEventAggregateError, createEventTypeError, eventErrorText } from './errors.js'
import {
  createEventContext,
  getCapability,
  invokeDispatchSnapshot,
  validateTaskId
} from './channel.js'
import { reportEventProjectionFailure } from './value-projection.js'
import { EventSubscriberState } from './state-constants.js'
import type {
  ICanonicalEventChannel,
  IEventDispatchSnapshot,
  IFilteredEventChannel,
  IListenerResult
} from './types.js'

type IAsyncChannel<T, R, V = undefined> =
  | ICanonicalEventChannel<T, R, undefined, V>
  | IFilteredEventChannel<T, R, V>

/** Adds task-selection diagnostics without changing the stable public error message. */
const createTaskSelectionError = (
  code:
    | typeof EventSubscriberErrorCode.taskNotFound
    | typeof EventSubscriberErrorCode.taskNotUnique,
  taskId: string,
  matchCount: number
) => {
  const error = createEventTypeError(code, eventErrorText(code))
  Object.defineProperties(error, {
    taskId: { configurable: false, enumerable: true, value: taskId },
    matchCount: { configurable: false, enumerable: true, value: matchCount }
  })
  return error
}

/** Converts one raw listener return into a settled result without invoking a reporter. */
const settleSnapshot = async <T, R, V>(
  snapshot: IEventDispatchSnapshot<T, R, V>,
  value: T,
  projection?: Parameters<typeof createEventContext<T, R, V>>[2]
): Promise<IListenerResult<R>> => {
  try {
    return {
      status: EventSubscriberState.fulfilled,
      value: await invokeDispatchSnapshot(snapshot, value, projection)
    }
  } catch (reason) {
    return { status: EventSubscriberState.rejected, reason }
  }
}

/** Takes an immutable target snapshot before any async wait begins. */
const targetSnapshots = <T, R, V>(
  channel: IAsyncChannel<T, R, V>
): {
  readonly snapshots: readonly IEventDispatchSnapshot<T, R, V>[]
  readonly capability: ReturnType<typeof getCapability<T, R, V>>['capability']
} => {
  const { capability, taskId } = getCapability(channel)
  return { capability, snapshots: capability.snapshot(taskId) }
}

/** Runs all listener calls immediately, then waits for all settlements in registration order. */
export const invokeParallelSettled = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const { snapshots, capability } = targetSnapshots(channel)
  if (snapshots.length === 0) return Promise.resolve([])
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  const pending = snapshots.map((snapshot) => settleSnapshot(snapshot, value, projection))
  if (projection?.outcome.diagnostic)
    reportEventProjectionFailure(
      capability.options,
      createEventContext(value, snapshots[0]!, projection),
      projection.outcome.diagnostic
    )
  return Promise.all(pending)
}

/** Runs one listener only after the previous listener has settled. */
export const invokeSerialSettled = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const { snapshots, capability } = targetSnapshots(channel)
  if (snapshots.length === 0) return Promise.resolve([])
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  return (async (): Promise<readonly IListenerResult<R>[]> => {
    const results: IListenerResult<R>[] = []
    for (const snapshot of snapshots)
      results.push(await settleSnapshot(snapshot, value, projection))
    if (projection?.outcome.diagnostic)
      reportEventProjectionFailure(
        capability.options,
        createEventContext(value, snapshots[0]!, projection),
        projection.outcome.diagnostic
      )
    return results
  })()
}

/** Converts settled results to throwing values while retaining every listener failure. */
const throwOnFailures = <R>(results: readonly IListenerResult<R>[]): readonly Awaited<R>[] => {
  const failures = results.filter(
    (result) => result.status === EventSubscriberState.rejected
  ) as readonly {
    readonly status: typeof EventSubscriberState.rejected
    readonly reason: unknown
  }[]
  if (failures.length > 0) {
    throw createEventAggregateError(
      EventSubscriberErrorCode.publishFailed,
      failures.map((failure) => failure.reason),
      eventErrorText(EventSubscriberErrorCode.publishFailed)
    )
  }
  return results.map(
    (result) =>
      (
        result as {
          readonly status: typeof EventSubscriberState.fulfilled
          readonly value: Awaited<R>
        }
      ).value
  )
}

/** Parallel throwing publish; no listener failure is reported twice. */
export const invokeParallel = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly Awaited<R>[]> => invokeParallelSettled(channel, value).then(throwOnFailures)

/** Serial throwing publish; all listeners still run before failure is returned. */
export const invokeSerial = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly Awaited<R>[]> => invokeSerialSettled(channel, value).then(throwOnFailures)

/** Selects exactly one task registration synchronously before returning its settlement Promise. */
const selectTask = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V>,
  taskId: string
): IEventDispatchSnapshot<T, R, V> => {
  const validated = validateTaskId(taskId, false) as string
  const { capability } = getCapability(channel)
  const snapshots = capability.snapshot(validated)
  if (snapshots.length === 0) {
    throw createTaskSelectionError(EventSubscriberErrorCode.taskNotFound, validated, 0)
  }
  if (snapshots.length !== 1) {
    throw createTaskSelectionError(
      EventSubscriberErrorCode.taskNotUnique,
      validated,
      snapshots.length
    )
  }
  return snapshots[0]
}

/** Strict single-task settled publish; selection errors are synchronous throws. */
export const invokeTaskSettled = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V>,
  taskId: string,
  value: T
): Promise<IListenerResult<R>> => {
  const snapshot = selectTask(channel, taskId)
  const { capability } = getCapability(channel)
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  const settled = settleSnapshot(snapshot, value, projection)
  const diagnostic = projection?.outcome.diagnostic
  if (!diagnostic) return settled
  return settled.then((result) => {
    reportEventProjectionFailure(
      capability.options,
      createEventContext(value, snapshot, projection),
      diagnostic
    )
    return result
  })
}

/** Strict single-task throwing publish; selection errors are synchronous throws. */
export const invokeTask = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V>,
  taskId: string,
  value: T
): Promise<Awaited<R>> => {
  return invokeTaskSettled(channel, taskId, value).then((result) => {
    if (result.status === EventSubscriberState.rejected) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.publishFailed,
        [result.reason],
        eventErrorText(EventSubscriberErrorCode.publishFailed)
      )
    }
    return result.value
  })
}
