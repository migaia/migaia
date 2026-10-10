import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/transport-kit.js'
import { RpcProcessErrorText } from '../error-text.js'
import type { IListenProcessByteChannel, IProcessByteChannel } from '../types.js'
import {
  dialProcessByteChannel as dialNodeCompatibleChannel,
  listenProcessByteChannel as listenNodeCompatibleChannel
} from './node-socket.js'

/** Deno's Windows transport has no named-pipe support in this adapter. */
function rejectUnsupportedPipe(address: string): void {
  if (address.startsWith('\\\\.\\pipe\\'))
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.optionsInvalid),
      RpcCoreErrorCode.invalidConfig
    )
}

/** Deno's Node-compatible TCP/Unix streams reuse the one authenticated state machine. */
export function dialProcessByteChannel(
  options: Readonly<{
    address: string
    signal?: AbortSignal
  }>
): Promise<IProcessByteChannel> {
  rejectUnsupportedPipe(options.address)
  return dialNodeCompatibleChannel(options)
}

/** Listener policy remains shared with Node, while named pipes stay unsupported. */
export const listenProcessByteChannel: IListenProcessByteChannel = (options) => {
  rejectUnsupportedPipe(options.address)
  return listenNodeCompatibleChannel(options)
}
