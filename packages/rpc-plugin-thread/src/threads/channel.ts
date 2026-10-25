/**
 * Adapts native EventEmitter/EventTarget messaging and raw observations to the SDK message carrier.
 * Worker resources remain source-owned, while the SDK owns capture and codec execution.
 */
import {
  createRpcMessageCarrier,
  createRpcBackingDigest,
  RpcCarrierObservation,
  type IRpcMessageIO
} from '@migaia/rpc-host/sdk'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection,
  type IRpcCarrier,
  type IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import {
  RpcError,
  RpcCoreErrorText,
  RpcTransportError,
  safeString,
  tagRpcError
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { ThreadErrorText } from './error-text.js'
import type { IThreadNodePort } from './runtime-types.js'
import type { IThreadWebPort } from './types.js'
import { ThreadEvent } from './constants.js'

/** Both original native postMessage surfaces expose one direct, whole-message port. */
const threadCarrierFacts = Object.freeze({
  platform: RpcCarrierPlatform.messagePort,
  topology: RpcCarrierTopology.exclusive,
  encodedType: RpcCarrierEncoding.any
})

/** The factory supplies its actual native subscription form; this is not runtime detection. */
type IThreadNativeBinding = Readonly<
  | { node: true; port: IThreadNodePort; closeEvent: string }
  | { node: false; port: IThreadWebPort; closeEvent: string }
>

/** One borrowed native IO owner preserves exact listeners, raw values and transfer handoff. */
class ThreadNativeIO implements IRpcMessageIO {
  /** Actual EventEmitter or EventTarget operations remain on their original native receiver. */
  readonly #binding: IThreadNativeBinding
  /** One observer belongs to this acquired physical connection and is lent to its carrier. */
  readonly observation: RpcCarrierObservation

  /** Native diagnostic events use the same owner report boundary without terminating the source. */
  readonly #report: (error: unknown) => void
  /** This exact native messageerror subscription is removed with the original IO owner. */
  #removeMessageError: (() => void) | undefined

  /**
   * Acquire one native diagnostic listener; SDK subsequently acquires the message and close
   * readers.
   */
  constructor(binding: IThreadNativeBinding, report: (error: unknown) => void) {
    this.#binding = binding
    this.#report = report
    this.observation = new RpcCarrierObservation(threadCarrierFacts, (cause) =>
      report(new RpcTransportError(ThreadErrorText.probeFailed, cause))
    )
    this.#removeMessageError = this.#subscribe(ThreadEvent.messageerror, this.#messageError)
  }

  /** Observe only immediately before the actual original postMessage and exact transfer list. */
  readonly send = (
    value: unknown,
    transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void => {
    options?.onWriteStart?.()
    this.#observe(RpcProbeDirection.outbound, value, transfer)
    this.#binding.port.postMessage(value, transfer)
  }

  /** Read Web event data once, while Node values pass through unchanged to the original codec. */
  readonly onMessage = (listener: (value: unknown) => void): (() => void) => {
    /** Only this exact wrapper is removed when its original carrier retires. */
    const receive = (value: unknown): void => {
      /** Both observation and the codec borrow the same actual native value. */
      const message = this.#binding.node ? value : (value as { data: unknown }).data
      this.#observe(RpcProbeDirection.inbound, message)
      listener(message)
    }
    return this.#subscribe(ThreadEvent.message, receive)
  }

  /** Node Worker exit and borrowed parent-port close retain their original event selection. */
  readonly onClose = (listener: (reason?: unknown) => void): (() => void) =>
    this.#subscribe(this.#binding.closeEvent, listener)

  /**
   * Report one native deserialization diagnostic; conversion failures remain independently
   * reachable.
   */
  readonly #messageError = (value: unknown): void => {
    if (!this.#binding.node) {
      this.#report(threadTransportError(ThreadErrorText.browserMessagePortDeserializeFailed))
      return
    }
    /**
     * The original native value is converted once, with conversion failure reported before the
     * event.
     */
    const detail =
      value === undefined
        ? ''
        : `: ${safeString(value, undefined, ({ error }) => {
            this.#report(
              new RpcTransportError(ThreadErrorText.messagePortDeserializeFailed(''), error)
            )
            return undefined
          })}`
    this.#report(threadTransportError(ThreadErrorText.messagePortDeserializeFailed(detail)))
  }

  /** Remove only the same callback from the same actual native subscription API. */
  #subscribe(event: string, listener: (value: unknown) => void): () => void {
    if (this.#binding.node) {
      /** One immutable operation keeps the original remover's facts together. */
      const entry = { port: this.#binding.port, event, listener }
      entry.port.on(entry.event, entry.listener)
      return () => {
        entry.port.off(entry.event, entry.listener)
      }
    }
    /** Web ports borrow their EventTarget callbacks without changing close-event semantics. */
    const entry = { port: this.#binding.port, event, listener }
    entry.port.addEventListener(entry.event, entry.listener)
    return () => entry.port.removeEventListener(entry.event, entry.listener)
  }

  /** Keep original native transfer detail; inbound -1 means the native event hides that list. */
  #observe(direction: RpcProbeDirection, value: unknown, transfer?: readonly ArrayBuffer[]): void {
    if (!this.observation.active) return
    this.observation.emit(direction, value, transfer, {
      transfers: direction === RpcProbeDirection.inbound ? -1 : (transfer?.length ?? 0)
    })
  }

  /** Native execution and borrowed-port disposal remain with their original acquisition owner. */
  close(): void {
    /** Clear custody before invoking a native remover that could reenter disposal. */
    const remove = this.#removeMessageError
    this.#removeMessageError = undefined
    remove?.()
  }
}

/** Native diagnostic tagging preserves the original plain Error family and stable Thread text. */
export function threadTransportError(message: string, cause?: unknown): Error {
  return tagRpcError(
    new Error(message, cause === undefined ? undefined : { cause }),
    RpcCoreErrorCode.transport
  )
}

/** Node and Web acquisitions share exactly one SDK carrier and observation construction path. */
function createThreadCarrier(
  binding: IThreadNativeBinding,
  id: string,
  report: (error: unknown) => void
): IRpcCarrier {
  /** This one native IO instance owns every actual subscription callback for the connection. */
  const io = new ThreadNativeIO(binding, report)
  return createRpcMessageCarrier({
    id,
    closingWrites: true,
    report,
    nativeBinary: true,
    defaultCloseError: () => threadTransportError(ThreadErrorText.messagePortClosed),
    assertTransfer: (signed) => {
      if (!signed)
        throw new RpcError(
          RpcCoreErrorCode.capabilityUnsupported,
          RpcCoreErrorText.capabilityUnsupported
        )
    },
    observation: io.observation,
    digest: createRpcBackingDigest(),
    io
  })
}

/** Borrow the native EventEmitter port; cleanup removes only this carrier's exact listeners. */
export function createNodeThreadCarrier(
  port: IThreadNodePort,
  id: string,
  report: (error: unknown) => void,
  closeEvent: string = ThreadEvent.close
): IRpcCarrier {
  return createThreadCarrier({ node: true, port, closeEvent }, id, report)
}

/** Unwrap only native events, preserving original transfer lists and borrowed-port ownership. */
export function createWebThreadCarrier(
  port: IThreadWebPort,
  id: string,
  report: (error: unknown) => void
): IRpcCarrier {
  return createThreadCarrier({ node: false, port, closeEvent: ThreadEvent.close }, id, report)
}
