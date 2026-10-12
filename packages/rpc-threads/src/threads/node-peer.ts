import { createEventEmitterMessageResource, prepareAdapterPeer } from '@migaia/rpc-core/adapter'
import {
  RuntimePluginKey,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from '@migaia/rpc-core/remote'
import type { IThreadParentPort } from './runtime-types.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from './runtime-peer.js'

/** Discover only the actual held native parent port and its original raw launch input. */
export function createAdapterNodeThreadPeer(
  options: IRuntimeThreadPeerOptions,
  parentPort: IThreadParentPort | null,
  workerData: unknown
): Promise<IRuntimePeer> {
  /** Retain the original early timeout admission and genuine Host context once. */
  const preparation = prepareAdapterPeer(options, RuntimePluginKey.thread)
  if (!parentPort)
    return typeof options.spawn === 'object'
      ? createThreadSourcePeer(options)
      : preparation.peer({ ...options, self: preparation.context.self } as IRuntimePeerOptions)
  /** Core reads the same actual workerData and keeps the closed admission snapshot private. */
  const resource = createEventEmitterMessageResource(parentPort)
  resource.receiveInitial({ direction: 'inbound', read: () => workerData })
  /** Identity, local provider compilation, generation and actual ACK remain one Core operation. */
  return preparation.peer(options as IRuntimePeerOptions, resource)
}
