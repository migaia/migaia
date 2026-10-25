/**
 * Receives one bounded native bootstrap frame using the SDK decoder, then detaches its temporary
 * subscriptions. Any coalesced tail is handed to the original channel before Session reading
 * begins.
 */
import { deferred, hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import {
  createRpcStreamFrameDecoderWithLimit,
  IpcReporterContext,
  resolveAbortReason
} from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode, RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { PROCESS_HANDSHAKE_MAX_FRAME_BYTES } from './constants.js'
import { createProcessError } from './error.js'
import { RpcProcessErrorText } from './error-text.js'
import type { IProcessByteChannel } from './types.js'

/** Native first-frame acquisition retains only the unconsumed tail for the one Session reader. */
class ProcessBootstrap {
  /** The exact acquired stdin/stdout owner retains physical close and native backpressure. */
  readonly #raw: IProcessByteChannel
  /** One first-frame result owns discovery success and failure. */
  readonly #received = deferred<void>()
  /**
   * Secret first-frame bytes transfer to the caller once and are then cleared from this channel
   * owner.
   */
  #bootstrap: Uint8Array | undefined
  /**
   * Native preparation cancellation closes the same physical reader and never creates a second
   * pump.
   */
  readonly #signal: IAbortSignal | undefined
  /** The sole framing implementation stops synchronously after this native bootstrap. */
  readonly #decoder
  /** Bootstrap completion detaches native byte delivery before Session assumes ownership. */
  #removeData: (() => void) | undefined
  /** EOF observation remains live throughout first-frame acquisition. */
  #removeClose: (() => void) | undefined
  /** The current native chunk may also contain the beginning of the actual RPC hello. */
  #tail: Uint8Array | undefined
  /** A completed first frame or failure prevents another result or native read. */
  #settled = false
  /** Failure cleanup shares the physical owner's original Promise. */
  #closing: Promise<void> | undefined
  /** The optional existing deadline belongs solely to this native discovery operation. */
  #timer: IScheduledTask | undefined
  /** Session receives one physical channel with only its still-unconsumed bytes. */
  readonly channel: IProcessByteChannel

  /** Acquire one bounded bootstrap without decoding or consuming the following semantic frame. */
  constructor(
    raw: IProcessByteChannel,
    timeoutMs: number | undefined,
    scheduler: IScheduler,
    signal?: IAbortSignal
  ) {
    this.#raw = raw
    this.#signal = signal
    this.#decoder = createRpcStreamFrameDecoderWithLimit(
      { onFrame: this.#frame, onError: this.#fail },
      () => PROCESS_HANDSHAKE_MAX_FRAME_BYTES
    )
    this.channel = Object.freeze({
      kind: raw.kind,
      observation: raw.observation,
      isExclusive: raw.isExclusive,
      write: (chunk, options) => raw.write(chunk, options),
      close: (reason) => raw.close(reason),
      onClose: (listener) => raw.onClose(listener),
      onData: this.#subscribe
    })
    signal?.addEventListener('abort', this.#abort, { once: true })
    if (signal?.aborted) this.#abort()
    if (this.#settled) return
    this.#removeClose = raw.onClose(() => {
      this.#decoder.finish()
      this.#fail(createProcessError(RpcProcessErrorCode.channelClosed))
    })
    if (!this.#settled) this.#removeData = raw.onData(this.#data)
    if (this.#settled) this.#detach()
    else if (timeoutMs !== undefined)
      this.#timer = scheduler.schedule(
        () => this.#fail(createProcessError(RpcProcessErrorCode.handshakeTimeout)),
        timeoutMs
      )
  }

  /** Cancellation retains its original reason while the one native reader is physically released. */
  readonly #abort = (): void => {
    this.#fail(
      createProcessError(RpcProcessErrorCode.channelClosed, resolveAbortReason(this.#signal!))
    )
  }

  /** Preserve original bytes until the receiver resolves; no peer DTO is created. */
  readonly #frame = (frame: Uint8Array): void => {
    if (this.#settled) return
    this.#settled = true
    this.#decoder.close()
    this.#detach()
    this.#bootstrap = frame.slice()
    this.#received.resolve()
  }
  /** Decode once; a coalesced hello tail precedes every later native read. */
  readonly #data = (chunk: Uint8Array): void => {
    /** Closing from onFrame makes this the exact boundary in the original chunk. */
    const consumed = this.#decoder.push(chunk)
    if (this.#settled && consumed < chunk.byteLength) this.#tail = chunk.subarray(consumed)
  }
  /** First failure retains its identity and tears down the acquired physical owner. */
  readonly #fail = (error: Error): void => {
    if (this.#settled) return
    this.#settled = true
    this.#decoder.close()
    this.#detach()
    this.#received.reject(error)
    void this.close()
  }
  /** Release acquisition observers and deadline on every terminal path. */
  #detach(): void {
    this.#signal?.removeEventListener('abort', this.#abort)
    this.#removeData?.()
    this.#removeData = undefined
    this.#removeClose?.()
    this.#removeClose = undefined
    this.#timer?.cancel()
    this.#timer = undefined
  }
  /** Move the single native tail to the next reader before resuming the source. */
  readonly #subscribe = (listener: (chunk: Uint8Array) => void): (() => void) => {
    /** Release retained bytes before arbitrary delivery can reenter subscription. */
    const tail = this.#tail
    this.#tail = undefined
    if (tail) listener(tail)
    return this.#raw.onData(listener)
  }
  /** Cleanup is reported without replacing the discovery failure. */
  close(): Promise<void> {
    return (this.#closing ??= Promise.resolve()
      .then(() => this.#raw.close())
      .catch((error) => hostRethrowReporter(error, IpcReporterContext)))
  }
  /** Join physical rollback before rejecting the original first-frame receipt. */
  async read(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap: Uint8Array }>> {
    try {
      await this.#received.promise
      /** Only the caller retains this private payload after the single handoff. */
      const bootstrap = this.#bootstrap!
      this.#bootstrap = undefined
      return Object.freeze({ channel: this.channel, bootstrap })
    } catch (error) {
      await this.close()
      throw error
    }
  }
}

/** Consume one native bootstrap; an omitted timeout installs no discovery timer. */
export async function receiveAdapterBootstrap(
  channel: IProcessByteChannel,
  bootstrap: 'stdin' | 'none',
  options: Readonly<{
    bootstrapTimeoutMs?: number
    scheduler?: IScheduler
    signal?: IAbortSignal
  }> = {}
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (
    options.bootstrapTimeoutMs !== undefined &&
    (!Number.isFinite(options.bootstrapTimeoutMs) || options.bootstrapTimeoutMs < 0)
  )
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.handshakeTimeoutInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  if (bootstrap === 'none') return Object.freeze({ channel })
  return new ProcessBootstrap(
    channel,
    options.bootstrapTimeoutMs,
    options.scheduler ?? systemScheduler,
    options.signal
  ).read()
}
