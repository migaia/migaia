import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import { BrowserRpcErrorText } from '../error-text.js'
import { createBrowserConfigurationError } from '../error.js'
import type { IRpcSendOptions, IRpcTransport } from '@migaia/rpc-host/plugin'
import {
  RpcPlatform,
  RpcTransportOwnership,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { detectGlobalScope, GlobalScopeKind } from '@migaia/utils'

/** Outbound Window-like target that owns postMessage delivery. */
export type IWindowMessageTarget = {
  /** Perform native structured-clone delivery; an explicit transfer list can detach its buffers. */
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly Transferable[]): void
}

/** Inbound realm that owns message listener registration. */
export type IWindowMessageReceiver = {
  /** Register the adapter's shared native message callback on the receiving realm. */
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  /** Remove that same callback when the final logical subscription leaves. */
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

/** Separate send and receive owners for a borrowed multiplexed Window Endpoint transport. */
export type IWindowMessageTransportOptions = {
  /** Required outgoing target and exact native identity used by sourceProof. */
  readonly target: IWindowMessageTarget
  /** Omitted uses a Window-like global; required outside a realm with addEventListener. */
  readonly receiver?: IWindowMessageReceiver
  /** Defaults to current location.origin when available; empty/unavailable origins reject. */
  readonly targetOrigin?: string
  /** Explicit opt-in for wildcard delivery; source identity is still required on receive. */
  readonly allowUnsafeTargetOrigin?: boolean
}

/**
 * Adapt a borrowed Window for an Endpoint. Returns a multiplexed transport; sourceProof requires
 * both target identity and targetOrigin, except an explicitly permitted '*' relaxes origin only.
 * Raw subscribe preserves source/origin metadata; Endpoint connect or the Peer bridge applies the
 * proof before accepting messages. Invalid receiver/origin configuration throws INVALID_CONFIG.
 *
 * First subscription installs one native listener and the last disposer removes it. No Window close
 * is provided. send forwards one transfer choice to postMessage; observation runs before native
 * detachment. Listener/probe failures use onListenerError, separately from business I/O.
 */
/** Allocate one borrowed Window carrier before installing behavior callbacks. */
function windowMessageTransportState(options: IWindowMessageTransportOptions) {
  /** The caller-supplied Window is the sole destination and accepted remote source. */
  const target = options.target
  /** The local Window receiver owns native subscriptions without taking ownership of either Window. */
  const receiver =
    options.receiver ??
    (detectGlobalScope() === GlobalScopeKind.window
      ? (globalThis as unknown as IWindowMessageReceiver)
      : undefined)
  /** The admitted remote origin remains fixed for outbound sends and inbound origin checks. */
  const targetOrigin =
    options.targetOrigin ??
    (globalThis as unknown as { location?: { origin?: unknown } }).location?.origin
  if (!receiver)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.receiverIsRequiredOutsideAWindowLikeRealm
    )
  if (typeof targetOrigin !== 'string' || targetOrigin.length === 0)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.targetOriginMustBeExplicitUseOnlyIntentionally
    )
  if (targetOrigin === '*' && options.allowUnsafeTargetOrigin !== true)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.wildcardTargetOriginRequiresAllowUnsafeTargetOrigin
    )
  /** Logical message subscribers share one native listener and retain registration order. */
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  /** Registered diagnostic callbacks receive listener failures without losing the primary error. */
  const listenerErrors = new Set<(error: unknown) => void>()
  /**
   * Reporter and listener cleanup failures remain reachable until the existing failure drain
   * observes them.
   */
  const secondaryFailures = createListenerFailureState()
  /** Observation owns no platform resource and reports through the existing carrier channel. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.window, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )

  return {
    target,
    receiver,
    targetOrigin,
    listeners,
    listenerErrors,
    secondaryFailures,
    observation,
    options
  }
}

/** Own one borrowed Window carrier; callbacks access only this explicit instance. */
class WindowMessageTransport {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof windowMessageTransportState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcTransport<unknown, Transferable>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(options: IWindowMessageTransportOptions) {
    this.#state = windowMessageTransportState(options)

    this.value = {
      platform: RpcPlatform.iframe,
      topology: 'multiplexed',
      ownership: RpcTransportOwnership.borrowed,
      sourceProof: this.#sourceProof,
      ...(this.#state.targetOrigin === '*' ? {} : { origin: this.#state.targetOrigin }),
      send: (message, options?: IRpcSendOptions<Transferable>) => {
        /** Read the caller's transfer choice once, preserving getter failure and native detachment. */
        const transfer = options?.transfer
        /** Observe before postMessage can detach an explicitly transferred byte buffer. */
        const probe = this.#state.observation.probe
        if (probe !== undefined)
          this.#state.observation.emit(probe, 0, message, this.#state.targetOrigin, transfer)
        this.#state.target.postMessage(message, this.#state.targetOrigin, transfer)
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
                add: () => this.#state.receiver.addEventListener('message', this.#onMessage),
                remove: () => this.#state.receiver.removeEventListener('message', this.#onMessage)
              }
            ],
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        )
        return () => {
          if (!this.#state.listeners.has(listener)) return
          releaseListenerRegistration(
            this.#state.listeners.size === 1
              ? [() => this.#state.receiver.removeEventListener('message', this.#onMessage)]
              : [],
            () => this.#state.listeners.remove(listener, () => undefined),
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        }
      },
      onTransportError: () => {
        return () => undefined
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
  /** One source/origin rule serves both transport admission and carrier observation. */
  #sourceProof = (source: unknown, origin?: string) =>
    source === this.#state.target &&
    (this.#state.targetOrigin === '*' || origin === this.#state.targetOrigin)

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
    /** Rejected messages retain existing dispatch semantics but never enter observation. */
    const probe = this.#state.observation.probe
    if (probe !== undefined) {
      if (this.#sourceProof(source, origin)) this.#state.observation.emit(probe, 1, data, origin)
      else this.#state.observation.rejectSource()
    }
    this.#state.listeners.dispatch({ data, origin, source }, (listener, message) =>
      observeListener(
        () => listener(message),
        (error) =>
          reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    )
  }
}

/** Construct the single owner for one borrowed Window carrier. */
export function createWindowMessageTransport(
  options: IWindowMessageTransportOptions
): IRpcTransport<unknown, Transferable> {
  return new WindowMessageTransport(options).value
}
