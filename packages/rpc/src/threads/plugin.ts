import type { IThreadHandle } from '@migaia/supervision/threads'
import { createRemotePlugin, type IRemotePluginDefinition } from '../remote/plugin.js'
import { createThreadBinding } from './binding.js'
import type { IThreadPluginOptions } from './types.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from '../remote/runtime-api/plugin.js'
import { createThreadPeer } from './peer.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'

/** Symmetric Plugin options share the Peer source grammar and default to an empty Feature exposure. */
export type IRuntimeThreadPluginOptions = IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>

/** Combine one owned supervisor with remote's single Plugin assembly and retry owner. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle>
): IRemotePluginDefinition
/** Install a symmetric connection into the original canonical thread slot. */
export function createThreadPlugin(
  options: IRuntimeThreadPluginOptions
): ReturnType<typeof createRuntimePlugin>
/** Legacy declarations remain only until the registered C7 consumer migration removes this branch. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle> | IRuntimeThreadPluginOptions
): IRemotePluginDefinition | ReturnType<typeof createRuntimePlugin> {
  if (options.contract === undefined)
    return createRuntimePlugin(options, 'thread', createThreadPeer)
  return createRemotePlugin({
    name: options.name,
    contract: options.contract,
    host: options.host,
    binding: createThreadBinding(options),
    endpointFactory: options.endpointFactory,
    report: options.report,
    keyFactory: options.keyFactory,
    callDeadlineCapMs: options.spec.limits?.callWallTimeMs,
    ...(options.retryPort === undefined ? {} : { retryPort: options.retryPort })
  })
}
