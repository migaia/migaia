import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'

/** Outbound Window-like target that owns postMessage delivery. */
export type IWindowMessageTarget = {
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly Transferable[]): void
}

/** Inbound realm that owns message listener registration. */
export type IWindowMessageReceiver = {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export type IWindowMessageTransportOptions = {
  readonly target: IWindowMessageTarget
  readonly receiver?: IWindowMessageReceiver
  /** Defaults to current window.location.origin when available. */
  readonly targetOrigin?: string
  /** Explicit opt-in for wildcard delivery; source identity is still required on receive. */
  readonly allowUnsafeTargetOrigin?: boolean
}

/** Adapts distinct outbound and inbound Window owners without weakening source proof. */
export function createWindowMessageTransport(
  options: IWindowMessageTransportOptions
): IWebRpcTransport<unknown, Transferable> {
  const target = options.target
  const receiver =
    options.receiver ??
    ((globalThis as unknown as { addEventListener?: unknown }).addEventListener
      ? (globalThis as unknown as IWindowMessageReceiver)
      : undefined)
  const targetOrigin =
    options.targetOrigin ??
    (globalThis as unknown as { location?: { origin?: unknown } }).location?.origin
  if (!receiver)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'receiver is required outside a window-like realm'
    )
  if (typeof targetOrigin !== 'string' || targetOrigin.length === 0)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'targetOrigin must be explicit; use "*" only intentionally'
    )
  if (targetOrigin === '*' && options.allowUnsafeTargetOrigin !== true)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'wildcard targetOrigin requires allowUnsafeTargetOrigin'
    )
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
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
    listeners.dispatch({ data, origin, source }, (listener, message) =>
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    )
  }
  return {
    platform: WebRpcPlatform.iframe,
    topology: 'multiplexed',
    ownership: WebRpcTransportOwnership.borrowed,
    sourceProof: (source, origin) =>
      source === target && (targetOrigin === '*' || origin === targetOrigin),
    ...(targetOrigin === '*' ? {} : { origin: targetOrigin }),
    send(message, options?: IWebRpcSendOptions<Transferable>) {
      target.postMessage(message, targetOrigin, options?.transfer)
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
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => receiver.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: WebRpcErrorCode.transport, secondaryFailures }
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
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  }
}
