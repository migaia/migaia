import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcTransport } from '@migaia/rpc-host/plugin'
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
} from '@migaia/rpc-host/plugin'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-host'
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
/** Allocate one ordered reliable RTC carrier before installing behavior callbacks. */
function rtcDataChannelTransportState(channel: IRTCDataChannel) {
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
  /** Logical message subscribers share one native listener and retain registration order. */
  const listeners = createMessageListenerHub<{ data: unknown }>()
  /** Registered diagnostic callbacks receive listener failures without losing the primary error. */
  const listenerErrors = new Set<(error: unknown) => void>()
  /** Native carrier failures fan out to the currently registered transport subscribers. */
  const transportErrors = new Set<(error: unknown) => void>()
  /**
   * Reporter and listener cleanup failures remain reachable until the existing failure drain
   * observes them.
   */
  const secondaryFailures = createListenerFailureState()
  /** Observation failures use listener reporting so Endpoint never rejects pending business calls. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.rtcDataChannel, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = channel.readyState === 'closed'
  if (closed) observation.close()
  /** A terminal carrier failure is published once even when closing and close both arrive. */
  let terminalReported = closed
  /** The first terminal carrier reason remains stable for late error subscribers. */
  let terminalError: unknown = closed
    ? attachErrorIdentity(new Error(BrowserRpcErrorText.rtcClosed), {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.transport
      })
    : undefined
  /** Native closing and close listeners are shared until the last logical registration leaves. */
  let terminalListenersInstalled = false

  return {
    listeners,
    listenerErrors,
    transportErrors,
    secondaryFailures,
    observation,
    closed,
    terminalReported,
    terminalError,
    terminalListenersInstalled,
    channel
  }
}

