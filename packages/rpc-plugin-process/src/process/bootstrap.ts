import {
  readRuntimeByteBootstrap,
  createAdapterConfigurationTypeError
} from '@migaia/rpc-host/plugin'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IProcessByteChannel } from './types.js'
import { ProcessChannelDiagnostics } from './diagnostics.js'
import { RpcProcessErrorText } from './error-text.js'

/**
 * Optionally consume one framed stdin bootstrap and retain Core's same decoder for the following
 * handshake. 'none' returns the channel without reading. Options default to {}; an omitted timeout
 * installs no timer, while an explicit finite nonnegative deadline may reject
 * PROCESS_HANDSHAKE_TIMEOUT. Invalid deadlines reject INVALID_CONFIG; failed bootstrap acquisition
 * closes its channel.
 */
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
