import { deferTask, systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import type { IRpcCarrierProbe } from '../../dist/core/probe/types.js'
import { carrierSizeBytes } from '../../dist/core/adapters/probe-content.js'
import { createRpcTransportError, RpcCoreErrorCode, tagRpcError } from '../../dist/core/errors.js'
import { RpcAdapterErrorText } from '../../dist/core/adapters/error-text.js'
import { MemoryTransportText } from './memory-text.ts'

import type { IRpcTransport } from '../../dist/core/transport.js'
import { RpcPlatform, RpcTransportOwnership } from '../../dist/core/transport-constants.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  reportListenerFailure
} from '../../dist/core/internal/listener-safety.js'
import {
  createMessageListenerHub,
  type IMessageListenerHub
} from '../../dist/core/internal/message-listener-hub.js'

/** Pair-owned observation state keeps both physical sides visible to queued delivery. */
type IMemoryObservation = { probe: IRpcCarrierProbe | undefined; generation: number }

/** Delivery jobs belong to this pair; endpoint deadline clocks remain separately configured. */
export type IMemoryTransportOptions = Readonly<{
  /** Defaults to native microtask delivery; injected clocks control only this pair's queued jobs. */
  scheduler?: IScheduler
}>

/**
 * One side of a reference-delivery pair. Closing either side retires the whole pair; endpoint
 * disposal leaves this borrowed carrier open.
 */
export type IMemoryTransport = IRpcTransport & {
  /**
   * Tears down the whole pair — closing either side closes both; after this, `send()` on either
   * throws.
   */
  close(): void
  /** Whether the shared pair has been retired. */
  readonly closed: boolean
}

/**
 * Test-owned same-process reference carrier for genuine Core and provider behavior oracles.
 * Delivery is queued as a microtask (not synchronous) so behavior matches a real async transport:
 * code that assumes "the other side hasn't seen this yet" immediately after `send()` returns stays
 * correct.
 */
/** Allocate one pair's explicit shared lifecycle before either side publishes callbacks. */
function memoryTransportState(options: IMemoryTransportOptions) {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw tagRpcError(new TypeError(MemoryTransportText.options), RpcCoreErrorCode.invalidConfig)
  /** Capture the chosen delivery capability before either side acquires subscriptions. */
  const scheduler = resolveSchedulerOption(options, systemScheduler)
  /** The A-side logical message hub receives only deliveries from its opposite physical side. */
  const listenersA = createMessageListenerHub<{ data: unknown }>()
  /** The B-side logical message hub receives only deliveries from its opposite physical side. */
  const listenersB = createMessageListenerHub<{ data: unknown }>()
  /** Each physical side owns one independently replaceable observation generation. */
  const observationA: IMemoryObservation = { probe: undefined, generation: 0 }
  /** B-side receive observation reads its own state at physical delivery time. */
  const observationB: IMemoryObservation = { probe: undefined, generation: 0 }
  /** Terminal admission prevents sends and subscriptions from reviving this retired carrier. */
  let closed = false
  /** Each physical side retains its own transport retirement observers. */
  const errorsA = new Set<(error: unknown) => void>(),
    errorsB = new Set<(error: unknown) => void>()
  /** Each side independently owns diagnostic listeners for failed delivery or observation. */
  const listenerErrorsA = new Set<(error: unknown) => void>(),
    listenerErrorsB = new Set<(error: unknown) => void>()
  /** Both sides retain their original independent failure drains until pair close. */
  const secondaryFailuresA = createListenerFailureState(),
    secondaryFailuresB = createListenerFailureState()
  /** The first side to close owns pair retirement and guards reentrant close calls. */
  let closeStarted = false
  /** Repeated close returns the same first cleanup result, including its Promise identity. */
  const closeResult = undefined as void | Promise<void>

  return {
    scheduler,
    listenersA,
    listenersB,
    observationA,
    observationB,
    closed,
    errorsA,
    errorsB,
    listenerErrorsA,
    listenerErrorsB,
    secondaryFailuresA,
    secondaryFailuresB,
    closeStarted,
    closeResult
  }
}

/** Each side carries only its own and the opposite side's original listener/probe references. */
type IMemorySideContext = {
  outgoing: IMessageListenerHub<{ data: unknown }>
  incoming: IMessageListenerHub<{ data: unknown }>
  errors: Set<(error: unknown) => void>
  listenerErrors: Set<(error: unknown) => void>
  remoteListenerErrors: Set<(error: unknown) => void>
  secondaryFailures: ReturnType<typeof createListenerFailureState>
  remoteSecondaryFailures: ReturnType<typeof createListenerFailureState>
  observation: IMemoryObservation
  remoteObservation: IMemoryObservation
}

