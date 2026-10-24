import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { BrowserRpcErrorText } from '../error-text.js'
import type { IRpcSendOptions, IRpcTransport } from '@migaia/rpc-host/plugin'
import {
  RpcPlatform,
  RpcTransportOwnership,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  identifyRpcBoundaryFailure,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '@migaia/rpc-host/plugin'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-host'

/** Minimal SharedWorker port surface accepted by the adapter. */
export type ISharedWorkerPort = {
  /** Native structured-clone send; supplied transfers retain the platform's detachment semantics. */
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  /** Optional native MessagePort activation, invoked when the first message subscriber attaches. */
  start?(): void
  /** Register message delivery or native deserialization failure without taking port ownership. */
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
  /** Remove the exact registered callback; final unsubscribe leaves the native port open. */
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
}

/**
 * Wrap an existing SharedWorker port as a borrowed exclusive Endpoint transport, without creating a
 * worker or importing browser globals. send forwards structured-clone data and optional native
 * transfers. The first subscribe starts the port and installs shared message/messageerror hooks;
 * final unsubscribe removes them, retaining failed cleanup for a later retry rather than closing
 * the port. The caller must close its own port and worker resources.
 *
 * Native messageerror and event-read failures use onTransportError; listener/probe failures use
 * onListenerError. Native send failures receive Core TRANSPORT identity while retaining the
 * original exception or its cause chain. Subscription registration can throw; returned disposers
 * can surface cleanup or retained reporter failures.
 */
/** Allocate one borrowed SharedWorker carrier before installing behavior callbacks. */
function sharedWorkerTransportState(port: ISharedWorkerPort) {
  /** Logical message subscribers share one native listener and retain registration order. */
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
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
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.sharedWorker, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )

  return { listeners, listenerErrors, transportErrors, secondaryFailures, observation, port }
}

/** Own one borrowed SharedWorker carrier; callbacks access only this explicit instance. */
class SharedWorkerTransport {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof sharedWorkerTransportState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcTransport<unknown, Transferable>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(port: ISharedWorkerPort) {
    this.#state = sharedWorkerTransportState(port)

    this.value = {
      platform: RpcPlatform.worker,
      topology: 'exclusive',
      ownership: RpcTransportOwnership.borrowed,
      send: (message, options?: IRpcSendOptions<Transferable>) => {
        /** Read the caller's transfer choice once, preserving getter failure and native detachment. */
        const transfer = options?.transfer
        /** Observe before postMessage can detach an explicitly transferred byte buffer. */
        const probe = this.#state.observation.probe
        if (probe !== undefined)
          this.#state.observation.emit(probe, 0, message, undefined, transfer)
        try {
          this.#state.port.postMessage(message, transfer)
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
              { add: () => this.#state.port.start?.(), remove: () => undefined },
              {
                add: () => this.#state.port.addEventListener('message', this.#onMessage),
                remove: () => this.#state.port.removeEventListener('message', this.#onMessage)
              },
              {
                add: () => this.#state.port.addEventListener('messageerror', this.#onError),
                remove: () => this.#state.port.removeEventListener('messageerror', this.#onError)
              }
            ],
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        )
        return () => {
          if (!this.#state.listeners.has(listener)) return
          releaseListenerRegistration(
            this.#state.listeners.size === 1
              ? [
                  () => this.#state.port.removeEventListener('message', this.#onMessage),
                  () => this.#state.port.removeEventListener('messageerror', this.#onError)
                ]
              : [],
            () => this.#state.listeners.remove(listener, () => undefined),
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
        this.#state.transportErrors.add(listener)
        return () => {
          const deleted = this.#state.transportErrors.delete(listener)
          drainListenerFailures([], {
            code: RpcCoreErrorCode.transport,
            secondaryFailures: this.#state.secondaryFailures
          })
          return deleted
        }
      }
    }
  }

  #onMessage = (event: MessageEvent<unknown> | Event): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = (event as { data?: unknown }).data
      const eventOrigin = (event as { origin?: unknown }).origin
      origin = typeof eventOrigin === 'string' ? eventOrigin : undefined
      source = (event as { source?: unknown }).source
    } catch (error) {
      reportListenerFailure(error, this.#state.transportErrors, this.#state.secondaryFailures)
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

  #onError = (): void => {
    reportListenerFailure(
      attachErrorIdentity(new Error(BrowserRpcErrorText.rpcSharedWorkerMessageError), {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.transport
      }),
      this.#state.transportErrors,
      this.#state.secondaryFailures
    )
  }
}

/** Construct the single owner for one borrowed SharedWorker carrier. */
export function createSharedWorkerTransport(
  port: ISharedWorkerPort
): IRpcTransport<unknown, Transferable> {
  return new SharedWorkerTransport(port).value
}
