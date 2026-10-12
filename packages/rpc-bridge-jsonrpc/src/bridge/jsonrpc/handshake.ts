import type { IAdapterJsonRpcChannelOptions } from '@migaia/rpc-core/adapter'
import type { IProcessByteChannel, IProcessCommonOptions } from '@migaia/rpc-process'

/** Bridge callers keep their original Process byte and stderr/diagnostic presentation inputs. */
export type IJsonRpcBridgeOptions = Omit<IAdapterJsonRpcChannelOptions, 'byte' | 'ipc'> &
  Readonly<{
    byte: IProcessByteChannel
    ipc: IProcessCommonOptions['ipc']
  }>
