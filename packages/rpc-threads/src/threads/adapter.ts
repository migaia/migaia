import { defineMessageAdapter, type IAdapterDefinition } from '@migaia/rpc-core/adapter'
import { captureAdapterTask, type IAdapterTask } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey } from '@migaia/rpc-core/remote'
import type { IThreadParentPort } from './runtime-types.js'
import type { IThreadWebPort } from './types.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'
import type { IThreadHandle } from '@migaia/supervision/threads'

/** Both supported message surfaces give Core their actual port operations, never a channel DTO. */
export const threadMessageAdapter: IAdapterDefinition<
  IThreadParentPort | IThreadWebPort,
  'thread'
> = defineMessageAdapter({
  open: (port: IThreadParentPort | IThreadWebPort) => port
})

/** Capture original options once before loaders, short-source expansion, or native port acquisition. */
export function captureThreadTask<THandle extends IThreadHandle = IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>
): IAdapterTask<IThreadParentPort | IThreadWebPort> {
  return captureAdapterTask(threadMessageAdapter, options, RuntimePluginKey.thread)
}

/** Native branches share one held Core task while preserving their existing lifecycle owners. */
export type IThreadAdapterTask = ReturnType<typeof captureThreadTask>
