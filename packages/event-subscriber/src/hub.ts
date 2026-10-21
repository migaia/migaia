import { EventSubscriberErrorCode } from './error-code.js'
import {
  createCanonicalChannel,
  createChannelWithProjection,
  readDeliveryOption
} from './channel.js'
import {
  copyEventProjection,
  createEventValueProjectionPlan,
  type IEventProjectionPlan
} from './value-projection.js'
import { createEventTypeError, eventErrorText } from './errors.js'
import type {
  ICanonicalEventChannel,
  IEventHub,
  IEventHubOptions,
  IEventChannelOptions,
  IEventMap,
  IEventListener,
  IEventSubscribeOptions,
  IEventValueListener,
  IEventHubSubscription,
  IEventValueConfig,
  IStyledEventHub,
  IStyledEventHubOptions
} from './types.js'
import { createRawSubscriptionOwner } from './internal/subscription.js'
import { EventDelivery } from './state-constants.js'
import {
  normalizeEventApiStyle,
  projectEventApiStyle,
  type IEventApiStyle,
  type IEventApiStylePlan
} from './style.js'

/**
 * Creates a keyed event hub when each event name has a different payload type. A channel is created
 * only when a key is first subscribed; publishing an unused valid key is a no-op. Each key uses
 * stable synchronous snapshots. Total size is maintained without scanning every key, and stale
 * unsubscribe handles cannot remove a newly created registration.
 *
 * Internal channels use recursive dispatch, multiple admission, handle-only removal, a 100_000
 * listener-call budget, and non-strict aborted admission. Use createEventChannel to select those
 * policies. Optional report receives the failing key; style and valueConfig add names or context
 * aliases without changing routing. Listener results are not collected by Hub.publish.
 *
 * Malformed options or reporter functions throw INVALID_OPTIONS/INVALID_REPORTER at construction.
 * Invalid keys/listeners are rejected before registration. Synchronous listener failures aggregate
 * as PUBLISH_FAILED; late rejections use report and the terminal diagnostic fallback.
 */
export function createEventHub<
  C extends IEventMap,
  const S extends IEventApiStyle,
  const V = undefined
