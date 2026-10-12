import {
  readRuntimeByteBootstrap,
  createAdapterConfigurationTypeError
} from '@migaia/rpc-core/adapter/internal-advanced'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IProcessByteChannel } from './types.js'
import { ProcessChannelDiagnostics } from './diagnostics.js'
import { RpcProcessErrorText } from './error-text.js'

/** Process discovery decides whether to consume a frame; Core owns actual decoder handoff. */
export async function receiveAdapterBootstrap(
  channel: IProcessByteChannel,
  bootstrap: 'stdin' | 'none',
  options: Readonly<{ bootstrapTimeoutMs?: number; scheduler?: IScheduler }> = {}
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (
    options.bootstrapTimeoutMs !== undefined &&
    (!Number.isFinite(options.bootstrapTimeoutMs) || options.bootstrapTimeoutMs < 0)
  )
    throw createAdapterConfigurationTypeError(RpcProcessErrorText.handshakeTimeoutInvalid)
  if (bootstrap === 'none') return Object.freeze({ channel })
  return readRuntimeByteBootstrap(channel, ProcessChannelDiagnostics, {
    timeoutMs: options.bootstrapTimeoutMs,
    scheduler: options.scheduler
  })
}
