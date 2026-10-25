/** A test-only real carrier exercises public host and Session lifecycles through the same medium. */
import { deferred, raceWithAbort, type IDeferred } from '@migaia/utils/promise'
import type {
  IRpcCarrier,
  IRpcCarrierCodec,
  IRpcCarrierFrame,
  IRpcCarrierReceiver,
  IRpcCarrierWriteOptions,
  IRpcCodecContext,
  IRpcPreparedMessage
} from '@migaia/rpc-contract/interfaces'
import { normalizeRpcFrame, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcCarrierCodecId } from '../../dist/sdk/carrier/constants.js'
import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'
import { defaultRpcReporter } from '@migaia/rpc-host'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection
} from '@migaia/rpc-contract/interfaces'

/** Actual physical handoff and four codec stages remain observable through the carrier contract. */
export class MemoryCarrier implements IRpcCarrier {
  /**
   * This original reference medium reports only actual write and delivery, without a second
   * carrier.
   */
  readonly observation = new RpcCarrierObservation(
    {
      platform: RpcCarrierPlatform.memory,
      topology: RpcCarrierTopology.exclusive,
      encodedType: RpcCarrierEncoding.any
    },
    defaultRpcReporter
  )
  /** Each endpoint has one genuine native receiver subscription. */
  #receiver: IRpcCarrierReceiver | undefined
  /** The linked physical endpoint receives frames only when write is actually accepted. */
  #peer: MemoryCarrier | undefined
  /** An explicit fixture gate models a native accepting write that has not completed. */
  #acceptGate: IDeferred<void> | undefined
  /** A business-write gate borrows this carrier's real close controller for close/drain oracles. */
  #writeGate: IDeferred<void> | undefined
  /** A close owns one completion, including reentrant native close notifications. */
  #closed: Promise<void> | undefined
  /** The same close reason cancels a held native accepting write. */
  readonly #controller = new AbortController()
  /** Writes and codec stages are inspected directly, without a host business facade. */
  readonly trace: string[] = []
  /** The default identity codec's semantic writes remain available to bounded fixture assertions. */
  readonly written: IRpcSemanticFrame[] = []
  /** A silent remote control exercises health expiry without synthesizing pong. */
  silentPing = false
  /** Native subscription receipt is invoked once by the Session. */
  unsubscribed = 0
  /** Original backings remain available on this in-memory physical medium. */
  readonly nativeBinary: boolean
  /** An explicit fixture opt-in exercises the same bounded Session close path as native media. */
  readonly closingWrites: true | undefined
  /** Physical local identity is independent of semantic peer names. */
  readonly id: string
  /** These actual ordered proposals participate in the common negotiation. */
  readonly codecs: readonly string[]
  /** Four separate stages use the canonical semantic validator at restore. */
  readonly codec: IRpcCarrierCodec = {
    prepare: (message, context) => this.#prepare(message, context),
    encode: (message, context) => this.#encode(message, context),
    decode: (frame, context) => this.#decode(frame, context),
    restore: (message, context) => this.#restore(message, context)
  }

  /** Media preferences are real inputs to the sole handshake negotiation. */
  constructor(
    id: string,
    codecs: readonly string[] = [RpcCarrierCodecId],
    codec?: IRpcCarrierCodec,
    nativeBinary = true,
    closingWrites?: true
  ) {
    this.id = id
    this.codecs = codecs
    this.nativeBinary = nativeBinary
    this.closingWrites = closingWrites
    if (codec) this.codec = codec
  }

  /** Link actual endpoints before either Session starts. */
  link(peer: MemoryCarrier): void {
    this.#peer = peer
  }

  /** Hold the native accept before delivery; readiness must remain unpublished. */
  holdAccept(): void {
    this.#acceptGate = deferred<void>()
  }

  /** Finish the held accepting write without fabricating host readiness. */
  releaseAccept(): void {
    this.#acceptGate?.resolve()
  }

