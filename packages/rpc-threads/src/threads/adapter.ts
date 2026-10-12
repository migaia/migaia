import { defineMessageAdapter, type IAdapterDefinition } from '@migaia/rpc-core/adapter'
import { captureAdapterTask, type IAdapterTask } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey } from '@migaia/rpc-core/remote'
import type { IThreadParentPort } from './runtime-types.js'
import type { IThreadWebPort } from './types.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'
import type { IThreadHandle } from '@migaia/supervision/threads'

/** Importing another owner stays inert; an actual native factory acquires this definition. */
let threadMessageAdapter:
  | IAdapterDefinition<IThreadParentPort | IThreadWebPort, 'thread'>
  | undefined

/** Reuse one definition after the native factory has entered its existing instance boundary. */
export function getThreadMessageAdapter(): IAdapterDefinition<
  IThreadParentPort | IThreadWebPort,
  'thread'
> {
  return (threadMessageAdapter ??= defineMessageAdapter({
    open: (port: IThreadParentPort | IThreadWebPort) => port
  }))
}

/** Capture original options once before loaders, short-source expansion, or native port acquisition. */
export function captureThreadTask<THandle extends IThreadHandle = IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>
): IAdapterTask<IThreadParentPort | IThreadWebPort> {
  return captureAdapterTask(getThreadMessageAdapter(), options, RuntimePluginKey.thread)
}

/** Native branches share one held Core task while preserving their existing lifecycle owners. */
export type IThreadAdapterTask = ReturnType<typeof captureThreadTask>
