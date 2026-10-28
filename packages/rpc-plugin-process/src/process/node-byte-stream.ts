/**
 * Lends exact Node streams, Process error presentation and native observation facts to SDK
 * EventByteIO. The caller retains the actual physical shutdown operation.
 */
import type { Readable, Writable } from 'node:stream'
import { RpcEventByteIO, RpcCarrierObservation, IpcReporterContext } from '@migaia/rpc-host/sdk'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createProcessChannelClosedError } from './error.ts'
import { ProcessByteCarrierFacts } from './constants.ts'

/** Node acquisition borrows the unique SDK byte owner while retaining native stream cleanup. */
export function nodeByteStream(
  readable: Readable,
  writable: Writable,
  destroy: () => void,
  isExclusive?: () => boolean
) {
  /** Physical observer failures use the original native resource's background error boundary. */
  const report = (error: unknown) => hostRethrowReporter(error, IpcReporterContext)
  return new RpcEventByteIO(readable, writable, destroy, {
    closedError: createProcessChannelClosedError,
    report,
    isExclusive,
    observation: new RpcCarrierObservation(ProcessByteCarrierFacts, report)
  }).value
}
