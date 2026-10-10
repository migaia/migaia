import type { IRuntimePluginTyping, IRuntimeExpose, IRuntimeRegistry } from '../remote/index.js'
import type { IThreadHandle } from '@migaia/supervision/threads'
import { createRemotePlugin, type IRemotePluginDefinition } from '../remote/index.js'
import { createThreadBinding } from './binding.js'
import type { IThreadPluginOptions } from './types.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from '../remote/index.js'
import { RuntimePluginKey } from '../remote/index.js'
import { createThreadPeer } from './peer.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'

/** This physical owner alone retains the stable family token for its actual Host slot operation. */
const threadRuntimeSlotFamily = Object.freeze({})

/** Capture the canonical namespace once; descriptive resource fields cannot retarget this operation. */
const threadRuntimeSlotKey = RuntimePluginKey.thread

/** Symmetric Plugin options share the Peer source grammar and default to an empty Feature exposure. */
export type IRuntimeThreadPluginOptions = IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>

/** Combine one owned supervisor with remote's single Plugin assembly and retry owner. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle>
): IRemotePluginDefinition
/** Install a symmetric connection into the original canonical thread slot. */
export function createThreadPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('../remote/index.js').IRuntimePeerProvide = Record<never, never>,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IRuntimeThreadPluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
/** Legacy declarations remain only until the registered C7 consumer migration removes this branch. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle> | IRuntimeThreadPluginOptions
): IRemotePluginDefinition | ReturnType<typeof createRuntimePlugin> {
  if (!('spec' in options))
    return createRuntimePlugin(
      options,
      {
        key: threadRuntimeSlotKey,
        acquire: (integration, create) =>
          integration.acquireSharedSlot(threadRuntimeSlotKey, threadRuntimeSlotFamily, create)
      },
      createThreadPeer as Parameters<typeof createRuntimePlugin>[2]
    )
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
