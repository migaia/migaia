import {
  prepareAdapterPeer,
  createAdapterSourceConfigurationError,
  validateAdapterPeerMethods
} from '@migaia/rpc-core/adapter'
import {
  RuntimePluginKey,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from '@migaia/rpc-core/remote'
import type { IThreadWebPort } from './types.js'
import { threadChildResource } from './child.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'

/** Attach Core's original bounded raw bootstrap capture before any asynchronous preparation. */
export function createAutomaticWebThreadPeer(
  options: IRuntimeThreadPeerOptions,
  native: IThreadWebPort
): Promise<IRuntimePeer> {
  /** Core performs the original early timeout check without repeating the adapter's getter reads. */
  const preparation = prepareAdapterPeer(options, RuntimePluginKey.thread)
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw createAdapterSourceConfigurationError()
  validateAdapterPeerMethods(options.provide, options.contract)
  /** Core receives the actual raw resource and retains bootstrap, capability and generation facts. */
  const resource = threadChildResource(native)
  /** The opaque preparation reads captured raw input without an adapter agreement or context DTO. */
  return preparation.peer(
    { ...options, report: options.report ?? console.error } as IRuntimePeerOptions,
    resource
  )
}