/** Own one ordered reliable RTC carrier; callbacks access only this explicit instance. */
class RtcDataChannelTransport {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof rtcDataChannelTransportState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcTransport
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(channel: IRTCDataChannel) {
    this.#state = rtcDataChannelTransportState(channel)

    this.value = {
      platform: RpcPlatform.rtcDataChannel,
      topology: 'exclusive',
      ownership: RpcTransportOwnership.borrowed,
      closed: false,
      encodedType: 'string',
      send: (message) => {
        if (this.#state.closed)
          throw createBrowserTransportError(BrowserRpcErrorText.rtcDataChannelIsClosed)
        /** The existing physical wire boundary serializes only non-string messages. */
        const data = typeof message === 'string' ? message : JSON.stringify(message)
        /** Observation sees the same physical string passed to the native channel. */
        const probe = this.#state.observation.probe
        if (probe !== undefined) this.#state.observation.emit(probe, 0, data)
        this.#state.channel.send(data)
      },
      /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
      observe: (probe) => {
        return this.#state.observation.observe(probe)
      },
      subscribe: (listener) => {
        if (this.#state.closed)
          throw createBrowserTransportError(BrowserRpcErrorText.rtcDataChannelIsClosed)
        this.#state.listeners.add(listener, () => {
          this.#installTerminalListeners()
          try {
            this.#state.channel.addEventListener('message', this.#onMessage)
          } catch (error) {
            const cleanupErrors = collectListenerCleanupFailures([
              () => this.#state.channel.removeEventListener('closing', this.#onTerminal),
              () => this.#state.channel.removeEventListener('close', this.#onTerminal),
              () => this.#state.channel.removeEventListener('error', this.#onTerminal)
            ])
            if (cleanupErrors.length === 0) this.#state.terminalListenersInstalled = false
            drainListenerFailures([error, ...cleanupErrors], {
              code: RpcCoreErrorCode.transport,
              message: BrowserRpcErrorText.rtcSubscriptionCleanupFailed,
              secondaryFailures: this.#state.secondaryFailures
            })
          }
        })
        return () => {
          if (!this.#state.listeners.has(listener)) return
          const isFinal = this.#state.listeners.size === 1
          releaseListenerRegistration(
            isFinal
              ? [
                  ...(this.#state.transportErrors.size === 0
                    ? [
                        () => this.#state.channel.removeEventListener('closing', this.#onTerminal),
                        () => this.#state.channel.removeEventListener('close', this.#onTerminal),
                        () => this.#state.channel.removeEventListener('error', this.#onTerminal)
                      ]
                    : []),
                  () => this.#state.channel.removeEventListener('message', this.#onMessage)
                ]
              : [],
            () => {
              this.#state.listeners.remove(listener, () => undefined)
              if (isFinal && this.#state.transportErrors.size === 0)
                this.#state.terminalListenersInstalled = false
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
      },
      onTransportError: (listener) => {
        if (!this.#state.terminalReported) this.#installTerminalListeners()
        this.#state.transportErrors.add(listener)
        if (this.#state.terminalReported) {
          observeListener(
            () => listener(this.#state.terminalError),
            (error) => collectListenerFailure(this.#state.secondaryFailures, error),
            this.#state.secondaryFailures
          )
        }
        return () => {
          if (!this.#state.transportErrors.has(listener)) return
          const isFinal = this.#state.transportErrors.size === 1 && this.#state.listeners.size === 0
          releaseListenerRegistration(
            isFinal
              ? [
                  () => this.#state.channel.removeEventListener('closing', this.#onTerminal),
                  () => this.#state.channel.removeEventListener('close', this.#onTerminal),
                  () => this.#state.channel.removeEventListener('error', this.#onTerminal)
                ]
              : [],
            () => {
              this.#state.transportErrors.delete(listener)
              if (isFinal) this.#state.terminalListenersInstalled = false
            },
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        }
      }
    }
    Object.defineProperties(this.value, {
      closed: {
        get: () => {
          return this.#state.closed
        }
      }
    })
  }

  #installTerminalListeners = (): void => {
    if (this.#state.terminalListenersInstalled) return
    registerListeners(
      [
        {
          add: () => this.#state.channel.addEventListener('closing', this.#onTerminal),
          remove: () => this.#state.channel.removeEventListener('closing', this.#onTerminal)
        },
        {
          add: () => this.#state.channel.addEventListener('close', this.#onTerminal),
          remove: () => this.#state.channel.removeEventListener('close', this.#onTerminal)
        },
        {
          add: () => this.#state.channel.addEventListener('error', this.#onTerminal),
          remove: () => this.#state.channel.removeEventListener('error', this.#onTerminal)
        }
      ],
      { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
    )
    this.#state.terminalListenersInstalled = true
  }

  #onMessage = (event: unknown): void => {
    let readFailed = false
    /** The existing physical wire boundary serializes only non-string messages. */
    const data = safeRead<unknown>(event, 'data', ({ error }) => {
      readFailed = true
      reportListenerFailure(
        createBrowserTransportError(BrowserRpcErrorText.rtcMessageReadFailed, error),
        this.#state.transportErrors,
        this.#state.secondaryFailures
      )
      return undefined
    })
    if (readFailed) return
    /** Capture physical channel data before any business decoding. */
    const probe = this.#state.observation.probe
    if (probe !== undefined) this.#state.observation.emit(probe, 1, data)
    this.#state.listeners.dispatch({ data }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) =>
          reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    })
  }

  #onTerminal = (event: unknown): void => {
    if (this.#state.terminalReported) return
    this.#state.terminalReported = true
    this.#state.closed = true
    this.#state.observation.close()
    this.#state.listeners.clear(() => undefined)
    const cleanupErrors = collectListenerCleanupFailures([
      () => this.#state.channel.removeEventListener('closing', this.#onTerminal),
      () => this.#state.channel.removeEventListener('close', this.#onTerminal),
      () => this.#state.channel.removeEventListener('error', this.#onTerminal),
      () => this.#state.channel.removeEventListener('message', this.#onMessage)
    ])
    if (cleanupErrors.length === 0) this.#state.terminalListenersInstalled = false
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
    this.#state.terminalError = error
    const failure = createListenerFailure([error, ...secondary, ...cleanupErrors], {
      code: RpcCoreErrorCode.transport,
      message: BrowserRpcErrorText.rtcSubscriptionCleanupFailed
    })
    reportListenerFailure(failure, this.#state.transportErrors, this.#state.secondaryFailures)
  }
}

/** Construct the single owner for one ordered reliable RTC carrier. */
export function createRtcDataChannelTransport(channel: IRTCDataChannel): IRpcTransport {
  return new RtcDataChannelTransport(channel).value
}
