/**
 * Acquires real Web Streams reader/writer ports and lends them to the SDK byte pump. Process
 * retains native error identity, acquisition rollback and the supplied physical cleanup.
 */
import { createProcessError, tagNativeProcessError } from './error.ts'
import {
  RPC_PROCESS_ERROR_SOURCE as ERROR_SOURCE,
  RpcProcessErrorCode
} from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcBytePump, RpcCarrierObservation, IpcReporterContext } from '@migaia/rpc-host/sdk'
import { RpcProcessErrorText } from './error-text.ts'
import type { IProcessByteChannel } from './types.ts'
import { ProcessByteCarrierFacts } from './constants.ts'

/** Borrow the sole Web Streams pump while keeping every Process error and close identity. */
export function webByteStream(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  closePhysical: () => void | Promise<void>
): IProcessByteChannel {
  /** Only successful native acquisition is lent to the canonical SDK read/write pump. */
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  /** Native writer order remains its own actual buffering/backpressure authority. */
  let writer: WritableStreamDefaultWriter<Uint8Array>
  try {
    reader = readable.getReader()
    writer = writable.getWriter()
  } catch (error) {
    reader?.releaseLock()
    throw tagNativeProcessError(error as Error, RpcProcessErrorCode.connectFailed)
  }
  /** The same native error reporter observes diagnostic failures without replacing IO settlement. */
  const report = (error: unknown) => hostRethrowReporter(error, IpcReporterContext)
  return new RpcBytePump(reader, writer, closePhysical, {
    closedError: () => createProcessError(RpcProcessErrorCode.channelClosed),
    cleanupFailed: (errors) =>
      attachErrorIdentity(
        new AggregateError(errors, RpcProcessErrorText.channelClosed, { cause: errors[0] }),
        { source: ERROR_SOURCE, code: RpcProcessErrorCode.channelClosed }
      ),
    report,
    observation: new RpcCarrierObservation(ProcessByteCarrierFacts, report)
  }).value
}

/** Acquire original native reader/writer without changing Process framing or cleanup policy. */
export function createAdapterWebByteIO(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>
) {
  return webByteStream(readable, writable, () => undefined)
}
