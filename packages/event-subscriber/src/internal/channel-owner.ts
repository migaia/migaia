/**
 * Composes channel configuration, registration membership and dispatch. Owns the public plain
 * object's stable callbacks and subscription-chain admission, without owning scheduler details.
 */
import { validateEventListener } from './channel-options.ts'
import { EventSubscriberErrorCode } from '../error-code.ts'
import { codeExistingError } from '../errors.ts'
import type {
  ICanonicalEventChannel,
  IEventChannelOptions,
  IEventListener,
  IEventSubscribeOptions,
  IEventValueListener,
  IFilteredEventChannel,
  IUnsubscribe
} from '../types.ts'
import { projectEventApiStyle, type IEventApiStyle } from '../style.ts'
import { projectEventValue, type IEventProjectionPlan } from '../value-projection.ts'
import {
  channelCapabilities,
  filteredCapabilities,
  type IChannelCapability
} from './channel-capability.ts'
import { readChannelConfiguration, type IChannelConfiguration } from './channel-configuration.ts'
import { readDeliveryOption, readTaskOption, validateTaskId } from './channel-options.ts'
import { ChannelDispatch } from './channel-dispatch.ts'
import { ChannelRegistrations } from './channel-registrations.ts'
import { LiveVisit } from './live-visit.ts'
import { createRawSubscriptionOwner } from './subscription.ts'

/** Admits the listener and its options before any registration or handle state changes. */
function readRegistrationOptions<T, R, V>(
  listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
  options?: IEventSubscribeOptions
) {
  validateEventListener(listener)
  /** Getter order remains taskId then delivery, each read once at admission. */
  const taskId = readTaskOption(options)
  /** Delivery belongs to this registration for its entire lifetime. */
  const delivery = readDeliveryOption(options)
  return { taskId, delivery }
}

/** Owns one canonical channel without exposing mutable state on its public object. */
export class CanonicalChannel<T, R, V> {
  /** Construction options are fully admitted before creating membership. */
  readonly #configuration: IChannelConfiguration<T, V>
  /** Ordered membership is shared by publish, async snapshots and live visits. */
  readonly #registrations: ChannelRegistrations<T, R, V>
  /** Publish scheduling and transaction state are isolated from handle admission. */
  readonly #dispatch: ChannelDispatch<T, R, V>
  /** Plain canonical surface retains the incumbent own-property shape and detachability. */
  readonly channel: ICanonicalEventChannel<T, R, undefined, V>

  /** Creates the public surface, projects aliases, then admits the same-package capability. */
  constructor(
    options: IEventChannelOptions<T, IEventApiStyle | undefined, V>,
    projectionPlan?: IEventProjectionPlan
  ) {
    this.#configuration = readChannelConfiguration(options, projectionPlan)
    this.#registrations = new ChannelRegistrations(
      this.#configuration.admissionPolicy,
      this.#configuration.options.removalPolicy
    )
    this.#dispatch = new ChannelDispatch(
      this.#registrations,
      this.#configuration.options,
      this.#configuration.projectionPlan
    )
    this.channel = CanonicalChannel.#createSurface(this)
    /** Package-only operations stay outside the public object's descriptor surface. */
    const capability: IChannelCapability<T, R, V> = {
      plan: this.#configuration.projectionPlan,
      options: this.#configuration.options,
      project: (value) => projectEventValue(value, this.#configuration.projectionPlan),
      snapshot: (taskId) => this.#registrations.snapshot(taskId),
      selectTask: (taskId) => this.#registrations.selectTask(taskId),
      liveVisit: (value, taskId, visitor) =>
        new LiveVisit(
          this.#registrations,
          this.#configuration.options,
          this.#configuration.projectionPlan,
          value,
          taskId
        ).run(visitor)
    }
    try {
      projectEventApiStyle(this.channel, this.#configuration.stylePlan)
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
    }
    channelCapabilities.set(
      this.channel,
      capability as IChannelCapability<unknown, unknown, unknown>
    )
  }

  /**
   * Builds the required plain own-property surface with detached callbacks. Returning the owner
   * instance would change public reflection and receiver semantics, so these callbacks share only
   * the explicit owner parameter rather than a second mutable component context.
   */
  static #createSurface<T, R, V>(
    owner: CanonicalChannel<T, R, V>
  ): ICanonicalEventChannel<T, R, undefined, V> {
    return {
      subscribe: (listener, options) => owner.#subscribe(listener, options),
      publish: (value) => owner.#dispatch.publish(value),
      filterTaskId: (taskId) => owner.#filterTaskId(taskId),
      clear: () => owner.#registrations.clear(),
      /** Reads the maintained count without installing a local function or changing descriptors. */
      get size() {
        return owner.#registrations.size
      }
    } as ICanonicalEventChannel<T, R, undefined, V>
  }

  /** Extends an existing chain after validation; no new public owner projection is required. */
  readonly #extend = (
    listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
    options?: IEventSubscribeOptions
  ): IUnsubscribe => {
    const { taskId, delivery } = readRegistrationOptions(listener, options)
    /** Existing unique registration retains its original position and control. */
    const shared = this.#registrations.admitUnique(listener, taskId, delivery)
    if (shared) return shared
    /** Admission becomes visible only after its synchronous setup succeeds. */
    const admission = this.#registrations.register(listener, taskId, delivery)
    admission.commit()
    return admission.release
  }

  /** Projects a callable chain before committing new registration membership; rolls back on error. */
  #subscribe(
    listener: IEventListener<T, R, V> | IEventValueListener<T, R>,
    listenerOptions?: IEventSubscribeOptions
  ) {
    const { taskId, delivery } = readRegistrationOptions(listener, listenerOptions)
    /** A unique duplicate shares only its release, never another handle's projection transaction. */
    const shared = this.#registrations.admitUnique(listener, taskId, delivery)
    /** New owner remains outside dispatch until the handle projection commits. */
    const admission = shared ? undefined : this.#registrations.register(listener, taskId, delivery)
    /** A failed duplicate projection must not release the existing registration. */
    let bound = false
    try {
      /** The raw owner retains disposer ordering and style method identities. */
      const handle = createRawSubscriptionOwner(
        shared
          ? () => {
              if (bound) shared()
            }
          : admission!.release,
        this.#extend,
        this.#configuration.stylePlan
      )
      bound = true
      admission?.commit()
      return handle
    } catch (error) {
      admission?.release()
      throw error
    }
  }

  /** Creates a task view with WeakMap identity and no exposed mutable membership. */
  #filterTaskId(taskId: string): IFilteredEventChannel<T, R, V> {
    /** Validate before allocating the opaque view. */
    const validated = validateTaskId(taskId, false) as string
    /** View identity carries no own observable control fields. */
    const filtered = {} as IFilteredEventChannel<T, R, V>
    filteredCapabilities.set(filtered, {
      channel: this.channel as ICanonicalEventChannel<unknown, unknown, undefined, unknown>,
      taskId: validated
    })
    return filtered
  }
}
