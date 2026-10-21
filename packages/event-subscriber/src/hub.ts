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
export function createEventHub<C extends IEventMap, V = undefined>(
  options: unknown = {}
): IEventHub<C, undefined, V> {
  let report: IEventHubOptions<C, undefined, V>['report']
  let terminalReport: IEventHubOptions<C, undefined, V>['terminalReport']
  let valueConfig: unknown
  let projectionPlan: IEventProjectionPlan | undefined
  let style: IEventApiStyle | undefined
  let stylePlan: IEventApiStylePlan
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidOptions,
        eventErrorText(EventSubscriberErrorCode.invalidOptions)
      )
    }
    const optionRecord = options as IEventHubOptions<C, IEventApiStyle | undefined, V>
    report = optionRecord.report
    terminalReport = optionRecord.terminalReport
    valueConfig = optionRecord.valueConfig as unknown
  } catch (error) {
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
  const channels = new Map<PropertyKey, ICanonicalEventChannel<unknown, void, undefined, V>>()
  const registrations = new Map<
    ICanonicalEventChannel<unknown, void, undefined, V>,
    Set<() => void>
  >()
  let totalSize = 0
  const validateKey = (key: PropertyKey): PropertyKey => {
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidEventKey,
        eventErrorText(EventSubscriberErrorCode.invalidEventKey)
      )
    }
    return key
  }
  const getChannel = <K extends keyof C>(key: K) => {
    const validated = validateKey(key as PropertyKey)
    let channel = channels.get(validated)
    if (!channel) {
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
  const hub: IEventHub<C, undefined, V> = {
    subscribe<K extends keyof C>(
      key: K,
      listener:
        | IEventListener<C[K], void, V extends IEventValueConfig<C[K]> ? V : undefined>
        | IEventValueListener<C[K]>,
      listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
    ): IEventHubSubscription<C, K, undefined, V> {
      const release = registerRaw(key, listener, listenerOptions)
      return createRawSubscriptionOwner(
        release,
        (nextKey, nextListener, nextOptions) => registerRaw(nextKey, nextListener, nextOptions),
        stylePlan
      ) as IEventHubSubscription<C, K, undefined, V>
    },
    publish<K extends keyof C>(key: K, value: C[K]): void {
      const channel = channels.get(validateKey(key as PropertyKey))
      if (!channel) return
      channel.publish(value)
    },
    clear(key?: keyof C): void {
      if (key !== undefined) {
        const validated = validateKey(key as PropertyKey)
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
    size(key?: keyof C): number {
      if (key === undefined) return totalSize
      return channels.get(validateKey(key as PropertyKey))?.size ?? 0
    }
  }
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
    let deactivateRegistration: (() => void) | undefined
    /** Value delivery needs no context overlay; canonical dispatch still owns results and errors. */
    const channelRelease =
      delivery === EventDelivery.value
        ? channel.subscribe(listener as IEventValueListener<unknown>, { delivery })
        : channel.subscribe((event) => {
            /** Context cancellation also updates the Hub's existing aggregate registration count. */
            const context = {
              get value() {
                return event.value
              },
              get aborted() {
                return event.aborted
              },
              get abortReason() {
                return event.abortReason
              },
              get taskId() {
                return event.taskId
              },
              abort(reason?: unknown) {
                event.abort(reason)
                deactivateRegistration?.()
              },
              setTaskId(taskId: string | undefined) {
                event.setTaskId(taskId)
              }
            }
            copyEventProjection(context, event, projectionPlan)
            return (listener as IEventListener<C[K], void>)(context as never)
          })
    totalSize += 1
    let active = true
    const channelRegistrations = registrations.get(channel) ?? new Set<() => void>()
    registrations.set(channel, channelRegistrations)
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
