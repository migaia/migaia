import { defineByteAdapter, type IAdapterDefinition } from '@migaia/rpc-core/adapter'
import { captureAdapterTask, type IAdapterTask } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey, type IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import type { IProcessByteChannel } from './types.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'

/** The definition is acquired by an actual factory, so importing another owner stays inert. */
let processByteAdapter: IAdapterDefinition<IProcessByteChannel, 'process'> | undefined

/** Reuse one definition after the native factory has entered its existing instance boundary. */
export function getProcessByteAdapter(): IAdapterDefinition<IProcessByteChannel, 'process'> {
  return (processByteAdapter ??= defineByteAdapter({
    open: (channel: IProcessByteChannel) => channel
  }))
}

/** Capture original Host provenance before native discovery or any resolved-options copy. */
export function captureProcessTask(
  options: IRuntimeProcessPeerOptions,
  selectedSelf?: IRuntimePeerIdentity
): IAdapterTask<IProcessByteChannel> {
  return captureAdapterTask(
    getProcessByteAdapter(),
    options,
    RuntimePluginKey.process,
    selectedSelf
  )
}

/** Only package-local source assembly receives this held Core operation; users cannot submit it. */
export type IProcessAdapterTask = ReturnType<typeof captureProcessTask>
