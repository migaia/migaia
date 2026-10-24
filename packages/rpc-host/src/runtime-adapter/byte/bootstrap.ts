import { createRuntimeDiagnosticError } from './diagnostics.js'
import {
  createRpcStreamFrameDecoderWithLimit,
  createRpcBootstrapFrameReceiver
} from '@migaia/rpc-contract/framing/stream'
import { RPC_STREAM_MAX_FRAME_BYTES } from '@migaia/rpc-contract/framing/stream'
import { registerRuntimeByteFrameSource, RUNTIME_HANDSHAKE_MAX_FRAME_BYTES } from './carrier.js'

import type { IRuntimeByteIO, IRuntimeByteDiagnostics } from './types.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '../../core/errors.js'
import { tagRpcError } from '../../core/errors.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'

/** Actual first-frame snapshots remain private and cannot be replaced by returned mutable bytes. */
const bootstraps = new WeakMap<object, Uint8Array>()

/** Only Core's automatic Peer operation reads the exact held resource's observed first frame. */
export function readRuntimeByteBootstrapSnapshot(channel: IRuntimeByteIO): Uint8Array | undefined {
  return bootstraps.get(channel)
}

/** Own the first-frame receiver and the decoder transferred to the same physical wire. */
class RuntimeByteBootstrap {
  /** Exact byte resource stays under the original bootstrap-to-handshake custody. */
  #channel: IRuntimeByteIO
  /** Adapter-specific failures retain the original public error contract. */
  #diagnostics: IRuntimeByteDiagnostics
  /** Contract owns the first frame, following hello and deferred callback handoff. */
  #receiver: ReturnType<typeof createRpcBootstrapFrameReceiver>
  /** Handshake adopts this exact decoder without replaying raw bytes. */
  #decoder: ReturnType<typeof createRpcStreamFrameDecoderWithLimit>
  /** Decoder failure and the awaiting caller share one physical teardown. */
  #closing: Promise<void> | undefined

  /** Validate timeout before acquiring receiver/decoder state and installing native callbacks. */
  constructor(
    channel: IRuntimeByteIO,
    diagnostics: IRuntimeByteDiagnostics,
    options: Readonly<{ timeoutMs?: number; scheduler?: IScheduler }>
  ) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    )
      throw tagRpcError(
        new TypeError(diagnostics.handshakeTimeoutInvalid),
        RpcCoreErrorCode.invalidConfig
      )
    this.#channel = channel
    this.#diagnostics = diagnostics
    this.#receiver = createRpcBootstrapFrameReceiver()
    this.#decoder = createRpcStreamFrameDecoderWithLimit(
      {
        onFrame: (frame) => {
          /** Copy the actual first frame before the physical reader returns to its caller. */
          if (!this.#receiver.receivedBootstrap) bootstraps.set(channel, frame.slice())
          /** Decoder continues the current chunk after the original receiver reports a violation. */
          const violation = this.#receiver.accept(frame)
          if (violation) void this.close()
        },
        onError: (error) => {
          this.#receiver.fail(error)
          void this.close()
        }
      },
      () => (this.#receiver.ready ? RPC_STREAM_MAX_FRAME_BYTES : RUNTIME_HANDSHAKE_MAX_FRAME_BYTES)
    )
    registerRuntimeByteFrameSource(channel, {
      decoder: this.#decoder,
      activate: () => this.#receiver.activate(),
      attach: (frame, error) => this.#receiver.attach(frame, error)
    })
    channel.onData((chunk) => this.#decoder.push(chunk))
    channel.onClose(() => {
      this.#decoder.finish()
      if (!this.#receiver.receivedBootstrap)
        this.#receiver.fail(createRuntimeDiagnosticError(diagnostics.closed))
    })
  }

  /** Report cleanup once without replacing the bootstrap's original failure. */
  close = (): Promise<void> =>
    (this.#closing ??= Promise.resolve()
      .then(() => this.#channel.close())
      .catch((cleanup) => hostRethrowReporter(cleanup, IpcReporterContext)))

  /** Waiting code borrows the exact receiver Promise without another async adoption. */
  get bootstrap(): Promise<Uint8Array> {
    return this.#receiver.bootstrap
  }

  /** Only the original optional discovery timer can fail this receiver for timeout. */
  expire(): void {
    this.#receiver.fail(createRuntimeDiagnosticError(this.#diagnostics.timeout))
  }
}

/** Consume one framed bootstrap and transfer the same decoder to handshake. */
export async function readRuntimeByteBootstrap(
  channel: IRuntimeByteIO,
  diagnostics: IRuntimeByteDiagnostics,
  options: Readonly<{ timeoutMs?: number; scheduler?: IScheduler }> = {}
): Promise<Readonly<{ channel: IRuntimeByteIO; bootstrap: Uint8Array }>> {
  /** One connection owner retains the receiver, decoder and original physical close Promise. */
  const owner = new RuntimeByteBootstrap(channel, diagnostics, options)
  /** Timer belongs to this single wait and is released on success and failure. */
  let timer: IScheduledTask | undefined
  try {
    if (options.timeoutMs !== undefined)
      timer = (options.scheduler ?? systemScheduler).schedule(
        () => owner.expire(),
        options.timeoutMs
      )
    return Object.freeze({ channel, bootstrap: await owner.bootstrap })
  } catch (error) {
    await owner.close()
    throw error
  } finally {
    timer?.cancel()
  }
}
