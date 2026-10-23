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
export function createWindowMessageTransport(
  options: IWindowMessageTransportOptions
): IRpcTransport<unknown, Transferable> {
  const target = options.target
  const receiver =
    options.receiver ??
    (detectGlobalScope() === GlobalScopeKind.window
      ? (globalThis as unknown as IWindowMessageReceiver)
      : undefined)
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
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  /** Observation owns no platform resource and reports through the existing carrier channel. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.window, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )
  /** One source/origin rule serves both transport admission and carrier observation. */
  const sourceProof = (source: unknown, origin?: string) =>
    source === target && (targetOrigin === '*' || origin === targetOrigin)
  const onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = event.data
      origin = event.origin
      source = event.source
    } catch (error) {
      reportListenerFailure(error, listenerErrors, secondaryFailures)
      return
    }
    /** Rejected messages retain existing dispatch semantics but never enter observation. */
    const probe = observation.probe
    if (probe !== undefined) {
      if (sourceProof(source, origin)) observation.emit(probe, 1, data, origin)
      else observation.rejectSource()
    }
    listeners.dispatch({ data, origin, source }, (listener, message) =>
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    )
  }
  return {
    platform: RpcPlatform.iframe,
    topology: 'multiplexed',
    ownership: RpcTransportOwnership.borrowed,
    sourceProof,
    ...(targetOrigin === '*' ? {} : { origin: targetOrigin }),
    send(message, options?: IRpcSendOptions<Transferable>) {
      /** Read the caller's transfer choice once, preserving getter failure and native detachment. */
      const transfer = options?.transfer
      /** Observe before postMessage can detach an explicitly transferred byte buffer. */
      const probe = observation.probe
      if (probe !== undefined) observation.emit(probe, 0, message, targetOrigin, transfer)
      target.postMessage(message, targetOrigin, transfer)
    },
    /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
    observe(probe) {
      return observation.observe(probe)
    },
    subscribe(listener) {
      listeners.add(listener, () =>
        registerListeners(
          [
            {
              add: () => receiver.addEventListener('message', onMessage),
              remove: () => receiver.removeEventListener('message', onMessage)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => receiver.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onTransportError() {
      return () => undefined
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  }
}
