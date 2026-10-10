import { createThreadPeer as createAdapterThreadPeer } from '@migaia/rpc-core/adapter/threads'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import type { IRuntimeThreadPeerOptions } from '@migaia/rpc-core/adapter/threads'
import { threadRuntimeResource } from './runtime-resource.js'

/** Select and construct this runtime's complete Thread peer without wrapping its Promise. */
export function createThreadPeer<TRemote = Record<never, never>>(
  options: IRuntimeThreadPeerOptions
): Promise<IRuntimeTypedPeer<TRemote>> {
  return createAdapterThreadPeer<TRemote>(options, threadRuntimeResource)
}
