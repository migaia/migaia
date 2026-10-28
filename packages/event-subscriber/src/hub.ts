/**
 * Owns keyed channel routing and aggregate registration bookkeeping; dispatch remains
 * channel-owned.
 */
import { validateEventReporter } from './internal/channel-options.ts'
import { validateEventListener } from './internal/channel-options.ts'
import { EventSubscriberErrorCode } from './error-code.ts'
import { createCanonicalChannel, createChannelWithProjection } from './channel.ts'
import { readDeliveryOption } from './internal/channel-options.ts'
import {
  copyEventProjection,
  createEventValueProjectionPlan,
  type IEventProjectionPlan
} from './value-projection.ts'
import { createEventTypeError, eventErrorText } from './errors.ts'
import { createInvalidOptionsError } from './internal/channel-options.ts'
import type {
  ICanonicalEventChannel,
  IEventHub,
  IEventContext,
  IEventHubOptions,
  IEventChannelOptions,
  IEventMap,
  IEventListener,
  IEventSubscribeOptions,
  IEventValueListener,
  IStyledEventHub,
  IStyledEventHubOptions
} from './types.ts'
import { createRawSubscriptionOwner } from './internal/subscription.ts'
import { EventDelivery } from './state-constants.ts'
import {
  readEventApiStyle,
  projectEventApiStyle,
  type IEventApiStyle,
  type IEventApiStylePlan
} from './style.ts'

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
  return new EventHubOwner<C, V>(readHubOptions<C, V>(options)).surface
}

/** Construction-only values read before any keyed channel can escape. */
type IHubOptions<C extends IEventMap, V> = {
  readonly report: IEventHubOptions<C, undefined, V>['report']
  readonly terminalReport: IEventHubOptions<C, undefined, V>['terminalReport']
  readonly valueConfig: unknown
  readonly stylePlan: IEventApiStylePlan
  readonly projectionPlan: IEventProjectionPlan | undefined
}

/** Reads reporters and projection configuration in their original observable getter order. */
function readHubOptions<C extends IEventMap, V>(options: unknown): IHubOptions<C, V> {
  /** Reporter fields and raw projection input, captured before style is read. */
  let fields: Pick<IHubOptions<C, V>, 'report' | 'terminalReport' | 'valueConfig'>
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options))
      throw createInvalidOptionsError()
    /** Object options after structural admission. */
    const record = options as IEventHubOptions<C, IEventApiStyle | undefined, V>
    fields = {
      report: record.report,
      terminalReport: record.terminalReport,
      valueConfig: record.valueConfig
    }
  } catch (error) {
    /** Own invalid-options failures retain their identity, including hostile code-getter handling. */
    let isOptionsError = false
    try {
      isOptionsError =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        (error as { readonly code?: unknown }).code === EventSubscriberErrorCode.invalidOptions
    } catch {
      throw createInvalidOptionsError(error)
    }
    if (isOptionsError) throw error
    throw createInvalidOptionsError(error)
  }
  /** Style stays after the three construction fields and before reporter validation. */
  const stylePlan = readEventApiStyle(options as IEventHubOptions<C, IEventApiStyle | undefined>)
  validateEventReporter(fields.report)
  validateEventReporter(fields.terminalReport)
  return {
    ...fields,
    stylePlan,
    projectionPlan: createEventValueProjectionPlan(fields.valueConfig)
  }
}

/** Rejects invalid event keys before any registry lookup or construction. */
function validateKey(key: PropertyKey): PropertyKey {
  if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidEventKey,
      eventErrorText(EventSubscriberErrorCode.invalidEventKey)
    )
  return key
}

/** Owns hub maps and counts while exposing the original plain-object, receiver-independent surface. */
class EventHubOwner<C extends IEventMap, V> {
  /** Immutable construction choices shared by every lazily created keyed channel. */
  readonly #options: IHubOptions<C, V>
  /** Current channel identity for each key; entries leave when its last registration does. */
  readonly #channels = new Map<PropertyKey, ICanonicalEventChannel<unknown, void, undefined, V>>()
  /** Aggregate registration count makes size() O(1) without scanning keys. */
  #totalSize = 0
  /** Public own-property surface; callbacks keep their owner when detached by consumers. */
  readonly surface: IEventHub<C, undefined, V>

