/**
 * Owns canonical channel/view identity and internal capabilities; public objects carry no mutable
 * state.
 */
import type {
  ICanonicalEventChannel,
  IEventChannelOptions,
  IEventDispatchSnapshot,
  IEventInvocation,
  IFilteredEventChannel
} from '../types.js'
import type { IEventApiStyle } from '../style.js'
import type { IEventProjectionOutcome, IEventProjectionPlan } from '../value-projection.js'
import { EventSubscriberErrorCode } from '../error-code.js'
import { createEventTypeError, eventErrorText } from '../errors.js'

/**
 * Package-internal operations of one channel, kept off the public object and looked up through a
 * WeakMap by the helpers.
 */
export type IChannelCapability<T, R, V = undefined> = {
  /**
   * Snapshots the registrations in delivery order; with `taskId`, only those carrying that task
   * name.
   */
  snapshot(taskId?: string): readonly IEventDispatchSnapshot<T, R, V>[]
  /** Reads exact task selection in O(1), keeping lookup independent of unrelated registrations. */
  selectTask(taskId: string): {
    readonly snapshot: IEventDispatchSnapshot<T, R, V> | undefined
    readonly matchCount: number
  }
  /** Reads the value alias path of the channel's `valueConfig` for one published value. */
  project(value: T): IEventProjectionOutcome
  /** Projection plan of the value alias, or `undefined` when the channel has no `valueConfig`. */
  readonly plan: IEventProjectionPlan | undefined
  /** Validated channel options, read by helpers that report failures. */
  readonly options: IEventChannelOptions<T, IEventApiStyle | undefined, V>
  /** Visits registrations live, admitting ones added during the visit until a removal happens. */
  liveVisit(
    value: T,
    taskId: string | undefined,
    visitor: (invocation: IEventInvocation<R>) => void
  ): void
}

/** Internal record of a task-filter view: the source channel and the task name it selects. */
export type IFilteredCapability<T, R, V = undefined> = {
  /** Canonical channel the view filters. */
  readonly channel: ICanonicalEventChannel<T, R, undefined, V>
  /** Task name the view selects. */
  readonly taskId: string
}

/** Runtime identity for canonical channels; structural lookalikes never enter async helpers. */
export const channelCapabilities = new WeakMap<
  object,
  IChannelCapability<unknown, unknown, unknown>
>()

/** Runtime identity for filtered views; views retain their canonical channel only while reachable. */
export const filteredCapabilities = new WeakMap<
  object,
  IFilteredCapability<unknown, unknown, unknown>
>()

/** Reads one dispatch snapshot from a canonical channel or filtered capability. */
export const getCapability = <T, R, V = undefined>(
  channel: ICanonicalEventChannel<T, R, undefined, V> | IFilteredEventChannel<T, R, V>
): { readonly capability: IChannelCapability<T, R, V>; readonly taskId: string | undefined } => {
  /** Internal record when the argument is a task-filter view. */
  const filtered = filteredCapabilities.get(channel as object) as
    | IFilteredCapability<T, R, V>
    | undefined
  if (filtered) {
    /** Capability of the source channel behind the view. */
    const capability = channelCapabilities.get(filtered.channel as object) as
      | IChannelCapability<T, R, V>
      | undefined
    if (!capability)
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    return { capability, taskId: filtered.taskId }
  }
  /** Capability registered for this channel object. */
  const capability = channelCapabilities.get(channel as object) as
    | IChannelCapability<T, R, V>
    | undefined
  if (!capability)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
  return { capability, taskId: undefined }
}
