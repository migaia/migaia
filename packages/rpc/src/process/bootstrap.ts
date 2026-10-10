import { createContractError } from '../contract/contract-error.js'
import { RpcContractErrorCode } from '../contract/index.js'
import { createRpcStreamFrameDecoderWithLimit } from '../contract/framing/stream.js'
import { RPC_STREAM_MAX_FRAME_BYTES } from '../contract/framing/stream-index.js'
import { registerProcessFrameSource } from './channel.js'
import { PROCESS_HANDSHAKE_MAX_FRAME_BYTES } from './constants.js'
import { RpcProcessErrorCode } from './error-code.js'
import { createProcessError } from './error.js'
import type { IProcessByteChannel } from './types.js'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '../core/index.js'
import { tagRpcError } from '../core/transport-kit.js'
import { RpcProcessErrorText } from './error-text.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'

/** Consume a framed stdin bootstrap and transfer the same decoder to handshake. */
export async function openBootstrapFrameChannel(
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
  /** The first decoded frame is bootstrap; all later frames retain this same decoder. */
  let bootstrapped = false
  /** The transferred decoder returns to the normal limit only after handshake activation. */
  let ready = false
  let resolveBootstrap: (payload: Uint8Array) => void = () => undefined
  let rejectBootstrap: (error: unknown) => void = () => undefined
  const payload = new Promise<Uint8Array>((resolve, reject) => {
    resolveBootstrap = resolve
    rejectBootstrap = reject
  })
  /** At most one hello may arrive before the caller binds its responder handshake. */
  let queued: Uint8Array | undefined
  let queuedError: Error | undefined
  let onFrame: ((frame: Uint8Array) => void) | undefined
  let onError: ((error: Error) => void) | undefined
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
        if (!bootstrapped) {
          bootstrapped = true
          resolveBootstrap(frame)
        } else if (onFrame) onFrame(frame)
        else if (queued === undefined) queued = frame
        else {
          /** A second pre-ready frame is a handshake violation, not another bootstrap. */
          const error = createContractError(RpcContractErrorCode.handshakeInvalid)
          queuedError = error
          void close()
        }
      },
      onError(error) {
        if (!bootstrapped) rejectBootstrap(error)
        else if (onError) onError(error)
        else queuedError = error
        void close()
      }
    },
    () => (ready ? RPC_STREAM_MAX_FRAME_BYTES : PROCESS_HANDSHAKE_MAX_FRAME_BYTES)
  )
  registerProcessFrameSource(channel, {
    decoder,
    activate() {
      ready = true
    },
    attach(frame, error) {
      onFrame = frame
      onError = error
      if (queuedError) error(queuedError)
      else if (queued) frame(queued)
      queued = undefined
      queuedError = undefined
      return () => {
        onFrame = undefined
        onError = undefined
      }
    }
  })
  channel.onData((chunk) => decoder.push(chunk))
  channel.onClose(() => {
    decoder.finish()
    if (!bootstrapped) rejectBootstrap(createProcessError(RpcProcessErrorCode.channelClosed))
  })
  /** Only opt-in discovery installs this original bootstrap owner's bounded wait. */
  let timer: IScheduledTask | undefined
  try {
    if (options.bootstrapTimeoutMs !== undefined)
      timer = (options.scheduler ?? systemScheduler).schedule(() => {
        rejectBootstrap(createProcessError(RpcProcessErrorCode.handshakeTimeout))
      }, options.bootstrapTimeoutMs)
    return Object.freeze({ channel, bootstrap: await payload })
  } catch (error) {
    await close()
    throw error
  } finally {
    timer?.cancel()
  }
}
