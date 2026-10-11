import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import { RpcHandshakeStep, RpcReservedKind } from '../wire-constants.js'
import { RPC_FRAME_TEXT_ENCODING } from './text-encoding.js'

/** A carrier's existing handshake role selects only its own receive grammar. */
export const RpcHandshakeRole = { initiator: 'initiator', responder: 'responder' } as const
export type RpcHandshakeRole = keyof typeof RpcHandshakeRole

/** Retain the actual configuration reference so role getters run at the original frame points. */
export type IRpcHandshakeFrameReceiverOptions = Readonly<{ role?: RpcHandshakeRole }>

/**
 * A custom framed carrier owns this protocol receiver; no native resource or execution is owned
 * here.
 */
export type IRpcHandshakeFrameReceiver = Readonly<{
  accept(frame: Uint8Array): string | Error | undefined
  readHandshakeFrame(): Promise<string>
  deferActivation(): void
  beginAccept(): void
  activate(): void
  close(reason: unknown): void
  readonly ready: boolean
}>

/** Classify a control frame without exposing parser diagnostics or the received body. */
function isHandshakeControl(text: string, step?: RpcHandshakeStep): boolean {
  try {
    /** The exact original shallow discriminator does not perform a second handshake admission. */
    const value: unknown = JSON.parse(text)
    return (
      value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === RpcReservedKind.handshake &&
      (step === undefined || ('step' in value && value.step === step))
    )
  } catch {
    return false
  }
}

/** The receiver owns only the original UTF-8 and single-handshake state, without I/O or timers. */
class RpcHandshakeFrameReceiver implements IRpcHandshakeFrameReceiver {
  /** Keep caller configuration live until the same actual receive branches inspect its role. */
  #options: IRpcHandshakeFrameReceiverOptions
  /** The strict decoder retains the original per-complete-frame UTF-8 failure boundary. */
  #decoder = new TextDecoder(RPC_FRAME_TEXT_ENCODING, { fatal: true })
  /** Cache one control frame until the first handshake reader consumes it. */
  #handshakeFrame: string | undefined
  /** One pending reader resolves on the first control frame or rejects on caller close. */
  #waiter: Readonly<{ resolve(frame: string): void; reject(error: unknown): void }> | undefined
  /** Reject another handshake/read instead of allocating a second exchange. */
  #handshakeReceived = false
  /** An initiator accept or responder beginAccept permits the original early-business branch. */
  #acceptReceived = false
  /** Own receive activation can defer delivery until the carrier installs its consumer. */
  #deferred = false
  /** Only the receiver's own activation changes subsequent UTF-8 failures to frame violations. */
  #ready = false
  /** Retain this resource's supplied close reason for late reads without constructing another error. */
  #terminal: Readonly<{ reason: unknown }> | undefined

  /** Construction retains configuration and creates the same strict decoder, without reading role. */
  constructor(options: IRpcHandshakeFrameReceiverOptions) {
    this.#options = options
  }

  /**
   * Return business text or the actual grammar error; caller getter exceptions retain their outer
   * boundary.
   */
  accept(frame: Uint8Array): string | Error | undefined {
    if (this.#terminal) return undefined
    /** Each complete payload receives exactly one independent native decode. */
    let text: string
    try {
      text = this.#decoder.decode(frame)
    } catch {
      return createContractError(
        this.#ready ? RpcContractErrorCode.invalidFrame : RpcContractErrorCode.handshakeInvalid
      )
    }
    if (!this.#ready) {
      if (this.#handshakeReceived) {
        if (
          (this.#options.role === RpcHandshakeRole.initiator || this.#deferred) &&
          this.#acceptReceived &&
          !isHandshakeControl(text)
        )
          return text
        return createContractError(RpcContractErrorCode.handshakeInvalid)
      }
      this.#handshakeReceived = true
      this.#acceptReceived =
        this.#options.role === RpcHandshakeRole.initiator &&
        isHandshakeControl(text, RpcHandshakeStep.accept)
      if (this.#waiter) {
        this.#waiter.resolve(text)
        this.#waiter = undefined
      } else this.#handshakeFrame = text
      return undefined
    }
    return text
  }

  /** Consume the cached frame or establish the original sole reader and Promise boundary. */
  readHandshakeFrame(): Promise<string> {
    if (this.#terminal) return Promise.reject(this.#terminal.reason)
    if (this.#handshakeFrame !== undefined) {
      /** Clear before resolving so reentrant reads cannot consume the same control frame. */
      const frame = this.#handshakeFrame
      this.#handshakeFrame = undefined
      return Promise.resolve(frame)
    }
    if (this.#waiter || this.#handshakeReceived)
      return Promise.reject(createContractError(RpcContractErrorCode.handshakeInvalid))
    return new Promise<string>((resolve, reject) => {
      this.#waiter = { resolve, reject }
    })
  }

  /** The held receiver can buffer post-accept business frames until its own consumer activates. */
  deferActivation(): void {
    this.#deferred = true
  }

  /** The responder records its actual accept transition before the physical accept write. */
  beginAccept(): void {
    if (this.#terminal) throw this.#terminal.reason
    this.#acceptReceived = true
  }

  /** Activation requires an actual received control frame and creates no channel or native rights. */
  activate(): void {
    if (this.#terminal) throw this.#terminal.reason
    if (!this.#handshakeReceived) throw createContractError(RpcContractErrorCode.handshakeInvalid)
    this.#ready = true
  }

  /** Release this receiver's reader and cached frame using the caller's original terminal reason. */
  close(reason: unknown): void {
    this.#terminal ??= { reason }
    this.#waiter?.reject(this.#terminal.reason)
    this.#waiter = undefined
    this.#handshakeFrame = undefined
  }

  /**
   * Physical adapters can retain their original queue/limit decisions from this receiver's own
   * phase.
   */
  get ready(): boolean {
    return this.#ready
  }
}

/** Construct the complete protocol receiver for a custom complete-frame byte carrier. */
export function createRpcHandshakeFrameReceiver(
  options: IRpcHandshakeFrameReceiverOptions
): IRpcHandshakeFrameReceiver {
  return new RpcHandshakeFrameReceiver(options)
}
