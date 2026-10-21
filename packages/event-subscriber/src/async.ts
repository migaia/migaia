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

/** Channels the async helpers accept: a canonical channel, or a task-filter view of one. */
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
  /** Native `TypeError` that receives the selection details as read-only properties. */
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

/**
 * Starts every selected listener immediately and waits for all results in registration order. Use
 * when independent listeners may overlap and every success/failure must be inspected. Accepts this
 * package instance's canonical channel or a filterTaskId view; other sources throw INVALID_CHANNEL
 * synchronously. Targets are captured before any await, and an empty target list resolves to [].
 * Listener throws/rejections become rejected result entries rather than rejecting the returned
 * promise or calling the listener reporter. Value-projection diagnostics still report.
 */
export const invokeParallelSettled = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const { snapshots, capability } = targetSnapshots(channel)
  if (snapshots.length === 0) return Promise.resolve([])
  /** Value-path projection computed once for every listener of this call. */
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  /** One settlement per listener, started in registration order without waiting. */
  const pending = snapshots.map((snapshot) => settleSnapshot(snapshot, value, projection))
  if (projection?.outcome.diagnostic)
    reportEventProjectionFailure(
      capability.options,
      createEventContext(value, snapshots[0]!, projection),
      projection.outcome.diagnostic
    )
  return Promise.all(pending)
}

/**
 * Runs captured listeners one at a time, starting the next only after the previous one settles. Use
 * for ordered side effects while collecting every outcome. A failed listener does not skip later
 * listeners; each receives the same value, not its predecessor's result.
 *
 * Accepts this package instance's canonical channel or task-filter view; invalid sources throw
 * INVALID_CHANNEL synchronously. Empty channels resolve to []. Results retain registration order
 * and original failure reasons; listener failures do not call report. Projection diagnostics do.
 */
export const invokeSerialSettled = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly IListenerResult<R>[]> => {
  const { snapshots, capability } = targetSnapshots(channel)
  if (snapshots.length === 0) return Promise.resolve([])
  /** Value-path projection computed once for every listener of this call. */
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  return (async (): Promise<readonly IListenerResult<R>[]> => {
    /** Settled results in registration order; each listener starts after the previous one settles. */
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
  /** Rejected results; when any exist they are thrown together, keeping every reason. */
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

/**
 * Starts every selected listener in parallel and resolves to their values in registration order.
 * Waits for every listener even if one fails, then rejects with a PUBLISH_FAILED AggregateError
 * containing all original failures. Use invokeParallelSettled to inspect mixed outcomes instead.
 * Listener failures do not call report; invalid channel identities throw INVALID_CHANNEL
 * synchronously before a promise is returned. An empty target list resolves to [].
 */
export const invokeParallel = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly Awaited<R>[]> => invokeParallelSettled(channel, value).then(throwOnFailures)

/**
 * Awaits listeners in registration order and resolves to their ordered values. All selected
 * listeners still run after a failure; after the last settlement, any failures reject as
 * PUBLISH_FAILED with their original values on AggregateError.errors and the first on cause. Every
 * listener receives the same payload. Invalid channels throw INVALID_CHANNEL synchronously; an
 * empty target list resolves to []. Listener failures use this result path rather than report.
 */
export const invokeSerial = <T, R, V = undefined>(
  channel: IAsyncChannel<T, R, V>,
  value: T
): Promise<readonly Awaited<R>[]> => invokeSerialSettled(channel, value).then(throwOnFailures)

/** Selects exactly one task registration synchronously before returning its settlement Promise. */
const selectTask = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V>,
  taskId: string
): {
  readonly snapshot: IEventDispatchSnapshot<T, R, V>
  readonly capability: ReturnType<typeof getCapability<T, R, V>>['capability']
} => {
  /** Task name after validation; a non-string or empty name has already thrown. */
  const validated = validateTaskId(taskId, false) as string
  const { capability } = getCapability(channel)
  /** Registrations currently carrying that task name. */
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
  return { snapshot: snapshots[0], capability }
}

/**
 * Selects exactly one current taskId registration and returns its settled listener outcome. Use
 * when a named local handler must return a result without broadcasting to other tasks. Only this
 * package instance's canonical channel is accepted; task-filter views are not inputs.
 *
 * Selection completes synchronously before any listener runs. Empty/non-string ids throw
 * INVALID_TASK_ID, unknown channels throw INVALID_CHANNEL, and zero/multiple matches throw
 * TASK_NOT_FOUND/TASK_NOT_UNIQUE with taskId and matchCount fields. A selected listener's throw or
 * rejection resolves as a rejected result, without calling report for that listener failure.
 */
export const invokeTaskSettled = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V>,
  taskId: string,
  value: T
): Promise<IListenerResult<R>> => {
  const { snapshot, capability } = selectTask(channel, taskId)
  /** Value-path projection for the selected listener. */
  const projection = capability.plan
    ? { plan: capability.plan, outcome: capability.project(value) }
    : undefined
  /** Settlement of the single selected listener. */
  const settled = settleSnapshot(snapshot, value, projection)
  /** Projection failure to report once the listener has settled. */
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

/**
 * Selects exactly one task registration and resolves to its awaited listener result. Requires the
 * canonical channel and a nonempty taskId. Selection failures throw synchronously with
 * INVALID_CHANNEL, INVALID_TASK_ID, TASK_NOT_FOUND, or TASK_NOT_UNIQUE before listener entry. A
 * selected listener failure rejects as a PUBLISH_FAILED AggregateError retaining the original
 * failure on errors and cause. Use invokeTaskSettled when failure should be returned as data.
 */
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
