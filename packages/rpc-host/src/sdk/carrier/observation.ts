/**
 * Owns the native carrier's exact observation subscription and readonly Session stage projections.
 * Actual IO emits borrowed raw content only when subscribed; Session supplies admitted identity
 * without lending execution authority. Callback failures remain outside business settlement, with
 * no extra native listener, content queue or lifecycle owner.
 */
import {
  RpcProbeStage as S,
  RpcProbeKind,
  RpcProbeObservationKind,
  type IRpcCarrierObservation,
  type IRpcCarrierObservationFacts,
  type IRpcCarrierObservationEvent,
  type IRpcCarrierFrame,
  type IRpcDispose,
  type IRpcObservation,
  type IRpcProbeDescriptor,
  type IRpcProbeObservation,
  type RpcProbeDirection
} from '@migaia/rpc-contract/interfaces'
import { RpcWireKind as K, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { carrierSizeBytes } from '../wire/probe-content.ts'

/** One exact native subscription owns its callback without a queue or event retention. */
type IObservationSubscription = Readonly<{
  listener(event: IRpcCarrierObservationEvent): void
}>

/** Native IO borrows the original single-observer algorithm; only ProbeEmitter captures content. */
export class RpcCarrierObservation implements IRpcCarrierObservation {
  /** Cold acquired medium facts never come from decoded traffic or a guessed host platform. */
  readonly facts: IRpcCarrierObservationFacts
  /** Replacing a subscriber invalidates its exact previous remover by record identity. */
  #subscription: IObservationSubscription | undefined
  /** Observer failures remain outside native business write and receive settlement. */
  readonly #report: (error: unknown) => void

  /** Capture only immutable native metadata and the original native owner's report port. */
  constructor(facts: IRpcCarrierObservationFacts, report: (error: unknown) => void) {
    this.facts = Object.freeze({ ...facts })
    this.#report = report
  }

  /** Native metadata owners borrow current subscription presence without a second observer state. */
  get active(): boolean {
    return this.#subscription !== undefined
  }

  /** No second native listener is installed; this record borrows the actual IO callbacks. */
  subscribe(listener: (event: IRpcCarrierObservationEvent) => void): IRpcDispose {
    /** Exact record identity prevents an obsolete remover from clearing its successor. */
    const subscription = { listener }
    this.#subscription = subscription
    return () => {
      if (this.#subscription === subscription) this.#subscription = undefined
    }
  }

  /** Publish borrowed native content before handoff; unsubscribed IO performs no capture or sizing. */
  emit(
    direction: RpcProbeDirection,
    content: unknown,
    transfer?: readonly ArrayBuffer[],
    detail?: IRpcCarrierObservationEvent['detail']
  ): void {
    /** A callback can replace itself; this emission retains its one original subscription. */
    const subscription = this.#subscription
    if (!subscription) return
    try {
      subscription.listener({
        direction,
        content,
        transfer,
        detail,
        sizeBytes: carrierSizeBytes(content)
      })
    } catch (error) {
      this.#report(error)
    }
  }
}

/** Session lends readonly identity and lazy acquired facts, never media or lifecycle authority. */
type ISessionObservationSource = Readonly<{
  namespace: string
  carrierId: string
  view(): Readonly<{ peerId: string }> | undefined
  mediaFacts(): IRpcCarrierObservationFacts | undefined
  descriptorFacts(): Pick<IRpcProbeDescriptor, 'endpointId'> &
    Partial<Pick<IRpcProbeDescriptor, 'authentication'>>
  emit?: (event: IRpcObservation) => void
}>

/**
 * Project admitted Session stages through the same carrier observation owner without retaining
 * content.
 */
export class RpcSessionObservation {
  /** The original Session owns current acceptance and cleanup; these ports expose observations only. */
  readonly #source: ISessionObservationSource

  /** Retain explicit readonly collaborators without adding subscriptions or resources. */
  constructor(source: ISessionObservationSource) {
    this.#source = source
  }

  /** Describe only acquired media and selected flow facts at the original successful publication. */
  describe(): void {
    if (!this.#source.emit) return
    /** Absent acquired metadata must not cause guessed platform facts or eager descriptor reads. */
    const facts = this.#source.mediaFacts()
    if (!facts) return
    this.#source.emit?.({
      kind: RpcProbeObservationKind.descriptor,
      namespace: this.#source.namespace,
      carrierId: this.#source.carrierId,
      peerId: this.#source.view()?.peerId,
      data: Object.freeze({
        ...facts,
        ...this.#source.descriptorFacts(),
        namespace: this.#source.namespace,
        carrierId: this.#source.carrierId,
        carrier: facts.platform,
        // These seven original stages exclude protected, whose fixed ordinal is five.
        stageMask:
          (1 << S.peer) |
          (1 << S.message) |
          (1 << S.envelope) |
          (1 << S.encoded) |
          (1 << S.frame) |
          (1 << S.carrier) |
          (1 << S.forward)
      })
    })
  }

  /** Borrow stage data unchanged; observers receive no execution or frame-replacement port. */
  event(data: IRpcProbeObservation): void {
    this.#source.emit?.({
      kind: RpcProbeObservationKind.event,
      namespace: this.#source.namespace,
      carrierId: this.#source.carrierId,
      peerId: this.#source.view()?.peerId,
      id: data.messageId,
      data
    })
  }

  /** Only the actual Session calls this projection at its original connection transitions. */
  lifecycle(lifecycle: string, error?: unknown): void {
    this.event({
      stage: S.peer,
      kind: RpcProbeKind.lifecycle,
      peerId: this.#source.view()?.peerId,
      lifecycle,
      error
    })
  }

  /** Preserve the native event's supplied size, detail and transfer while hiding bootstrap content. */
  carrier(event: IRpcCarrierObservationEvent): void {
    this.event({
      ...event,
      content: this.#source.view() ? event.content : undefined,
      stage: S.carrier,
      carrier: this.#source.mediaFacts()!.platform
    })
  }

  /**
   * Project opaque media and only already-admitted semantic headers, preserving original
   * references.
   */
  media(
    stage: number,
    direction: number,
    content: unknown,
    message?: IRpcSemanticFrame,
    transfer?: readonly ArrayBuffer[]
  ): void {
    /** Handshake metadata carries no admitted task route or identity. */
    const routed = message && message.kind !== K.handshake ? message : undefined
    /** Only the existing frame stage lends its actual original outer frame to readonly observers. */
    const frame = stage === S.frame ? (content as IRpcCarrierFrame) : undefined
    /** Encoded bytes and extension data keep their exact original identity and representation. */
    const media = frame ? frame.data : content
    /**
     * Acceptance remains present during closing; a current-business selection would hide it too
     * soon.
     */
    const view = this.#source.view()
    this.event({
      stage,
      direction,
      variation:
        stage === S.envelope && message?.kind === K.control ? message.operation : undefined,
      messageId: routed?.id,
      method: message && 'task' in message ? message.task.method : undefined,
      senderId: routed?.route.senderId,
      targetId: routed?.route.targetId,
      receiverId: routed?.route.receiverId,
      peerId: view?.peerId,
      sizeBytes: stage === S.envelope ? -1 : carrierSizeBytes(media),
      // An unaccepted handshake can contain private connection credentials.
      content: view ? media : undefined,
      carrierFrame: view ? frame : undefined,
      transfer
    })
  }
}