  /** Hold actual physical writes without changing the Session or adding another pending owner. */
  holdWrites(): void {
    this.#writeGate = deferred<void>()
  }

  /** Release the existing physical boundary; carrier.close also cancels this same wait. */
  releaseWrites(): void {
    this.#writeGate?.resolve()
    this.#writeGate = undefined
  }

  /** Install one receiver and return its exact native cleanup receipt. */
  subscribe(receiver: IRpcCarrierReceiver): () => void {
    this.#receiver = receiver
    return () => {
      this.unsubscribed++
      this.#receiver = undefined
    }
  }

  /** This original in-memory native medium supports handing original backing buffers onward. */
  assertTransfer(): void {}

  /** Deliver only after a native gate and caller cancellation admit the actual write. */
  readonly write = async (
    frame: IRpcCarrierFrame,
    options?: IRpcCarrierWriteOptions
  ): Promise<void> => {
    /** A real borrowed JSON codec emits opaque text; only identity-codec traffic is inspectable. */
    const message = typeof frame.data === 'string' ? undefined : (frame.data as IRpcSemanticFrame)
    if (message?.kind === 'handshake' && message.step === 'accept' && this.#acceptGate)
      await raceWithAbort(() => this.#acceptGate!.promise, {
        signals: options?.signal
          ? [options.signal, this.#controller.signal]
          : [this.#controller.signal]
      })
    /** This original carrier owns both the native wait and its actual physical-close rejection. */
    const gate = this.#writeGate
    if (gate)
      await raceWithAbort(() => gate.promise, {
        signals: options?.signal
          ? [options.signal, this.#controller.signal]
          : [this.#controller.signal]
      })
    if (this.#controller.signal.aborted) throw this.#controller.signal.reason
    options?.onWriteStart?.()
    this.observation.emit(RpcProbeDirection.outbound, frame, options?.transfer)
    this.trace.push(`write:${message?.kind ?? frame.kind}`)
    if (message) this.written.push(message)
    if (this.silentPing && message?.kind === 'control' && message.operation === 'ping') return
    /** The opposite endpoint owns delivery to its actual current receiver. */
    const peer = this.#peer
    if (peer && peer.#receiver) {
      peer.observation.emit(RpcProbeDirection.inbound, frame)
      peer.#receiver.frame(frame)
    }
  }

  /** Observe the real physical close receipt without synthesizing a Session status. */
  get closed(): boolean {
    return this.#closed !== undefined
  }

  /** Physical close settles queued writes and emits one remote EOF. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (this.#closed) return this.#closed
    this.#closed = Promise.resolve()
    this.#controller.abort(reason)
    /** Native EOF reaches the opposite installed receiver exactly once. */
    const peer = this.#peer
    if (peer) peer.#receiver?.close(reason)
    return this.#closed
  }

  /** Record binary capture before any envelope hook. */
  #prepare(message: IRpcSemanticFrame, context: IRpcCodecContext): IRpcPreparedMessage {
    this.trace.push(`prepare:${context.codec}`)
    return { message, sidecars: context.transfer ?? [] }
  }

  /** Encode the same prepared metadata and original sidecars. */
  #encode(message: IRpcPreparedMessage, context: IRpcCodecContext): IRpcCarrierFrame {
    this.trace.push(`encode:${context.codec}`)
    return { kind: 'message', data: message.message, sidecars: message.sidecars }
  }

  /** Decode exposes protected metadata before restoration. */
  #decode(frame: IRpcCarrierFrame, context: IRpcCodecContext): IRpcPreparedMessage {
    this.trace.push(`decode:${context.codec}`)
    return { message: frame.data as IRpcSemanticFrame, sidecars: frame.sidecars ?? [] }
  }

  /** The carrier invokes the one pure grammar before returning semantic traffic. */
  #restore(message: IRpcPreparedMessage, context: IRpcCodecContext): IRpcSemanticFrame {
    this.trace.push(`restore:${context.codec}`)
    return normalizeRpcFrame(message.message)
  }
}
