import { threadRuntimeResource } from './runtime-resource.js'
import type { IThreadRuntimeResource } from './runtime-types.js'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '@migaia/rpc-core/remote'
import type { createRuntimePlugin, IRuntimePluginOptions } from '@migaia/rpc-core/remote'
import { assembleAdapterPlugin } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey } from '@migaia/rpc-core/remote'
import { createThreadPeer } from './peer.js'
import type { IRuntimeThreadPeerOptions } from './runtime-peer.js'
import { threadMessageAdapter } from './adapter.js'

/** This physical owner alone retains the stable family token for its actual Host slot operation. */
const threadRuntimeSlotFamily = Object.freeze({})

/** Capture the canonical namespace once; descriptive resource fields cannot retarget this operation. */
const threadRuntimeSlotKey = RuntimePluginKey.thread

/** Symmetric Plugin options share the Peer source grammar and default to an empty Feature exposure. */
export type IRuntimeThreadPluginOptions = Omit<
  IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>,
  'report'
> &
  Readonly<{ report?: (error: unknown) => void }>

/** Install a symmetric connection into the original canonical thread slot. */
export function createThreadPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('@migaia/rpc-core/remote').IRuntimePeerProvide = Record<
    never,
    never
  >,
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
    }>,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'> {
  return assembleAdapterPlugin(
    threadMessageAdapter,
    options as IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>,
    {
      key: threadRuntimeSlotKey,
      acquire: (integration, create) =>
        integration.acquireSharedSlot(threadRuntimeSlotKey, threadRuntimeSlotFamily, create)
    },
    (peerOptions) =>
      createThreadPeer(peerOptions as IRuntimeThreadPeerOptions, runtime) as ReturnType<
        NonNullable<Parameters<typeof createRuntimePlugin>[2]>
      >
  ) as ReturnType<typeof createRuntimePlugin> &
    IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
}
