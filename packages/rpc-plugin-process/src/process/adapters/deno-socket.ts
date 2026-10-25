/**
 * Uses Deno's Node-compatible socket adapter for native TCP/Unix acquisition. Unsupported
 * named-pipe addresses reject before dialing or binding, preserving the shared socket lifecycle.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProcessErrorText } from '../error-text.js'
import type { IListenProcessByteChannel, IProcessByteChannel } from '../types.js'
import {
  dialProcessByteChannel as dialNodeCompatibleChannel,
  listenProcessByteChannel as listenNodeCompatibleChannel
} from './node-socket.js'

/** Deno's Windows transport has no named-pipe support in this adapter. */
function rejectUnsupportedPipe(address: string): void {
  if (address.startsWith('\\\\.\\pipe\\'))
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_ENDPOINT_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
}

/**
 * Dial through Deno's Node-compatible TCP/Unix implementation, borrowing the remote process and
 * owning only this socket. Named pipes reject INVALID_CONFIG synchronously; other address, abort
 * and dial outcomes retain the shared Node adapter's contract.
 */
export function dialProcessByteChannel(
  options: Readonly<{
    /** Absolute Unix path or numeric loopback TCP URL; Windows named pipes are unsupported. */
    address: string
    /** Optional dial-only cancellation, detached after successful connection. */
    signal?: AbortSignal
  }>
): Promise<IProcessByteChannel> {
  rejectUnsupportedPipe(options.address)
  return dialNodeCompatibleChannel(options)
}

/**
 * Bind the same authenticated pending-candidate listener as Node, including ready-channel ownership
 * transfer and idempotent close. Deno named pipes reject INVALID_CONFIG before native acquisition.
 */
export const listenProcessByteChannel: IListenProcessByteChannel = (options) => {
  rejectUnsupportedPipe(options.address)
  return listenNodeCompatibleChannel(options)
}
