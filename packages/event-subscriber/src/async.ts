/**
 * Owns asynchronous listener settlement; selection and dispatch remain canonical-channel
 * capabilities.
 */
import { EventSubscriberErrorCode } from './error-code.ts'
import { createEventAggregateError, createEventTypeError, eventErrorText } from './errors.ts'
import { createEventContext, invokeDispatchSnapshot } from './internal/dispatch-context.ts'
import { getCapability } from './internal/channel-capability.ts'
import { validateTaskId } from './internal/channel-options.ts'
import { reportEventProjectionFailure } from './value-projection.ts'
import { EventSubscriberState } from './state-constants.ts'
import type {
  ICanonicalEventChannel,
  IEventDispatchSnapshot,
  IFilteredEventChannel,
  IListenerResult
} from './types.ts'

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
  return new AsyncInvocation<T, R, V>(value, capability).parallel(snapshots)
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
  return new AsyncInvocation<T, R, V>(value, capability).serial(snapshots)
}

/** Converts settled results to throwing values while retaining every listener failure. */
const throwOnFailures = <R>(results: readonly IListenerResult<R>[]): readonly Awaited<R>[] => {
  /** Original failure reasons, collected in one pass without filtering the growing result list. */
  const failures: unknown[] = []
  /** Successful values preserve registration order and are returned only when every target succeeds. */
  const values: Awaited<R>[] = []
  for (const result of results) {
    if (result.status === EventSubscriberState.rejected) failures.push(result.reason)
    else values.push(result.value)
  }
  if (failures.length > 0)
    throw createEventAggregateError(
      EventSubscriberErrorCode.publishFailed,
      failures,
      eventErrorText(EventSubscriberErrorCode.publishFailed)
    )
  return values
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
  /** The maintained task index admits a unique target without scanning unrelated registrations. */
  const { snapshot, matchCount } = capability.selectTask(validated)
  if (matchCount === 0) {
    throw createTaskSelectionError(EventSubscriberErrorCode.taskNotFound, validated, 0)
  }
  if (matchCount !== 1) {
    throw createTaskSelectionError(EventSubscriberErrorCode.taskNotUnique, validated, matchCount)
  }
  return { snapshot: snapshot!, capability }
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
  return new AsyncInvocation<T, R, V>(value, capability).task(snapshot)
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

/** Owns one operation's payload and projection while listeners settle through canonical dispatch. */
class AsyncInvocation<T, R, V> {
  /** Original payload is shared unchanged by every selected listener. */
  readonly #value: T
  /** Existing channel capability owns snapshot controls, reporters, and the static projection plan. */
  readonly #capability: ReturnType<typeof getCapability<T, R, V>>['capability']
  /** Path is probed once before any listener starts; all contexts share this projection outcome. */
  readonly #projection: Parameters<typeof createEventContext<T, R, V>>[2]

  /** Computes projection once after synchronous target admission has completed. */
  constructor(value: T, capability: ReturnType<typeof getCapability<T, R, V>>['capability']) {
    this.#value = value
    this.#capability = capability
    this.#projection = capability.plan
      ? { plan: capability.plan, outcome: capability.project(value) }
      : undefined
  }

  /** Starts every selected listener before reporting projection failure or awaiting settlement. */
  parallel(
    snapshots: readonly IEventDispatchSnapshot<T, R, V>[]
  ): Promise<readonly IListenerResult<R>[]> {
    /** One promise per selected listener; O(n) is required to invoke each captured registration. */
    const pending = snapshots.map((snapshot) =>
      settleSnapshot(snapshot, this.#value, this.#projection)
    )
    this.#reportProjection(snapshots[0]!)
    return Promise.all(pending)
  }

  /** Awaits each captured target once before starting the next; failures remain result entries. */
  async serial(
    snapshots: readonly IEventDispatchSnapshot<T, R, V>[]
  ): Promise<readonly IListenerResult<R>[]> {
    /** Results retain the original registration order, independent of listener settlement details. */
    const results: IListenerResult<R>[] = []
    for (const snapshot of snapshots)
      results.push(await settleSnapshot(snapshot, this.#value, this.#projection))
    this.#reportProjection(snapshots[0]!)
    return results
  }

  /** Returns the original settlement promise when no projection diagnostic needs a continuation. */
  task(snapshot: IEventDispatchSnapshot<T, R, V>): Promise<IListenerResult<R>> {
    /** The selected listener starts immediately, before any diagnostic report. */
    const settled = settleSnapshot(snapshot, this.#value, this.#projection)
    if (!this.#projection?.outcome.diagnostic) return settled
    return settled.then((result) => {
      this.#reportProjection(snapshot)
      return result
    })
  }

  /** Reports a projection failure once at the mode's original report point. */
  #reportProjection(snapshot: IEventDispatchSnapshot<T, R, V>): void {
    /** Failed probing is independent from listener settlement and keeps its original diagnostic. */
    const diagnostic = this.#projection?.outcome.diagnostic
    if (diagnostic)
      reportEventProjectionFailure(
        this.#capability.options,
        createEventContext(this.#value, snapshot, this.#projection),
        diagnostic
      )
  }
}
