import { createContractError } from '../contract/contract-error.js'
import { RpcContractErrorCode } from '../contract/error-code.js'
import { createRpcStreamFrameDecoder } from '../contract/framing/stream.js'
import { registerProcessFrameSource } from './channel.js'
import { RpcProcessErrorCode } from './error-code.js'
import { createProcessError } from './error.js'
import type { IProcessByteChannel } from './types.js'

/** Consume a framed stdin bootstrap and transfer the same decoder to handshake. */
export async function openBootstrapFrameChannel(
  channel: IProcessByteChannel,
  bootstrap: 'stdin' | 'none'
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (bootstrap === 'none') return Object.freeze({ channel })
  /** The first decoded frame is bootstrap; all later frames retain this same decoder. */
  let bootstrapped = false
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
  const decoder = createRpcStreamFrameDecoder({
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
        void channel.close()
      }
    },
    onError(error) {
      if (!bootstrapped) rejectBootstrap(error)
      else if (onError) onError(error)
      else queuedError = error
      void channel.close()
    }
  })
  registerProcessFrameSource(channel, {
    decoder,
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
  try {
    return Object.freeze({ channel, bootstrap: await payload })
  } catch (error) {
    await channel.close()
    throw error
  }
}
