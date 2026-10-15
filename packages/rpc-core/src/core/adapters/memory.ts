import { deferTask, systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import type { IRpcCarrierProbe } from '../probe/types.js'
import { carrierSizeBytes } from './probe-content.js'
import { createRpcTransportError, RpcCoreErrorCode, tagRpcError } from '../errors.js'
import { RpcAdapterErrorText } from './error-text.js'

import type { IRpcTransport } from '../transport.js'
import { RpcPlatform, RpcTransportOwnership } from '../transport-constants.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  reportListenerFailure
} from '../internal/listener-safety.js'
import {
  createMessageListenerHub,
  type IMessageListenerHub
} from '../internal/message-listener-hub.js'

/** Closure-owned observation state keeps both physical sides visible to queued delivery. */
type IMemoryObservation = { probe: IRpcCarrierProbe | undefined; generation: number }

/** Delivery jobs belong to this pair; endpoint deadline clocks remain separately configured. */
export type IMemoryTransportOptions = Readonly<{
  /** Defaults to native microtask delivery; injected clocks control only this pair's queued jobs. */
  scheduler?: IScheduler
}>

export type IMemoryTransport = IRpcTransport & {
  /**
   * Tears down the whole pair — closing either side closes both; after this, `send()` on either
   * throws.
   */
  close(): void
  readonly closed: boolean
}

/**
 * Same-process, no-DOM transport — mainly for tests and for wiring a client and server together
 * without a real channel. Delivery is queued as a microtask (not synchronous) so behavior matches a
 * real async transport: code that assumes "the other side hasn't seen this yet" immediately after
 * `send()` returns stays correct.
 */
export function createMemoryTransportPair(
  options: IMemoryTransportOptions = {}
): readonly [IMemoryTransport, IMemoryTransport] {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw tagRpcError(
      new TypeError(RpcAdapterErrorText.memoryOptions),
      RpcCoreErrorCode.invalidConfig
    )
  /** Capture the chosen delivery capability before either side acquires subscriptions. */
  const scheduler = resolveSchedulerOption(options, systemScheduler)
  const listenersA = createMessageListenerHub<{ data: unknown }>()
  const listenersB = createMessageListenerHub<{ data: unknown }>()
  /** Each physical side owns one independently replaceable observation generation. */
  const observationA: IMemoryObservation = { probe: undefined, generation: 0 }
  /** B-side receive observation reads its own state at physical delivery time. */
  const observationB: IMemoryObservation = { probe: undefined, generation: 0 }
  let closed = false
  const errorsA = new Set<(error: unknown) => void>(),
    errorsB = new Set<(error: unknown) => void>()
  const listenerErrorsA = new Set<(error: unknown) => void>(),
    listenerErrorsB = new Set<(error: unknown) => void>()
  const secondaryFailuresA = createListenerFailureState(),
    secondaryFailuresB = createListenerFailureState()
  let closeStarted = false
  let closeResult: void | Promise<void>

  const makeSide = (
    outgoing: IMessageListenerHub<{ data: unknown }>,
    incoming: IMessageListenerHub<{ data: unknown }>,
    errors: Set<(error: unknown) => void>,
    listenerErrors: Set<(error: unknown) => void>,
    remoteListenerErrors: Set<(error: unknown) => void>,
    secondaryFailures: ReturnType<typeof createListenerFailureState>,
    remoteSecondaryFailures: ReturnType<typeof createListenerFailureState>,
    observation: IMemoryObservation,
    remoteObservation: IMemoryObservation
  ): IMemoryTransport => ({
    platform: RpcPlatform.memory,
    topology: 'exclusive',
    ownership: RpcTransportOwnership.borrowed,
    /** Replace observation; the returned disposer retires only its own installation generation. */
    observe(next) {
      /** Reinstalling the same probe still creates a distinct disposer generation. */
      const generation = ++observation.generation
      if (!closed) observation.probe = next
      return () => {
        if (generation === observation.generation) observation.probe = undefined
      }
    },
    send(message) {
      if (closed) throw createRpcTransportError(RpcAdapterErrorText.rpcMemoryTransportIsClosed)
      if (observation.probe !== undefined) {
        /** One event retains its installed handle across reentrant observation replacement. */
        const currentProbe = observation.probe
        try {
          currentProbe.emit(
            0,
            carrierSizeBytes(message),
            RpcPlatform.memory,
            undefined,
            currentProbe.capturing ? message : undefined
          )
        } catch (error) {
          reportListenerFailure(
            createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
            listenerErrors,
            secondaryFailures
          )
        }
      }
      deferTask(scheduler, () => {
        // Closed between send() and delivery — the other side is gone,
        // there is nobody left to deliver to.
        if (closed) return
        if (remoteObservation.probe !== undefined) {
          /** Physical delivery reads the receiver's currently installed generation once. */
          const receivingProbe = remoteObservation.probe
          try {
            receivingProbe.emit(
              1,
              carrierSizeBytes(message),
              RpcPlatform.memory,
              undefined,
              receivingProbe.capturing ? message : undefined
            )
          } catch (error) {
            reportListenerFailure(
              createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
              remoteListenerErrors,
              remoteSecondaryFailures
            )
          }
        }
        outgoing.dispatch({ data: message }, (listener, messageValue) => {
          observeListener(
            () => listener(messageValue),
            (error) => reportListenerFailure(error, remoteListenerErrors, remoteSecondaryFailures),
            remoteSecondaryFailures
          )
        })
      })
    },
    subscribe(listener) {
      incoming.add(listener, () => undefined)
      return () => {
        const deleted = incoming.remove(listener, () => undefined)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    close() {
      if (closeStarted) return closeResult
      closeStarted = true
      closed = true
      observationA.probe = undefined
      observationB.probe = undefined
      reportListenerFailure(
        tagRpcError(
          new Error(RpcAdapterErrorText.rpcMemoryTransportIsClosed),
          RpcCoreErrorCode.transport
        ),
        errorsA,
        secondaryFailuresA
      )
      reportListenerFailure(
        tagRpcError(
          new Error(RpcAdapterErrorText.rpcMemoryTransportIsClosed),
          RpcCoreErrorCode.transport
        ),
        errorsB,
        secondaryFailuresB
      )
      listenersA.clear(() => undefined)
      listenersB.clear(() => undefined)
      closeResult = drainTerminalListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: [secondaryFailuresA, secondaryFailuresB]
      })
      return closeResult
    },
    get closed() {
      return closed
    },
    onTransportError(listener) {
      errors.add(listener)
      return () => {
        const deleted = errors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  })

  return [
    makeSide(
      listenersB,
      listenersA,
      errorsA,
      listenerErrorsA,
      listenerErrorsB,
      secondaryFailuresA,
      secondaryFailuresB,
      observationA,
      observationB
    ),
    makeSide(
      listenersA,
      listenersB,
      errorsB,
      listenerErrorsB,
      listenerErrorsA,
      secondaryFailuresB,
      secondaryFailuresA,
      observationB,
      observationA
    )
  ]
}
