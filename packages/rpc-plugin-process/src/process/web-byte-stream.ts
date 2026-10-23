import { createProcessError, tagNativeProcessError } from './error.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createRuntimeWebByteStream, IpcReporterContext } from '@migaia/rpc-host/plugin'
import { RpcProcessErrorText } from './error-text.js'
import type { IProcessByteChannel } from './types.js'

/** Borrow the sole Web Streams pump while keeping every Process error and close identity. */
export function webByteStream(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  closePhysical: () => void | Promise<void>
): IProcessByteChannel {
  return createRuntimeWebByteStream(readable, writable, closePhysical, {
    openFailed: (error) => tagNativeProcessError(error, RpcProcessErrorCode.connectFailed),
    closedError: () => createProcessError(RpcProcessErrorCode.channelClosed),
    cleanupFailed: (errors) =>
      attachErrorIdentity(
        new AggregateError(errors, RpcProcessErrorText.channelClosed, { cause: errors[0] }),
        { source: ERROR_SOURCE, code: RpcProcessErrorCode.channelClosed }
      ),
    report: (error) => hostRethrowReporter(error, IpcReporterContext)
  })
}

/** Acquire original native reader/writer without changing Process framing or cleanup policy. */
export function createAdapterWebByteIO(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>
) {
  return webByteStream(readable, writable, () => undefined)
}
