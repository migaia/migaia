import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry
} from '../../../../rpc-host/dist/remote/runtime-api/typing.js'
import {
  defineTransportPlugin,
  createAdapterDeployment,
  createAdapterSourceConfigurationError,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/plugin'
import { threadPlugin, type IThreadPluginOptions } from '@migaia/rpc-plugin-thread'
import { getThreadMessageAdapter } from '../../../../rpc-plugin-thread/dist/threads/adapter.js'
import { RuntimePluginKey } from '../../../../rpc-host/dist/remote/runtime-api/constants.js'
import type { IRuntimeThreadPeerOptions } from '../../../../rpc-plugin-thread/dist/threads/runtime-peer.js'
import type { IAdapterDeploymentRecipe } from '../../../../rpc-host/dist/runtime-adapter/deployment.js'

/** This physical owner alone retains the stable family token for its actual Host slot operation. */
const threadRuntimeSlotFamily = getThreadMessageAdapter()

/** Capture the canonical namespace once; descriptive resource fields cannot retarget this operation. */
const threadRuntimeSlotKey = RuntimePluginKey.thread

/** Private protocol fixtures retain the original source grammar and empty Feature exposure. */
export type IThreadProtocolOptions = IRuntimeThreadPeerOptions &
  Readonly<{
    /** Native Host registration selects this exact connection through its shared thread outlet. */
    name: string
    /** Only declared Feature paths enter the actual ordinary Host provider whitelist. */
    expose?: readonly string[]
    /** The existing raw-adapter session seam lends policy to the Host's original endpoint. */
    prepareEndpoint?: IAdapterDeploymentRecipe['prepareEndpoint']
  }>

/**
 * Install canonical cold transports for protocol fixtures that inject actual native resources. The
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
    }>
): IRpcTransportPlugin & IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'> {
  /** Three fixed source fields retain exclusive admission before a callback can acquire a resource. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (value) => value !== undefined
  )
  if (sources.length > 1) throw createAdapterSourceConfigurationError()
  /** Only test-owned raw channel callbacks use the adapter author's actual cold deployment API. */
  const source = sources.find((value) => typeof value === 'function')
  if (source === undefined)
    return threadPlugin(
      (options.spawn === undefined
        ? { ...options, spawn: undefined, connect: undefined, connectToParent: true }
        : options) as IThreadPluginOptions
    ) as IRpcTransportPlugin & IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
  /** Source callbacks remain unbound and are invoked only by the one real native Host installation. */
  const open =
    source as import('../../../../rpc-host/dist/remote/runtime-api/peer.js').IRuntimePeerSource
  return defineTransportPlugin({
    name: options.name,
    mode:
      options.listen !== undefined ? 'listen' : options.spawn !== undefined ? 'spawn' : 'connect',
    expose: options.expose,
    deployment: createAdapterDeployment({
      runtimeKey: threadRuntimeSlotKey,
      runtimeFamily: threadRuntimeSlotFamily,
      runtimeOptions: options,
      ...(options.prepareEndpoint ? { prepareEndpoint: options.prepareEndpoint } : {}),
      open: (context) => open(context)
    })
  }) as IRpcTransportPlugin & IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
}
