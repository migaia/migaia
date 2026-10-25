/**
 * Adapts native browser message events to SDK IO callbacks without duplicating codec or Session
 * state.
 */
import { BrowserPeerEvent } from './peer-text.js'
import {
  createRpcMessageCarrier,
  createRpcBackingDigest,
  defaultRpcId,
  RpcCarrierObservation
} from '@migaia/rpc-host/sdk'
import type { IRpcMessageIO, IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import {
  RpcCarrierEncoding,
  RpcCarrierTopology,
  RpcProbeDirection,
  type IRpcCarrier,
  type IRpcCarrierWriteOptions,
  type IRpcCarrierObservationFacts
} from '@migaia/rpc-contract/interfaces'
import { BrowserRpcErrorText } from './error-text.js'
import { createBrowserTransportError, normalizeBrowserHandshakeFailure } from './error.js'
import {
  emitBrowserObservation,
  rejectBrowserObservation,
  type IBrowserObservationMetadata
} from './native-observation.js'

/** Browser acquisition uses native EventTarget operations; SDK owns subscriptions and retirement. */
export type IBrowserEventPort = Readonly<{
  /** Native Transferable overloads stay assignable; RPC forwards its original ArrayBuffer list. */
  postMessage(value: unknown, transfer?: readonly Transferable[]): void
  start?(): void
  /** Native EventTarget overloads deliver distinct message and error event types. */
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}>
/** Source filtering runs on the original native event before its data enters the shared codec. */
export type IBrowserMessageSource = Readonly<{
  receiver: Pick<IBrowserEventPort, 'addEventListener' | 'removeEventListener'>
  send(value: unknown, transfer?: readonly ArrayBuffer[], options?: IRpcCarrierWriteOptions): void
  accept?(event: MessageEvent<unknown>): boolean
  /** A fixed native Window destination is already admitted; unknown origins require no getter. */
  origin?: string
  start?(): void
  messageError?: string
  /** Worker script failures retain their original native event mapping at their concrete source. */
  onError?(listener: (error: unknown) => void): () => void
  /** Dedicated Worker reflection errors preserve their existing diagnostic text and cause. */
  readError?(cause: unknown): unknown
}>

/** One native message boundary unwraps events; it owns no codec, queue, Session or provider state. */
class BrowserMessageIO implements IRpcMessageIO {
  /** This exact native source lends its cold facts and original raw values to the carrier. */
  readonly observation: RpcCarrierObservation
  /** Original browser metadata stays with this actual IO, outside SDK subscription ownership. */
  readonly #metadata: IBrowserObservationMetadata = { rejectedSource: 0 }
  /** Original native source facts stay with this acquisition. */
  readonly #source: IBrowserMessageSource
  /** SDK installs its one physical error callback before any normal asynchronous native delivery. */
  #error: ((error: unknown) => void) | undefined
  /** Read failures before the error callback is admitted use the same installation report port. */
  readonly #report: (error: unknown) => void

  /** Capture native operations without taking ownership of the caller's Worker, Window or port. */
  constructor(
    source: IBrowserMessageSource,
    report: (error: unknown) => void,
    facts: IRpcCarrierObservationFacts
  ) {
    this.#source = source
    this.#report = report
    this.observation = new RpcCarrierObservation(facts, (cause) =>
      report(createBrowserTransportError(BrowserRpcErrorText.carrierObservationFailed, cause))
    )
  }
  /** Handoff metadata remains local and is invoked immediately before the actual native send. */
  readonly send = (
    value: unknown,
    transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void => {
    options?.onWriteStart?.()
    emitBrowserObservation(
      this.observation,
      this.#metadata,
      RpcProbeDirection.outbound,
      value,
      transfer,
      this.#source.origin
    )
    this.#source.send(value, transfer, options)
  }
  /** The exact wrapper is removed by the SDK's existing reverse listener cleanup. */
  onMessage(listener: (value: unknown) => void): () => void {
    /** Native source and payload getters are evaluated once, in the original source-first order. */
    const receive = (event: MessageEvent<unknown>): void => {
      /** Native reflection completes before the receiver callback can execute arbitrary code. */
      let data: unknown
      try {
        if (this.#source.accept && !this.#source.accept(event)) {
          rejectBrowserObservation(this.observation, this.#metadata)
          return
        }
        data = event.data
      } catch (cause) {
        this.#failure(
          this.#source.readError
            ? this.#source.readError(cause)
            : createBrowserTransportError(BrowserRpcErrorText.carrierOperationFailed, cause)
        )
        return
      }
      try {
        emitBrowserObservation(
          this.observation,
          this.#metadata,
          RpcProbeDirection.inbound,
          data,
          undefined,
          this.#source.origin
        )
        listener(data)
      } catch (failure) {
        this.#report(failure)
      }
    }
    this.#source.start?.()
    this.#source.receiver.addEventListener(BrowserPeerEvent.message, receive)
    return () => this.#source.receiver.removeEventListener(BrowserPeerEvent.message, receive)
  }
  /** These borrowed browser sources have no native peer-close signal; Host close remains explicit. */
  onClose(): () => void {
    return () => undefined
  }
  /** Native messageerror is a physical failure; it never becomes a fabricated remote close event. */
  onError(listener: (error: unknown) => void): () => void {
    this.#error = listener
    if (this.#source.onError) return this.#source.onError(listener)
    if (this.#source.messageError === undefined)
      return () => {
        if (this.#error === listener) this.#error = undefined
      }
    /** The established browser diagnostic retains its original source/code family. */
    const failure = (): void =>
      this.#failure(
        createBrowserTransportError(
          this.#source.messageError ?? BrowserRpcErrorText.carrierOperationFailed
        )
      )
    this.#source.receiver.addEventListener(BrowserPeerEvent.messageError, failure)
    return () => {
      if (this.#error === listener) this.#error = undefined
      this.#source.receiver.removeEventListener(BrowserPeerEvent.messageError, failure)
    }
  }
  /** Logical retirement removes native listeners through SDK; borrowed native objects stay open. */
  close(): void {}
  /** Native event reflection failures reach the existing SDK callback or installation reporter. */
  #failure(error: unknown): void {
    if (this.#error) this.#error(error)
    else this.#report(error)
  }
}

/** Each exclusive native source borrows one real codec/carrier, never an adapter or Peer facade. */
export function browserMessageCarrier(
  source: IBrowserMessageSource,
  context: Pick<IRpcTransportSetupContext, 'report'>,
  platform: IRpcCarrierObservationFacts['platform'],
  topology: IRpcCarrierObservationFacts['topology'] = RpcCarrierTopology.exclusive
): IRpcCarrier {
  /** The same native owner supplies one capability; SDK performs no second raw emission. */
  const io = new BrowserMessageIO(source, context.report, {
    platform,
    topology,
    encodedType: RpcCarrierEncoding.any
  })
  return createRpcMessageCarrier({
    id: defaultRpcId(),
    nativeBinary: true,
    digest: createRpcBackingDigest(),
    report: context.report,
    io,
    observation: io.observation
  })
}

/** Host Session owns readiness; acquisition rollback closes the exact failed carrier once. */
export async function attachBrowserCarrier(
  carrier: IRpcCarrier,
  context: IRpcTransportSetupContext,
  projectFailure: (error: unknown) => unknown = normalizeBrowserHandshakeFailure
) {
  try {
    /** This exact handle remains the sole connection lifecycle authority. */
    const handle = context.attach(carrier)
    await handle.ready
    return { dispose: () => context.detach(handle) }
  } catch (primary) {
    try {
      await carrier.close(primary)
    } catch (cleanup) {
      context.report(cleanup)
    }
    throw projectFailure(primary)
  }
}
