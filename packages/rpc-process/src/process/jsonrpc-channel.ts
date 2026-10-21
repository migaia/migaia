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
  Readonly<{
    /** One ordered byte carrier; Core owns its Content-Length parser and negotiation. */
    byte: IProcessByteChannel
    /** Nonsecret connection/session diagnostics and optional stderr presentation. */
    ipc: IProcessCommonOptions['ipc']
  }>

/**
 * Negotiate Core's Content-Length JSON-RPC profile over one owned Process byte channel. Headers are
 * bounded to 1024 bytes, bodies to 16777216 bytes, and handshake defaults to 10000ms. The caller
 * supplies the approved target/contract and token; errors retain the protocol owner's code and
 * Process supplies channel-closed diagnostics and stderr presentation. No native four-byte framing
 * or default native ping is added to this profile.
 */
export function createProcessJsonRpcChannel(
  options: IProcessJsonRpcChannelOptions
): Promise<IRemoteChannel> {
  return createAdapterJsonRpcChannel(options, {
    closedError: createProcessChannelClosedError,
    openConnection: openProcessObjectChannel
  })
}
