import { createRuntimeDiagnosticError } from './diagnostics.js'
import {
  createRpcStreamFrameDecoderWithLimit,
  createRpcBootstrapFrameReceiver
} from '@migaia/rpc-contract/framing/stream'
import { RPC_STREAM_MAX_FRAME_BYTES } from '@migaia/rpc-contract/framing/stream'
import { registerRuntimeByteFrameSource, RUNTIME_HANDSHAKE_MAX_FRAME_BYTES } from './carrier.js'

import type { IRuntimeByteIO, IRuntimeByteDiagnostics } from './types.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/errors.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'

/** Consume one framed bootstrap and transfer the same decoder to handshake. */
export async function readRuntimeByteBootstrap(
  channel: IRuntimeByteIO,
  diagnostics: IRuntimeByteDiagnostics,
  options: Readonly<{ timeoutMs?: number; scheduler?: IScheduler }> = {}
): Promise<Readonly<{ channel: IRuntimeByteIO; bootstrap: Uint8Array }>> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  )
    throw tagRpcError(
      new TypeError(diagnostics.handshakeTimeoutInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  /** Contract owns the first frame, one following hello and original deferred callback handoff. */
  const receiver = createRpcBootstrapFrameReceiver()
  /** Decoder failure and the awaiting caller share one physical teardown. */
  let closing: Promise<void> | undefined
  /** Cleanup failure is reported once; it cannot replace the bootstrap failure being settled. */
  const close = (): Promise<void> =>
    (closing ??= Promise.resolve()
      .then(() => channel.close())
      .catch((cleanup) => hostRethrowReporter(cleanup, IpcReporterContext)))
  const decoder = createRpcStreamFrameDecoderWithLimit(
    {
      onFrame(frame) {
        /** Owner violations are data here: the original decoder continues the current chunk. */
        const violation = receiver.accept(frame)
        if (violation) void close()
      },
      onError(error) {
        receiver.fail(error)
        void close()
      }
    },
    () => (receiver.ready ? RPC_STREAM_MAX_FRAME_BYTES : RUNTIME_HANDSHAKE_MAX_FRAME_BYTES)
  )
  registerRuntimeByteFrameSource(channel, {
    decoder,
    activate: () => receiver.activate(),
    attach: (frame, error) => receiver.attach(frame, error)
  })
  channel.onData((chunk) => decoder.push(chunk))
  channel.onClose(() => {
    decoder.finish()
    if (!receiver.receivedBootstrap) receiver.fail(createRuntimeDiagnosticError(diagnostics.closed))
  })
  /** Only opt-in discovery installs this original bootstrap owner's bounded wait. */
  let timer: IScheduledTask | undefined
  try {
    if (options.timeoutMs !== undefined)
      timer = (options.scheduler ?? systemScheduler).schedule(() => {
        receiver.fail(createRuntimeDiagnosticError(diagnostics.timeout))
      }, options.timeoutMs)
    return Object.freeze({ channel, bootstrap: await receiver.bootstrap })
  } catch (error) {
    await close()
    throw error
  } finally {
    timer?.cancel()
  }
}
