import {
  createEventTargetMessageResource,
  prepareAdapterPeer,
  createAdapterConfigurationError,
  AdapterPeerErrorText,
  validateAdapterPeerMethods
} from '@migaia/rpc-core/adapter'
import {
  RuntimePluginKey,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from '@migaia/rpc-core/remote'
import type { IThreadWebPort } from './types.js'

/** Attach Core's original bounded raw bootstrap capture before any asynchronous preparation. */
export function createAutomaticWebThreadPeer(
  options: IRuntimePeerOptions,
  native: IThreadWebPort
): Promise<IRuntimePeer> {
  /** Core performs the original early timeout check without repeating the adapter's getter reads. */
  const preparation = prepareAdapterPeer(options, RuntimePluginKey.thread)
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw createAdapterConfigurationError(AdapterPeerErrorText.sourceInvalid)
  validateAdapterPeerMethods(options.provide, options.contract)
  /** Core receives the actual raw resource and retains bootstrap, capability and generation facts. */
  const resource = createEventTargetMessageResource(native)
  /** The opaque preparation reads captured raw input without an adapter agreement or context DTO. */
  return preparation.peer(options, resource)
}
