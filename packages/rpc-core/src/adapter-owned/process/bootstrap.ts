import { createProcessError } from './error.js'
import {
  createRpcStreamFrameDecoderWithLimit,
  createRpcBootstrapFrameReceiver
} from '@migaia/rpc-contract/framing/stream'
import { RPC_STREAM_MAX_FRAME_BYTES } from '@migaia/rpc-contract/framing/stream'
import { registerProcessFrameSource } from './channel.js'
import { PROCESS_HANDSHAKE_MAX_FRAME_BYTES } from './constants.js'
import { RpcProcessErrorCode } from './error-code.js'

import type { IProcessByteChannel } from './types.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/transport-kit.js'
import { RpcProcessErrorText } from './error-text.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'

/** Consume a framed stdin bootstrap and transfer the same decoder to handshake. */
export async function receiveAdapterBootstrap(
  channel: IProcessByteChannel,
  bootstrap: 'stdin' | 'none',
  options: Readonly<{ bootstrapTimeoutMs?: number; scheduler?: IScheduler }> = {}
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
    () => (receiver.ready ? RPC_STREAM_MAX_FRAME_BYTES : PROCESS_HANDSHAKE_MAX_FRAME_BYTES)
  )
  registerProcessFrameSource(channel, {
    decoder,
    activate: () => receiver.activate(),
    attach: (frame, error) => receiver.attach(frame, error)
  })
  channel.onData((chunk) => decoder.push(chunk))
  channel.onClose(() => {
    decoder.finish()
    if (!receiver.receivedBootstrap)
      receiver.fail(createProcessError(RpcProcessErrorCode.channelClosed))
  })
  /** Only opt-in discovery installs this original bootstrap owner's bounded wait. */
  let timer: IScheduledTask | undefined
  try {
    if (options.bootstrapTimeoutMs !== undefined)
      timer = (options.scheduler ?? systemScheduler).schedule(() => {
        receiver.fail(createProcessError(RpcProcessErrorCode.handshakeTimeout))
      }, options.bootstrapTimeoutMs)
    return Object.freeze({ channel, bootstrap: await receiver.bootstrap })
  } catch (error) {
    await close()
    throw error
  } finally {
    timer?.cancel()
  }
}
