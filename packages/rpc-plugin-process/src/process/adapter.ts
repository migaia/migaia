import { defineByteAdapter, type IAdapterDefinition } from '@migaia/rpc-host/plugin'
import type { IProcessByteChannel } from './types.js'

/** The definition is acquired by an actual factory, so importing another owner stays inert. */
let processByteAdapter: IAdapterDefinition<IProcessByteChannel, 'process'> | undefined

/** Reuse one definition after the native factory has entered its existing instance boundary. */
export function getProcessByteAdapter(): IAdapterDefinition<IProcessByteChannel, 'process'> {
  return (processByteAdapter ??= defineByteAdapter({
    open: (channel: IProcessByteChannel) => channel
  }))
}
