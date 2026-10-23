import type { IRuntimeObjectConnection } from '@migaia/rpc-host/plugin'
import { attachProcessChannelStderr } from './stderr.js'
import { processConnectionOptions } from './connection-options.js'
import type { IProcessCommonOptions } from './types.js'

/** Open the held Core object connection with Process diagnostics and the original stderr owner. */
export function openProcessObjectChannel(
  connection: IRuntimeObjectConnection,
  options: IProcessCommonOptions
): ReturnType<IRuntimeObjectConnection['open']> {
  /** Core has already observed its real negotiation; Process supplies only ordinary presentation. */
  const channel = connection.open(processConnectionOptions(options))
  return attachProcessChannelStderr(channel, options)
}
