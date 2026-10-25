/**
 * Owns the native carrier's single exact observation subscription and immutable acquired media
 * facts. Actual IO points emit borrowed raw content only when subscribed, with callback failures
 * reported outside business settlement; no extra native listener, content queue or execution
 * authority exists.
 */
import type {
  IRpcCarrierObservation,
  IRpcCarrierObservationFacts,
  IRpcCarrierObservationEvent,
  IRpcDispose,
  RpcProbeDirection
} from '@migaia/rpc-contract/interfaces'
import { carrierSizeBytes } from '../wire/probe-content.js'

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
