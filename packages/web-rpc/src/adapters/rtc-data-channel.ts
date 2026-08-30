import { WebRpcErrorCode, WebRpcTransportError, tagWebRpcError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcTransport } from '../transport.js'
import { safeRead } from '../internal/safe-value.js'
import {
  collectListenerFailure,
  collectListenerCleanupFailures,
  createListenerFailureState,
  createListenerFailure,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'

/** Minimal RTCDataChannel surface accepted by the adapter. */
export type IRTCDataChannel = {
  send(data: string): void
  readonly readyState: string
  addEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
  removeEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
}

/** Uses the reliable ordered data channel as a string-message transport. */
export function createRtcDataChannelTransport(channel: IRTCDataChannel): IWebRpcTransport {
  if (
    !channel ||
    typeof channel !== 'object' ||
    typeof channel.send !== 'function' ||
    typeof channel.readyState !== 'string' ||
    typeof channel.addEventListener !== 'function' ||
    typeof channel.removeEventListener !== 'function'
  )
    throw tagWebRpcError(
      new TypeError('RTCDataChannel must expose readyState and terminal event listeners'),
      WebRpcErrorCode.invalidConfig
    )
  if (channel.readyState !== 'open' && channel.readyState !== 'closed')
    throw tagWebRpcError(
      new TypeError('RTCDataChannel must be open before transport construction'),
      WebRpcErrorCode.invalidConfig
    )
  const listeners = createMessageListenerHub<{ data: unknown }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  let closed = channel.readyState === 'closed'
  let terminalReported = closed
  let terminalError: unknown = closed ? new Error('RTCDataChannel closed') : undefined
  let terminalListenersInstalled = false
  const installTerminalListeners = (): void => {
    if (terminalListenersInstalled) return
    registerListeners(
      [
        {
          add: () => channel.addEventListener('closing', onTerminal),
          remove: () => channel.removeEventListener('closing', onTerminal)
        },
        {
          add: () => channel.addEventListener('close', onTerminal),
          remove: () => channel.removeEventListener('close', onTerminal)
        },
        {
          add: () => channel.addEventListener('error', onTerminal),
          remove: () => channel.removeEventListener('error', onTerminal)
        }
      ],
      { code: WebRpcErrorCode.transport, secondaryFailures }
    )
    terminalListenersInstalled = true
  }
  const onMessage = (event: unknown): void => {
    const data = safeRead<unknown>(event, 'data')
    listeners.dispatch({ data }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    })
  }
  const onTerminal = (event: unknown): void => {
    if (terminalReported) return
    terminalReported = true
    closed = true
    listeners.clear(() => undefined)
    const cleanupErrors = collectListenerCleanupFailures([
      () => channel.removeEventListener('closing', onTerminal),
      () => channel.removeEventListener('close', onTerminal),
      () => channel.removeEventListener('error', onTerminal),
      () => channel.removeEventListener('message', onMessage)
    ])
    if (cleanupErrors.length === 0) terminalListenersInstalled = false
    const error = event instanceof Error ? event : new Error('RTCDataChannel closed')
    terminalError = error
    const failure = createListenerFailure([error, ...cleanupErrors], {
      code: WebRpcErrorCode.transport,
      message: WebRpcErrorText.rtcSubscriptionCleanupFailed
    })
    reportListenerFailure(failure, transportErrors, secondaryFailures)
  }
  return {
    platform: WebRpcPlatform.rtcDataChannel,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    get closed() {
      return closed
    },
    encodedType: 'string',
    send(message) {
      if (closed) throw new WebRpcTransportError('RTCDataChannel is closed')
      channel.send(typeof message === 'string' ? message : JSON.stringify(message))
    },
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('RTCDataChannel is closed')
      listeners.add(listener, () => {
        installTerminalListeners()
        try {
          channel.addEventListener('message', onMessage)
        } catch (error) {
          const cleanupErrors = collectListenerCleanupFailures([
            () => channel.removeEventListener('closing', onTerminal),
            () => channel.removeEventListener('close', onTerminal),
            () => channel.removeEventListener('error', onTerminal)
          ])
          if (cleanupErrors.length === 0) terminalListenersInstalled = false
          drainListenerFailures([error, ...cleanupErrors], {
            code: WebRpcErrorCode.transport,
            message: WebRpcErrorText.rtcSubscriptionCleanupFailed,
            secondaryFailures
          })
        }
      })
      return () => {
        if (!listeners.has(listener)) return
        const isFinal = listeners.size === 1
        releaseListenerRegistration(
          isFinal
            ? [
                ...(transportErrors.size === 0
                  ? [
                      () => channel.removeEventListener('closing', onTerminal),
                      () => channel.removeEventListener('close', onTerminal),
                      () => channel.removeEventListener('error', onTerminal)
                    ]
                  : []),
                () => channel.removeEventListener('message', onMessage)
              ]
            : [],
          () => {
            listeners.remove(listener, () => undefined)
            if (isFinal && transportErrors.size === 0) terminalListenersInstalled = false
          },
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    onTransportError(listener) {
      if (!terminalReported) installTerminalListeners()
      transportErrors.add(listener)
      if (terminalReported) {
        observeListener(
          () => listener(terminalError),
          (error) => collectListenerFailure(secondaryFailures, error),
          secondaryFailures
        )
      }
      return () => {
        if (!transportErrors.has(listener)) return
        const isFinal = transportErrors.size === 1 && listeners.size === 0
        releaseListenerRegistration(
          isFinal
            ? [
                () => channel.removeEventListener('closing', onTerminal),
                () => channel.removeEventListener('close', onTerminal),
                () => channel.removeEventListener('error', onTerminal)
              ]
            : [],
          () => {
            transportErrors.delete(listener)
            if (isFinal) terminalListenersInstalled = false
          },
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    }
  }
}
