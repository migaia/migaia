import { EventSubscriberErrorCode } from './error-code.js'
import { createCanonicalChannel } from './channel.js'
import { createEventValueProjectionPlan, type IEventProjectionPlan } from './value-projection.js'
import { createEventTypeError, eventErrorText } from './errors.js'
import type {
  ICanonicalEventChannel,
  IEventHub,
  IEventHubOptions,
  IEventChannelOptions,
  IEventMap,
  IEventListener,
  IEventHubSubscription,
  IEventValueConfig,
  IStyledEventHub,
  IStyledEventHubOptions
} from './types.js'
import { createRawSubscriptionOwner } from './internal/subscription.js'
import {
  normalizeEventApiStyle,
  projectEventApiStyle,
  type IEventApiStyle,
  type IEventApiStylePlan
} from './style.js'

/** Creates a lazy keyed synchronous hub with O(1) total size accounting. */
export function createEventHub<
  C extends IEventMap,
  const S extends IEventApiStyle,
  const V = undefined
>(options: IStyledEventHubOptions<C, S, V>): IStyledEventHub<C, S, V>
export function createEventHub<C extends IEventMap, const S extends undefined, const V = undefined>(
  options: IEventHubOptions<C, S, V>
): IEventHub<C, S, V>
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & {
    readonly style: 'subscribe-publish'
  }
): IEventHub<C, undefined, V>
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'on-emit' }
): IStyledEventHub<C, 'on-emit', V>
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'on-trigger' }
): IStyledEventHub<C, 'on-trigger', V>
export function createEventHub<C extends IEventMap, const V = undefined>(
  options: Omit<IEventHubOptions<C, undefined, V>, 'style'> & { readonly style: 'listen-fire' }
): IStyledEventHub<C, 'listen-fire', V>
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
        ? createCanonicalChannel<unknown, void, V>(channelOptions, projectionPlan)
        : createCanonicalChannel<unknown, void, V>(channelOptions)
      channels.set(validated, channel)
    }
    return { channel, validated }
  }
  const hub: IEventHub<C, undefined, V> = {
    subscribe<K extends keyof C>(
      key: K,
      listener: IEventListener<C[K], void, V extends IEventValueConfig<C[K]> ? V : undefined>
    ): IEventHubSubscription<C, K, undefined, V> {
      const release = registerRaw(key, listener)
      return createRawSubscriptionOwner(
        release,
        (nextKey, nextListener) => registerRaw(nextKey, nextListener),
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
    listener: IEventListener<C[K], void, V extends IEventValueConfig<C[K]> ? V : undefined>
  ): () => void {
    if (typeof listener !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidListener,
        eventErrorText(EventSubscriberErrorCode.invalidListener)
      )
    }
    const { channel, validated } = getChannel(key)
    let deactivateRegistration: (() => void) | undefined
    const channelRelease = channel.subscribe((event) => {
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
      for (const key of Reflect.ownKeys(event as object)) {
        const descriptor = Object.getOwnPropertyDescriptor(event as object, key)
        if (descriptor && 'value' in descriptor)
          Object.defineProperty(context, key, {
            configurable: false,
            enumerable: descriptor.enumerable,
            writable: false,
            value: descriptor.value
          })
      }
      return listener(context as never)
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