/** One side borrows the pair lifecycle while owning its native-equivalent dispatch projection. */
class MemoryTransportSide {
  /** Both original sides share one terminal state and the same first cleanup result. */
  #pair: ReturnType<typeof memoryTransportState>
  /** Directional references preserve receiver-specific observation and failure routing. */
  #side: IMemorySideContext
  /** Own enumerable callbacks and the closed getter retain the original transport shape. */
  readonly value: IMemoryTransport
  /** Publish one side only after the complete pair and both listener hubs exist. */
  constructor(pair: ReturnType<typeof memoryTransportState>, side: IMemorySideContext) {
    this.#pair = pair
    this.#side = side
    this.value = {
      platform: RpcPlatform.memory,
      topology: 'exclusive',
      ownership: RpcTransportOwnership.borrowed,
      observe: this.#observe,
      send: this.#send,
      subscribe: this.#subscribe,
      close: this.#close,
      closed: false,
      onTransportError: this.#onTransportError,
      onListenerError: this.#onListenerError
    }
    Object.defineProperty(this.value, 'closed', {
      configurable: true,
      enumerable: true,
      get: () => this.#pair.closed
    })
  }
  /** Replace only this physical side observation generation. */
  #observe: IMemoryTransport['observe'] = (next) => {
    /** Reinstalling the same probe still creates a distinct disposer generation. */
    const generation = ++this.#side.observation.generation
    if (!this.#pair.closed) this.#side.observation.probe = next
    return () => {
      if (generation === this.#side.observation.generation) this.#side.observation.probe = undefined
    }
  }

  /** Observe the original sender and queue one native-equivalent delivery job. */
  #send: IMemoryTransport['send'] = (message) => {
    if (this.#pair.closed) throw createRpcTransportError(MemoryTransportText.closed)
    if (this.#side.observation.probe !== undefined) {
      /** One event retains its installed handle across reentrant observation replacement. */
      const currentProbe = this.#side.observation.probe
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
          this.#side.listenerErrors,
          this.#side.secondaryFailures
        )
      }
    }
    deferTask(this.#pair.scheduler, () => {
      // Closed between send() and delivery — the other side is gone,
      // there is nobody left to deliver to.
      if (this.#pair.closed) return
      if (this.#side.remoteObservation.probe !== undefined) {
        /** Physical delivery reads the receiver's currently installed generation once. */
        const receivingProbe = this.#side.remoteObservation.probe
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
            this.#side.remoteListenerErrors,
            this.#side.remoteSecondaryFailures
          )
        }
      }
      this.#side.outgoing.dispatch({ data: message }, (listener, messageValue) => {
        observeListener(
          () => listener(messageValue),
          (error) =>
            reportListenerFailure(
              error,
              this.#side.remoteListenerErrors,
              this.#side.remoteSecondaryFailures
            ),
          this.#side.remoteSecondaryFailures
        )
      })
    })
  }

  /** Share one logical listener hub and retain the original cleanup failure drain. */
  #subscribe: IMemoryTransport['subscribe'] = (listener) => {
    this.#side.incoming.add(listener, () => undefined)
    return () => {
      const deleted = this.#side.incoming.remove(listener, () => undefined)
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#side.secondaryFailures
      })
      return deleted
    }
  }

  /** Retire the whole pair once and preserve the exact first cleanup result. */
  #close: IMemoryTransport['close'] = () => {
    if (this.#pair.closeStarted) return this.#pair.closeResult
    this.#pair.closeStarted = true
    this.#pair.closed = true
    this.#pair.observationA.probe = undefined
    this.#pair.observationB.probe = undefined
    reportListenerFailure(
      tagRpcError(new Error(MemoryTransportText.closed), RpcCoreErrorCode.transport),
      this.#pair.errorsA,
      this.#pair.secondaryFailuresA
    )
    reportListenerFailure(
      tagRpcError(new Error(MemoryTransportText.closed), RpcCoreErrorCode.transport),
      this.#pair.errorsB,
      this.#pair.secondaryFailuresB
    )
    this.#pair.listenersA.clear(() => undefined)
    this.#pair.listenersB.clear(() => undefined)
    this.#pair.closeResult = drainTerminalListenerFailures([], {
      code: RpcCoreErrorCode.transport,
      secondaryFailures: [this.#pair.secondaryFailuresA, this.#pair.secondaryFailuresB]
    })
    return this.#pair.closeResult
  }

  /** Register this side physical retirement observer. */
  #onTransportError: IMemoryTransport['onTransportError'] = (listener) => {
    this.#side.errors.add(listener)
    return () => {
      const deleted = this.#side.errors.delete(listener)
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#side.secondaryFailures
      })
      return deleted
    }
  }

  /** Register this side listener failure observer. */
  #onListenerError: IMemoryTransport['onListenerError'] = (listener) => {
    this.#side.listenerErrors.add(listener)
    return () => {
      const deleted = this.#side.listenerErrors.delete(listener)
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#side.secondaryFailures
      })
      return deleted
    }
  }
}

/** Create both reference-delivery sides with one explicit shared lifecycle context. */
export function createMemoryTransportPair(
  options: IMemoryTransportOptions = {}
): readonly [IMemoryTransport, IMemoryTransport] {
  /** The pair context is shared explicitly rather than captured by two factory-generated closures. */
  const state = memoryTransportState(options)
  return [
    new MemoryTransportSide(state, {
      outgoing: state.listenersB,
      incoming: state.listenersA,
      errors: state.errorsA,
      listenerErrors: state.listenerErrorsA,
      remoteListenerErrors: state.listenerErrorsB,
      secondaryFailures: state.secondaryFailuresA,
      remoteSecondaryFailures: state.secondaryFailuresB,
      observation: state.observationA,
      remoteObservation: state.observationB
    }).value,
    new MemoryTransportSide(state, {
      outgoing: state.listenersA,
      incoming: state.listenersB,
      errors: state.errorsB,
      listenerErrors: state.listenerErrorsB,
      remoteListenerErrors: state.listenerErrorsA,
      secondaryFailures: state.secondaryFailuresB,
      remoteSecondaryFailures: state.secondaryFailuresA,
      observation: state.observationB,
      remoteObservation: state.observationA
    }).value
  ]
}
