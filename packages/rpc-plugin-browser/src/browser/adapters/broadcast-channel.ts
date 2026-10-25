/** Lends one native BroadcastChannel participant route to the SDK message carrier callbacks. */
import { RpcCarrierObservation, type IRpcMessageIO } from '@migaia/rpc-host/sdk'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection,
  type IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { emitBrowserObservation, type IBrowserObservationMetadata } from '../native-observation.js'

/** A native participant route owns only SDK's exact IO callbacks, not a second peer/session table. */
export class BroadcastRouteIO implements IRpcMessageIO {
  /** This native selected route lends the real BroadcastChannel shell without copying it. */
  readonly observation: RpcCarrierObservation
  /** Real selected-route metadata shares the same detail across native sends and receives. */
  readonly #metadata: IBrowserObservationMetadata = { rejectedSource: 0 }
  /** All outgoing frames pass the actual native channel owner's existing route selector. */
  readonly #send: (value: unknown, options?: IRpcCarrierWriteOptions) => void
  /** Native route retirement releases this exact record without following successor membership. */
  readonly #release: () => void
  /** SDK's single frame callback receives original selected native payloads. */
  #message: ((value: unknown) => void) | undefined
  /** SDK's physical close callback retires its own original Session. */
  #closed: ((reason?: unknown) => void) | undefined
  /** SDK's physical failure callback contains native deserialization errors. */
  #error: ((error: unknown) => void) | undefined
  /** Retain original native dispatch without borrowing another codec or listener registry. */
  constructor(
    send: (value: unknown, options?: IRpcCarrierWriteOptions) => void,
    release: () => void,
    report: (error: unknown) => void
  ) {
    this.#send = send
    this.#release = release
    this.observation = new RpcCarrierObservation(
      {
        platform: RpcCarrierPlatform.broadcastChannel,
        topology: RpcCarrierTopology.broadcast,
        encodedType: RpcCarrierEncoding.any
      },
      report
    )
  }
  /** Native handoff occurs in the channel owner, after its route has been selected. */
  send(
    value: unknown,
    _transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void {
    this.#send(value, options)
  }
  /** These one-owner slots are installed and removed by the shared SDK carrier. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#message = listener
    return () => {
      if (this.#message === listener) this.#message = undefined
    }
  }
  /** Native explicit leave is the only participant departure signal supplied by BroadcastChannel. */
  onClose(listener: (reason?: unknown) => void): () => void {
    this.#closed = listener
    return () => {
      if (this.#closed === listener) this.#closed = undefined
    }
  }
  /** Native messageerror stays distinct from application callback failure. */
  onError(listener: (error: unknown) => void): () => void {
    this.#error = listener
    return () => {
      if (this.#error === listener) this.#error = undefined
    }
  }
  /** SDK owns route retirement; the borrowed physical channel is never closed. */
  close(): void {
    this.#release()
  }
  /** The native channel owner has already selected this exact participant route. */
  receive(value: unknown, raw: unknown): void {
    emitBrowserObservation(this.observation, this.#metadata, RpcProbeDirection.inbound, raw)
    this.#message?.(value)
  }
  /** The actual channel owner supplies its one original native shell immediately before post. */
  observeSend(raw: unknown): void {
    emitBrowserObservation(this.observation, this.#metadata, RpcProbeDirection.outbound, raw)
  }
  /** Genuine native explicit leave retires pending work through SDK. */
  leave(): void {
    this.#closed?.()
  }
  /** One native deserialization event reports the original error to each current actual route. */
  fail(error: unknown): void {
    this.#error?.(error)
  }
}