  /** Installs method identities once, then applies style aliases before the hub escapes. */
  constructor(options: IHubOptions<C, V>) {
    this.#options = options
    this.surface = {
      /** Acquires the first registration before handing release ownership to the callable chain. */
      subscribe: ((
        key: keyof C,
        listener: IEventListener<C[keyof C], void> | IEventValueListener<C[keyof C]>,
        listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
      ) => this.#subscribe(key, listener, listenerOptions)) as IEventHub<
        C,
        undefined,
        V
      >['subscribe'],
      /** Missing keys remain allocation-free; selected channels retain dispatch ownership. */
      publish: (key, value) => {
        /** Publishing an unused key never creates channel state. */
        const channel = this.#channels.get(validateKey(key as PropertyKey))
        if (channel) channel.publish(value)
      },
      /** Clearing targets current identities without invoking listeners. */
      clear: (key) => this.#clear(key),
      /** Maintained aggregate count and keyed channel size both require O(1) work. */
      size: (key) =>
        key === undefined
          ? this.#totalSize
          : (this.#channels.get(validateKey(key as PropertyKey))?.size ?? 0)
    }
    try {
      projectEventApiStyle(this.surface, options.stylePlan)
    } catch (error) {
      throw createInvalidOptionsError(error)
    }
  }

  /** Transfers the first registration into a callable chain and rolls it back if projection fails. */
  #subscribe<K extends keyof C>(
    key: K,
    listener: IEventListener<C[K], void> | IEventValueListener<C[K]>,
    listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
  ) {
    /** The raw handle owner acquires this release before descriptor projection can fail. */
    const release = this.#registerRaw(key, listener, listenerOptions)
    return createRawSubscriptionOwner(
      release,
      (nextKey, nextListener, nextOptions) => this.#registerRaw(nextKey, nextListener, nextOptions),
      this.#options.stylePlan
    )
  }

  /** Removes one bookkeeping owner once; stale identities cannot remove a recreated channel. */
  deactivate(registration: HubRegistration<V>): void {
    // Clear already removed this channel's count; old owners must not affect its replacement.
    if (this.#channels.get(registration.key) !== registration.channel) return
    this.#totalSize -= 1
    if (registration.channel.size === 0) this.#channels.delete(registration.key)
  }

  /** Lazily constructs one canonical dispatch owner; key lookup and insertion are O(1). */
  #getChannel(key: keyof C): {
    channel: ICanonicalEventChannel<unknown, void, undefined, V>
    validated: PropertyKey
  } {
    /** Key validation precedes any channel allocation. */
    const validated = validateKey(key as PropertyKey)
    /** Current channel, if the key already owns active registrations. */
    let channel = this.#channels.get(validated)
    if (!channel) {
      /** Reporter gets the key captured by this keyed channel, preserving its original identity. */
      const report = this.#options.report
      /** Fixed Hub policy options delegate dispatch ownership to the canonical channel. */
      const channelOptions: IEventChannelOptions<unknown, undefined, V> = {
        report: report
          ? (failure) =>
              report({ key, event: failure.event as never, error: failure.error } as never)
          : undefined,
        terminalReport: this.#options.terminalReport,
        valueConfig: this.#options.valueConfig as IEventChannelOptions<
          unknown,
          undefined,
          V
        >['valueConfig']
      }
      channel = this.#options.projectionPlan
        ? createChannelWithProjection<unknown, void, V>(
            channelOptions,
            this.#options.projectionPlan
          )
        : createCanonicalChannel<unknown, void, V>(channelOptions)
      this.#channels.set(validated, channel)
    }
    return { channel, validated }
  }

  /** Admits a listener, then attaches exactly one O(1)-removable aggregate count owner. */
  #registerRaw<K extends keyof C>(
    key: K,
    listener: IEventListener<C[K], void> | IEventValueListener<C[K]>,
    listenerOptions?: Pick<IEventSubscribeOptions, 'delivery'>
  ): () => void {
    validateEventListener(listener)
    /** Delivery admission precedes channel construction and bookkeeping mutation. */
    const delivery = readDeliveryOption(listenerOptions)
    const { channel, validated } = this.#getChannel(key)
    /** This owner links the channel release, context abort overlay, and aggregate bookkeeping. */
    const registration = new HubRegistration(
      this,
      channel,
      validated,
      listener as IEventListener<unknown, void>,
      this.#options.projectionPlan
    )
    registration.install(delivery)
    this.#totalSize += 1
    return registration.release
  }