>(options: IStyledEventHubOptions<C, S, V>): IStyledEventHub<C, S, V>
/** Creates a Hub with canonical method names and optional reporters and payload-path alias. */
export function createEventHub<C extends IEventMap, const S extends undefined, const V = undefined>(
  options: IEventHubOptions<C, S, V>
): IEventHub<C, S, V>
/** Selects canonical subscribe/publish/unsubscribe naming without adding alias properties. */
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & {
    readonly style: 'subscribe-publish'
  }
): IEventHub<C, undefined, V>
/** Adds on/emit/off naming aliases while retaining key/payload routing and canonical identities. */
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'on-emit' }
): IStyledEventHub<C, 'on-emit', V>
/** Adds on/trigger/off naming aliases while retaining the Hub's fixed dispatch policies. */
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'on-trigger' }
): IStyledEventHub<C, 'on-trigger', V>
/** Adds listen/fire/unlisten naming aliases while retaining the canonical Hub ownership model. */
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'listen-fire' }
): IStyledEventHub<C, 'listen-fire', V>
/** Creates a default Hub when options are omitted; no events or registrations are created eagerly. */
export function createEventHub<C extends IEventMap, const V = undefined>(
  options?: IEventHubOptions<C, undefined, V>
): IEventHub<C, undefined, V>
/** Implementation shared by the overloads above. */
export function createEventHub<C extends IEventMap, V = undefined>(
  options: unknown = {}
): IEventHub<C, undefined, V> {
  /** Validated `report` option. */
  let report: IEventHubOptions<C, undefined, V>['report']
  /** Validated `terminalReport` option. */
  let terminalReport: IEventHubOptions<C, undefined, V>['terminalReport']
  /** Raw `valueConfig` option; validated when the projection plan is built. */
  let valueConfig: unknown
  /** Projection plan of the value alias, shared by every channel of the Hub. */
  let projectionPlan: IEventProjectionPlan | undefined
  /** Raw `style` option. */
  let style: IEventApiStyle | undefined
  /** Alias names resolved from `style`. */
  let stylePlan: IEventApiStylePlan
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    }
    /** Options read as a record after the object check above. */
    const optionRecord = options as IEventHubOptions<C, IEventApiStyle | undefined, V>
    report = optionRecord.report
    terminalReport = optionRecord.terminalReport
    valueConfig = optionRecord.valueConfig as unknown
  } catch (error) {
    /** Whether the failure came from this package's own option validation. */
    let isOptionsError = false
    try {
      isOptionsError =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        (error as { readonly code?: unknown }).code === EventSubscriberErrorCode.invalidOptions
    } catch {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions),
        error
      )
    }
    if (isOptionsError) throw error
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  try {
    /** Options read as a record, for the style field only. */
    const optionRecord = options as IEventHubOptions<C, IEventApiStyle | undefined>
    style = optionRecord.style
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  try {
    stylePlan = normalizeEventApiStyle(style)
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  if (report !== undefined && typeof report !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    )
  }
  if (terminalReport !== undefined && typeof terminalReport !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    )
  }
  projectionPlan = createEventValueProjectionPlan(valueConfig)
  /** One canonical channel per event key, created on first subscription. */
  const channels = new Map<PropertyKey, ICanonicalEventChannel<unknown, void, undefined, V>>()
  /** Deactivation callbacks of each channel's registrations, used by `clear(key)` and `size`. */
  const registrations = new Map<
    ICanonicalEventChannel<unknown, void, undefined, V>,
    Set<() => void>
  >()
  /** Number of active registrations across all keys; exposed as `size`. */
  let totalSize = 0
  /**
   * Returns the key unchanged, or throws `INVALID_EVENT_KEY` for anything other than a string,
   * number or symbol.
   */
  const validateKey = (key: PropertyKey): PropertyKey => {
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidEventKey,
        eventErrorText(EventSubscriberErrorCode.invalidEventKey)
      )
    }
    return key
  }
  /** Returns the channel of `key`, creating it with the Hub's reporters on first use. */
  const getChannel = <K extends keyof C>(key: K) => {
    /** Key after validation. */
    const validated = validateKey(key as PropertyKey)
    /** Existing channel of the key. */
    let channel = channels.get(validated)
    if (!channel) {
      /** Channel options that add the event key to every report. */
      const channelOptions: IEventChannelOptions<unknown, undefined, V> = {
        report: report
          ? (failure) =>
              report?.({
                key,
                event: failure.event as never,
                error: failure.error
              } as never)
          : undefined,
        terminalReport,
        valueConfig: valueConfig as IEventChannelOptions<unknown, undefined, V>['valueConfig']
      }
      channel = projectionPlan
        ? createChannelWithProjection<unknown, void, V>(channelOptions, projectionPlan)
        : createCanonicalChannel<unknown, void, V>(channelOptions)
      channels.set(validated, channel)
    }
    return { channel, validated }
  }
  /** Public Hub object; its methods close over the channel map. */
  const hub: IEventHub<C, undefined, V> = {
    subscribe<K extends keyof C>(
      key: K,
      listener:
        | IEventListener<C[K], void, V extends IEventValueConfig<C[K]> ? V : undefined>
        | IEventValueListener<C[K]>,
      listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
    ): IEventHubSubscription<C, K, undefined, V> {
      /** Release of the first registration of the chain. */
      const release = registerRaw(key, listener, listenerOptions)
      return createRawSubscriptionOwner(
        release,
        (nextKey, nextListener, nextOptions) => registerRaw(nextKey, nextListener, nextOptions),
        stylePlan
      ) as IEventHubSubscription<C, K, undefined, V>
    },
    /** Delivers `value` to the listeners of `key`; a key without listeners does nothing. */
    publish<K extends keyof C>(key: K, value: C[K]): void {
      /** Channel of the key; publishing to a key without listeners does nothing. */
      const channel = channels.get(validateKey(key as PropertyKey))
      if (!channel) return
      channel.publish(value)
    },
    /** Removes the registrations of one key, or of every key when `key` is omitted. */
    clear(key?: keyof C): void {
      if (key !== undefined) {
        /** Key after validation. */
        const validated = validateKey(key as PropertyKey)
        /** Channel of the key, if it has ever had listeners. */
        const channel = channels.get(validated)
        if (!channel) return
        channel.clear()
        for (const deactivate of registrations.get(channel) ?? []) deactivate()
        registrations.delete(channel)
        if (channels.get(validated) === channel) channels.delete(validated)
        return
      }
      for (const [channel, channelRegistrations] of registrations) {
        channel.clear()
        for (const deactivate of channelRegistrations) deactivate()
      }
      registrations.clear()
      channels.clear()
      totalSize = 0
    },
    /** Number of registrations of one key, or of all keys when `key` is omitted. */
    size(key?: keyof C): number {
      if (key === undefined) return totalSize
      return channels.get(validateKey(key as PropertyKey))?.size ?? 0
    }
  }
  /**
   * Registers one listener on the channel of `key` and returns its release. Context listeners get a
   * context whose `abort()` also removes the Hub's bookkeeping entry.
   */
  function registerRaw<K extends keyof C>(
    key: K,
    listener:
      | IEventListener<C[K], void, V extends IEventValueConfig<C[K]> ? V : undefined>
      | IEventValueListener<C[K]>,
    listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
  ): () => void {
    if (typeof listener !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidListener,
        eventErrorText(EventSubscriberErrorCode.invalidListener)
      )
    }
    /** Validate the mode before creating a keyed channel or acquiring registration ownership. */
    const delivery = readDeliveryOption(listenerOptions)
    const { channel, validated } = getChannel(key)
    /** Hub bookkeeping removal, assigned once the registration exists. */
    let deactivateRegistration: (() => void) | undefined
    /** Value delivery needs no context overlay; canonical dispatch still owns results and errors. */
    const channelRelease =
      delivery === EventDelivery.value
        ? channel.subscribe(listener as IEventValueListener<unknown>, { delivery })
        : channel.subscribe((event) => {
            /** Context cancellation also updates the Hub's existing aggregate registration count. */
            const context = {
              /** Payload of the source event. */
              get value() {
                return event.value
              },
              /** Whether the registration was aborted. */
              get aborted() {
                return event.aborted
              },
              /** Reason passed to `abort()`. */
              get abortReason() {
                return event.abortReason
              },
              /** Task name at dispatch start. */
              get taskId() {
                return event.taskId
              },
              /** Cancels the registration and removes it from the Hub's bookkeeping. */
              abort(reason?: unknown) {
                event.abort(reason)
                deactivateRegistration?.()
              },
              /** Changes the task name of the registration. */
              setTaskId(taskId: string | undefined) {
                event.setTaskId(taskId)
              }
            }
            copyEventProjection(context, event, projectionPlan)
            return (listener as IEventListener<C[K], void>)(context as never)
          })
    totalSize += 1
    /** False once this registration has been removed from the Hub's bookkeeping. */
    let active = true
    /** Bookkeeping set of the channel; created for its first registration. */
    const channelRegistrations = registrations.get(channel) ?? new Set<() => void>()
    registrations.set(channel, channelRegistrations)
    /**
     * Removes this registration from the Hub's bookkeeping once, deleting the channel when it
     * becomes empty.
     */
    const deactivate = (): void => {
      if (!active) return
      active = false
      channelRegistrations.delete(deactivate)
      totalSize -= 1
      if (channelRegistrations.size === 0 && registrations.get(channel) === channelRegistrations) {
        registrations.delete(channel)
      }
      if (channels.get(validated) === channel && channel.size === 0) channels.delete(validated)
    }
    deactivateRegistration = deactivate
    channelRegistrations.add(deactivate)
    /** Releases the channel registration and the bookkeeping entry. */
    const release = (): void => {
      channelRelease()
      deactivate()
    }
    return release
  }
  try {
    projectEventApiStyle(hub, stylePlan)
  } catch (error) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidOptions,
      eventErrorText(EventSubscriberErrorCode.invalidOptions),
      error
    )
  }
  return hub
}
