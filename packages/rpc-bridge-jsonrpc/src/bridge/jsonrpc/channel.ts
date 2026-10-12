import { createAdapterJsonRpcChannel } from '@migaia/rpc-core/adapter'
import { createProcessChannelClosedError, openProcessObjectChannel } from '@migaia/rpc-process'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'
import type { IJsonRpcBridgeOptions } from './handshake.js'

/**
 * Delegate JSON-RPC construction to its canonical Core owner while Process retains the existing
 * closed-error constructor and diagnostic/stderr opening of that same held connection.
 */
export function createJsonRpcAdapterChannel(
  options: IJsonRpcBridgeOptions
): Promise<IRemoteChannel> {
  return createAdapterJsonRpcChannel(options, {
    closedError: createProcessChannelClosedError,
    openConnection: openProcessObjectChannel
  })
}
