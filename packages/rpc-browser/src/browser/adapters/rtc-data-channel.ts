import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcTransport } from '@migaia/rpc-core/transport-kit'
import {
  RpcPlatform,
  RpcTransportOwnership,
  collectListenerCleanupFailures,
  collectListenerFailure,
  createListenerFailure,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure,
  safeRead
} from '@migaia/rpc-core/transport-kit'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'
import { createBrowserTransportError } from '../error.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { BrowserRpcErrorText } from '../error-text.js'

/** Minimal RTCDataChannel surface accepted by the adapter. */
export type IRTCDataChannel = {
  /** Native string send; the adapter stringifies non-string outgoing messages before delegation. */
  send(data: string): void
  /** Construct with open, or closed for an already-terminal adapter; connecting/closing rejects. */
  readonly readyState: string
  /** Register message delivery and closing/close/error terminal notification. */
  addEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
  /** Remove the same native callback; adapter cleanup never calls the channel's close method. */
  removeEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void
}

/**
 * Adapt an existing RTCDataChannel as a borrowed exclusive string Endpoint transport. Strings are
 * sent unchanged and other values use JSON.stringify; received data remains undecoded. The Peer
 * bridge adds JSON decoding and reliability checks, while this lower-level adapter does not check
 * ordered/maxRetransmits/maxPacketLifeTime. Complete signaling and wait for open before normal
 * use.
 *
 * Missing lifecycle operations or connecting/closing states throw TypeError/INVALID_CONFIG. An
 * already-closed channel yields a terminal adapter. Closing/close/error events mark it closed,
 * retire listeners and report TRANSPORT, retaining the event's original error by identity or cause.
 * Late onTransportError subscribers see the stored primary; later send/subscribe throw. Listener
 * and probe failures use onListenerError. Subscription cleanup releases native hooks, not the
 * channel or its RTCPeerConnection; the caller owns both physical lifetimes.
 */
export function createRtcDataChannelTransport(channel: IRTCDataChannel): IRpcTransport {
  if (
    !channel ||
    typeof channel !== 'object' ||
    typeof channel.send !== 'function' ||
    typeof channel.readyState !== 'string' ||
    typeof channel.addEventListener !== 'function' ||
    typeof channel.removeEventListener !== 'function'
  )
    throw attachErrorIdentity(
      new TypeError(
        BrowserRpcErrorText.rtcDataChannelMustExposeReadyStateAndTerminalEventListeners
      ),
      { source: RPC_CORE_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
    )
  if (channel.readyState !== 'open' && channel.readyState !== 'closed')
    throw attachErrorIdentity(
      new TypeError(BrowserRpcErrorText.rtcDataChannelMustBeOpenBeforeTransportConstruction),
      { source: RPC_CORE_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
    )
  const listeners = createMessageListenerHub<{ data: unknown }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  /** Observation failures use listener reporting so Endpoint never rejects pending business calls. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.rtcDataChannel, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )
  let closed = channel.readyState === 'closed'
  if (closed) observation.close()
  let terminalReported = closed
  let terminalError: unknown = closed
    ? attachErrorIdentity(new Error(BrowserRpcErrorText.rtcClosed), {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.transport
      })
    : undefined
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
      { code: RpcCoreErrorCode.transport, secondaryFailures }
    )
    terminalListenersInstalled = true
  }
  const onMessage = (event: unknown): void => {
    let readFailed = false
    const data = safeRead<unknown>(event, 'data', ({ error }) => {
      readFailed = true
      reportListenerFailure(
        createBrowserTransportError(BrowserRpcErrorText.rtcMessageReadFailed, error),
        transportErrors,
        secondaryFailures
      )
      return undefined
    })
    if (readFailed) return
    /** Capture physical channel data before any business decoding. */
    const probe = observation.probe
    if (probe !== undefined) observation.emit(probe, 1, data)
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
    observation.close()
    listeners.clear(() => undefined)
    const cleanupErrors = collectListenerCleanupFailures([
      () => channel.removeEventListener('closing', onTerminal),
      () => channel.removeEventListener('close', onTerminal),
      () => channel.removeEventListener('error', onTerminal),
      () => channel.removeEventListener('message', onMessage)
    ])
    if (cleanupErrors.length === 0) terminalListenersInstalled = false
    /** Keep an attachable external Error by identity; otherwise preserve it through cause. */
    let error: Error
    /** Preflight or tagging failures remain behind the terminal primary. */
    const secondary: unknown[] = []
    if (event instanceof Error) {
      try {
        error =
          Object.isExtensible(event) && !('source' in event) && !('code' in event)
            ? attachErrorIdentity(event, {
                source: RPC_CORE_ERROR_SOURCE,
                code: RpcCoreErrorCode.transport
              })
            : attachErrorIdentity(new Error(BrowserRpcErrorText.rtcClosed, { cause: event }), {
                source: RPC_CORE_ERROR_SOURCE,
                code: RpcCoreErrorCode.transport
              })
      } catch (failure) {
        secondary.push(failure)
        error = attachErrorIdentity(new Error(BrowserRpcErrorText.rtcClosed, { cause: event }), {
          source: RPC_CORE_ERROR_SOURCE,
          code: RpcCoreErrorCode.transport
        })
      }
    } else {
      /** RTC-style event objects retain their error slot, or the event itself if none is present. */
      const cause =
        safeRead<unknown>(event, 'error', ({ error }) => {
          secondary.push(error)
          return undefined
        }) ?? event
      error = createBrowserTransportError(BrowserRpcErrorText.rtcClosed, cause)
    }
    terminalError = error
    const failure = createListenerFailure([error, ...secondary, ...cleanupErrors], {
      code: RpcCoreErrorCode.transport,
      message: BrowserRpcErrorText.rtcSubscriptionCleanupFailed
    })
    reportListenerFailure(failure, transportErrors, secondaryFailures)
  }
  return {
    platform: RpcPlatform.rtcDataChannel,
    topology: 'exclusive',
    ownership: RpcTransportOwnership.borrowed,
    get closed() {
      return closed
    },
    encodedType: 'string',
    send(message) {
      if (closed) throw createBrowserTransportError(BrowserRpcErrorText.rtcDataChannelIsClosed)
      /** The existing physical wire boundary serializes only non-string messages. */
      const data = typeof message === 'string' ? message : JSON.stringify(message)
      /** Observation sees the same physical string passed to the native channel. */
      const probe = observation.probe
      if (probe !== undefined) observation.emit(probe, 0, data)
      channel.send(data)
    },
    /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
    observe(probe) {
      return observation.observe(probe)
    },
    subscribe(listener) {
      if (closed) throw createBrowserTransportError(BrowserRpcErrorText.rtcDataChannelIsClosed)
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
            code: RpcCoreErrorCode.transport,
            message: BrowserRpcErrorText.rtcSubscriptionCleanupFailed,
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
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
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
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    }
  }
}
