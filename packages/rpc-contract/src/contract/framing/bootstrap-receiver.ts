import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'

/** A custom byte carrier consumes one bootstrap and retains at most one following handshake frame. */
export type IRpcBootstrapFrameReceiver = Readonly<{
  readonly bootstrap: Promise<Uint8Array>
  readonly receivedBootstrap: boolean
  readonly ready: boolean
  accept(frame: Uint8Array): Error | undefined
  fail(error: Error): void
  attach(onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void): () => void
  activate(): void
}>

/** Only protocol data and its original one-frame hand-off live here; physical close remains outside. */
class RpcBootstrapFrameReceiver implements IRpcBootstrapFrameReceiver {
  /** The exact first payload resolves one bootstrap wait without copying native bytes. */
  readonly bootstrap: Promise<Uint8Array>
  /** Later frames cannot resolve the bootstrap again or replace its original first identity. */
  #bootstrapped = false
  /** Activation restores the carrier's normal frame ceiling through its existing limit callback. */
  #ready = false
  /** Resolve the one bootstrap Promise when the first complete frame arrives. */
  #resolveBootstrap: (frame: Uint8Array) => void = () => undefined
  /** Reject the same Promise when decoding fails before any bootstrap was received. */
  #rejectBootstrap: (error: unknown) => void = () => undefined
  /** At most one following control payload survives until the handshake receiver attaches. */
  #queued: Uint8Array | undefined
  /** The original last pre-attachment decoder/sequence error is delivered instead of queued data. */
  #queuedError: Error | undefined
  /** An attached consumer receives the original payload directly, without replaying a decoder. */
  #onFrame: ((frame: Uint8Array) => void) | undefined
  /** An attached failure consumer receives the exact existing error object. */
  #onError: ((error: Error) => void) | undefined

  /** Allocate the original bootstrap wait; no subscription, timer, or resource acquisition occurs. */
  constructor() {
    this.bootstrap = new Promise<Uint8Array>((resolve, reject) => {
      this.#resolveBootstrap = resolve
      this.#rejectBootstrap = reject
    })
  }

  /**
   * Accept data and return a detected sequence violation so the carrier keeps its original push
   * loop.
   */
  accept(frame: Uint8Array): Error | undefined {
    if (!this.#bootstrapped) {
      this.#bootstrapped = true
      this.#resolveBootstrap(frame)
    } else if (this.#onFrame) this.#onFrame(frame)
    else if (this.#queued === undefined) this.#queued = frame
    else {
      /** Another pre-ready frame violates the actual single-handshake hand-off grammar. */
      const error = createContractError(RpcContractErrorCode.handshakeInvalid)
      this.#queuedError = error
      return error
    }
    return undefined
  }

  /** Preserve first-bootstrap rejection or the original attached/queued error delivery. */
  fail(error: Error): void {
    if (!this.#bootstrapped) this.#rejectBootstrap(error)
    else if (this.#onError) this.#onError(error)
    else this.#queuedError = error
  }

  /** Transfer the pending control frame or error once, keeping callback and cleanup order unchanged. */
  attach(onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void): () => void {
    this.#onFrame = onFrame
    this.#onError = onError
    if (this.#queuedError) onError(this.#queuedError)
    else if (this.#queued) onFrame(this.#queued)
    this.#queued = undefined
    this.#queuedError = undefined
    return () => {
      this.#onFrame = undefined
      this.#onError = undefined
    }
  }

  /** The held receiver advances only its own normal frame-cap phase. */
  activate(): void {
    this.#ready = true
  }

  /** Native adapters can preserve their original close-before-bootstrap rejection branch. */
  get receivedBootstrap(): boolean {
    return this.#bootstrapped
  }

  /** The carrier's existing limit callback reads this actual receiver phase. */
  get ready(): boolean {
    return this.#ready
  }
}

/** Construct the complete bootstrap-to-handshake data hand-off for a custom framed carrier. */
export function createRpcBootstrapFrameReceiver(): IRpcBootstrapFrameReceiver {
  return new RpcBootstrapFrameReceiver()
}
