import {
  createAdapterJsonRpcChannel,
  type IAdapterJsonRpcChannelOptions
} from '@migaia/rpc-core/adapter/internal-advanced'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'
import type { IProcessByteChannel, IProcessCommonOptions } from './types.js'
import { createProcessChannelClosedError } from './error.js'
import { openProcessObjectChannel } from './object-channel.js'

/** The original Process byte and stderr/diagnostic inputs surround Core's one JSON-RPC protocol. */
export type IProcessJsonRpcChannelOptions = Omit<IAdapterJsonRpcChannelOptions, 'byte' | 'ipc'> &
  Readonly<{ byte: IProcessByteChannel; ipc: IProcessCommonOptions['ipc'] }>

/** Negotiate held bytes through Core while retaining Process closed errors and stderr ownership. */
export function createProcessJsonRpcChannel(
  options: IProcessJsonRpcChannelOptions
): Promise<IRemoteChannel> {
  return createAdapterJsonRpcChannel(options, {
    closedError: createProcessChannelClosedError,
    openConnection: openProcessObjectChannel
  })
}
