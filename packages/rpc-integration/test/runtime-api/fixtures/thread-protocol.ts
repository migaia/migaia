import { threadRuntimeResource } from '../../../../rpc-plugin-thread/dist/threads/runtime-resource.js'
import type { IThreadRuntimeResource } from '../../../../rpc-plugin-thread/dist/threads/runtime-types.js'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '../../../../rpc-host/dist/remote/runtime-api/typing.js'
import type {
  createRuntimePlugin,
  IRuntimePluginOptions
} from '../../../../rpc-host/dist/remote/runtime-api/plugin.js'
import { assembleAdapterPlugin } from '../../../../rpc-host/dist/runtime-adapter/definition.js'
import { RuntimePluginKey } from '../../../../rpc-host/dist/remote/runtime-api/constants.js'
import { createThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
import type { IRuntimeThreadPeerOptions } from '../../../../rpc-plugin-thread/dist/threads/runtime-peer.js'
import { getThreadMessageAdapter } from '../../../../rpc-plugin-thread/dist/threads/adapter.js'

/** This physical owner alone retains the stable family token for its actual Host slot operation. */
const threadRuntimeSlotFamily = Object.freeze({})

/** Capture the canonical namespace once; descriptive resource fields cannot retarget this operation. */
const threadRuntimeSlotKey = RuntimePluginKey.thread

/** Private protocol fixtures retain the original source grammar and empty Feature exposure. */
export type IThreadProtocolOptions = Omit<
  IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>,
  'report'
> &
  Readonly<{ report?: (error: unknown) => void }>

/**
 * Drive the original assembly owner for protocol fixtures that inject raw native resources. The
 * definition stays cold until installation; Host owns the shared thread outlet and release. provide
 * supplies local methods and expose defaults to no Host Feature methods. Core/PluginHost preserve
 * their own admission, generation, and cleanup errors; this factory does not add retries or
 * stronger native execution guarantees.
 */
export function threadProtocolDefinition<
  TRemote = Record<never, never>,
  const TProvide extends
    import('../../../../rpc-host/dist/remote/runtime-api/peer.js').IRuntimePeerProvide = Record<
    never,
    never
  >,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IThreadProtocolOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      /** Host-local connection name used by host.thread to select this installed plugin. */
      name: TName
      /** Optional local method tree; omission publishes no application methods. */
      provide?: TProvide
      /** Optional exact Host Feature paths; omission exposes none to the remote Worker. */
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'> {
  return assembleAdapterPlugin(
    getThreadMessageAdapter(),
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