  /**
   * Delegates membership clearing to each channel and updates aggregate counts without a second
   * registry.
   */
  #clear(key?: keyof C): void {
    if (key !== undefined) {
      /** Key validation preserves the original ordering before the map read. */
      const validated = validateKey(key as PropertyKey)
      /** Cleared channel identity invalidates every old owner's aggregate-count contribution. */
      const channel = this.#channels.get(validated)
      if (!channel) return
      // Canonical clear invokes no user callbacks, so its current size is the exact removed count.
      this.#totalSize -= channel.size
      channel.clear()
      if (this.#channels.get(validated) === channel) this.#channels.delete(validated)
      return
    }
    for (const channel of this.#channels.values()) channel.clear()
    this.#channels.clear()
    this.#totalSize = 0
  }
}

/** Owns one channel subscription and its Hub count entry, including context-triggered cancellation. */
class HubRegistration<V> {
  /** Hub removes this owner from aggregate counts exactly once. */
  readonly #owner: Pick<EventHubOwner<IEventMap, V>, 'deactivate'>
  /** Original listener identity is invoked with either payload or an overlay context. */
  readonly #listener: IEventListener<unknown, void> | IEventValueListener<unknown>
  /** Static projection data copied onto overlays without taking control ownership. */
  readonly #projectionPlan: IEventProjectionPlan | undefined
  /** Underlying release is assigned after channel admission succeeds. */
  #channelRelease: (() => void) | undefined
  /** Prevents repeated decrements; cleared channel identities are rejected by the Hub separately. */
  #active = true
  /** Exact channel identity protects newer registrations from stale releases. */
  readonly channel: ICanonicalEventChannel<unknown, void, undefined, V>
  /** Validated key used only for identity-guarded map removal. */
  readonly key: PropertyKey
  /** Detached public release retains the original owner and preserves channel-before-count order. */
  readonly release = (): void => {
    this.#channelRelease!()
    this.deactivate()
  }

  /**
   * Records ownership before installing a callback; canonical admission never delivers
   * synchronously.
   */
  constructor(
    owner: Pick<EventHubOwner<IEventMap, V>, 'deactivate'>,
    channel: ICanonicalEventChannel<unknown, void, undefined, V>,
    key: PropertyKey,
    listener: IEventListener<unknown, void> | IEventValueListener<unknown>,
    projectionPlan: IEventProjectionPlan | undefined
  ) {
    this.#owner = owner
    this.channel = channel
    this.key = key
    this.#listener = listener
    this.#projectionPlan = projectionPlan
  }

  /** Chooses delivery once; value mode does not allocate an event-context overlay. */
  install(delivery: EventDelivery): void {
    this.#channelRelease =
      delivery === EventDelivery.value
        ? this.channel.subscribe(this.#listener as IEventValueListener<unknown>, { delivery })
        : this.channel.subscribe((event) => this.#deliver(event))
  }

  /** Removes aggregate ownership once while leaving current channel snapshots intact. */
  deactivate(): void {
    if (!this.#active) return
    this.#active = false
    this.#owner.deactivate(this)
  }

  /** Keeps fresh plain-object contexts with live channel controls and fixed dispatch data. */
  #deliver(event: Parameters<IEventListener<unknown, void, V>>[0]): void | PromiseLike<void> {
    /** Fresh plain-object overlay forwards live controls without borrowing the listener receiver. */
    const context = createHubEventContext(event, this)
    copyEventProjection(context, event, this.#projectionPlan)
    /** Detached invocation preserves the listener's original receiver contract. */
    const listener = this.#listener as IEventListener<unknown, void>
    return listener(context as never)
  }
}

/** Builds a receiver-independent Hub overlay with explicit source-event and registration ownership. */
function createHubEventContext<T, V>(
  event: IEventContext<T>,
  registration: Pick<HubRegistration<V>, 'deactivate'>
): IEventContext<T> {
  /** Public context mirrors canonical descriptors and remains receiver independent. */
  return {
    /** Original payload identity belongs to the canonical dispatch. */
    get value() {
      return event.value
    },
    /** Live abort state is read from the source registration. */
    get aborted() {
      return event.aborted
    },
    /** Cancellation reason remains the original source value. */
    get abortReason() {
      return event.abortReason
    },
    /** Dispatch task label remains fixed by the source snapshot. */
    get taskId() {
      return event.taskId
    },
    /** Cancellation also deactivates this Hub bookkeeping owner. */
    abort(reason?: unknown) {
      event.abort(reason)
      registration.deactivate()
    },
    /** Future task selection remains channel-owned. */
    setTaskId(taskId: string | undefined) {
      event.setTaskId(taskId)
    }
  }
}
