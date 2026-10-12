import { defineByteAdapter, type IAdapterDefinition } from '@migaia/rpc-core/adapter'
import { captureAdapterTask, type IAdapterTask } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey, type IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import type { IProcessByteChannel } from './types.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'

/** The Process adapter hands Core the actual ordered byte resource acquired by its native owner. */
export const processByteAdapter: IAdapterDefinition<IProcessByteChannel, 'process'> =
  defineByteAdapter({
    open: (channel: IProcessByteChannel) => channel
  })

/** Capture original Host provenance before native discovery or any resolved-options copy. */
export function captureProcessTask(
  options: IRuntimeProcessPeerOptions,
  selectedSelf?: IRuntimePeerIdentity
): IAdapterTask<IProcessByteChannel> {
  return captureAdapterTask(processByteAdapter, options, RuntimePluginKey.process, selectedSelf)
}

/** Only package-local source assembly receives this held Core operation; users cannot submit it. */
export type IProcessAdapterTask = ReturnType<typeof captureProcessTask>
