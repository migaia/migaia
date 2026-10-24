import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcTransport } from '@migaia/rpc-host/plugin'
import {
  RpcPlatform,
  RpcTransportOwnership,
  collectListenerFailure,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  identifyRpcBoundaryFailure,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { BrowserRpcErrorText } from '../error-text.js'

/**
 * Adapt an existing same-origin BroadcastChannel as a borrowed broadcast Endpoint transport. Native
 * delivery is one-to-many rather than a fixed Runtime Peer connection. send performs structured
 * cloning without a transfer list; native clone/send failures receive Core TRANSPORT identity while
 * preserving the original exception or cause.
 *
 * Message subscribers share one native callback. Each onTransportError registration owns its
 * messageerror wrapper; its disposer and message disposers are idempotent and can surface cleanup
 * or retained reporter failures. onListenerError handles dispatch/probe failures. No close method
 * takes ownership of the channel: dispose the Endpoint/subscriptions, then close the channel.
 */
/** Allocate one borrowed broadcast carrier before installing behavior callbacks. */
function broadcastChannelTransportState(channel: BroadcastChannel) {
  /** Logical message subscribers share one native listener and retain registration order. */
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  /** Registered diagnostic callbacks receive listener failures without losing the primary error. */
  const listenerErrors = new Set<(error: unknown) => void>()
  /** Each native messageerror wrapper is retained until its exact registration is released. */
  const transportErrorWrappers = new Set<EventListener>()
  /**
   * Reporter and listener cleanup failures remain reachable until the existing failure drain
   * observes them.
   */
  const secondaryFailures = createListenerFailureState()
  /** Observation owns no platform resource and reports through the existing carrier channel. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.broadcastChannel, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )

  return {
    listeners,
    listenerErrors,
    transportErrorWrappers,
    secondaryFailures,
    observation,
    channel
  }
}

/** Own one borrowed broadcast carrier; callbacks access only this explicit instance. */
class BroadcastChannelTransport {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof broadcastChannelTransportState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcTransport
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(channel: BroadcastChannel) {
    this.#state = broadcastChannelTransportState(channel)

    this.value = {
      platform: RpcPlatform.broadcastChannel,
      topology: 'broadcast',
      ownership: RpcTransportOwnership.borrowed,
      send: (message) => {
        /** Broadcast sends have no transfer list and retain captured content by reference. */
        const probe = this.#state.observation.probe
        if (probe !== undefined) this.#state.observation.emit(probe, 0, message)
        try {
          this.#state.channel.postMessage(message)
        } catch (error) {
          throw identifyRpcBoundaryFailure(
            error,
            RpcCoreErrorCode.transport,
            BrowserRpcErrorText.carrierOperationFailed
          )
        }
      },
      /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
      observe: (probe) => {
        return this.#state.observation.observe(probe)
      },
      subscribe: (listener) => {
        this.#state.listeners.add(listener, () =>
          registerListeners(
            [
              {
                add: () => this.#state.channel.addEventListener('message', this.#onMessage),
                remove: () => this.#state.channel.removeEventListener('message', this.#onMessage)
              }
            ],
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        )
        return () => {
          if (!this.#state.listeners.has(listener)) return
          releaseListenerRegistration(
            this.#state.listeners.size === 1
              ? [() => this.#state.channel.removeEventListener('message', this.#onMessage)]
              : [],
            () => this.#state.listeners.remove(listener, () => undefined),
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        }
      },
      onTransportError: (listener) => {
        const wrapper: EventListener = (event) => {
          observeListener(
            () => listener(event),
            (error) => collectListenerFailure(this.#state.secondaryFailures, error),
            this.#state.secondaryFailures
          )
        }
        registerListeners(
          [
            {
              add: () => this.#state.channel.addEventListener('messageerror', wrapper),
              remove: () => this.#state.channel.removeEventListener('messageerror', wrapper)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
        )
        this.#state.transportErrorWrappers.add(wrapper)
        return () => {
          if (!this.#state.transportErrorWrappers.has(wrapper)) return
          releaseListenerRegistration(
            [() => this.#state.channel.removeEventListener('messageerror', wrapper)],
            () => {
              this.#state.transportErrorWrappers.delete(wrapper)
            },
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        }
      },
      onListenerError: (listener) => {
        this.#state.listenerErrors.add(listener)
        return () => {
          const deleted = this.#state.listenerErrors.delete(listener)
          drainListenerFailures([], {
            code: RpcCoreErrorCode.transport,
            secondaryFailures: this.#state.secondaryFailures
          })
          return deleted
        }
      }
    }
  }

  #onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = event.data
      origin = event.origin
      source = event.source
    } catch (error) {
      reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures)
      return
    }
    /** Exclusive or native-origin traffic is already admitted by this carrier. */
    const probe = this.#state.observation.probe
    if (probe !== undefined) this.#state.observation.emit(probe, 1, data, origin)
    this.#state.listeners.dispatch({ data, origin, source }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) =>
          reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    })
  }
}

/** Construct the single owner for one borrowed broadcast carrier. */
export function createBroadcastChannelTransport(channel: BroadcastChannel): IRpcTransport {
  return new BroadcastChannelTransport(channel).value
}
