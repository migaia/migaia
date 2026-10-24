import { RpcTransportMode } from '@migaia/rpc-host/plugin'
import { detectServerRuntime } from '@migaia/utils'
import {
  createEventEmitterMessageResource,
  createAdapterDeployment,
  defineTransportPlugin,
  holdAdapterMessageBootstrapSource,
  createAdapterSourceConfigurationError,
  RuntimePluginKey
} from '@migaia/rpc-host/plugin'
import type {
  IAdapterDeploymentContext,
  IAdapterManagedDeployment,
  IRpcConnectOptions,
  IRpcTransportPlugin,
  IRemoteBinding
} from '@migaia/rpc-host/plugin'
import { getThreadMessageAdapter } from './adapter.js'
import { isNativeThreadChild, threadWebParent, threadChildResource } from './child.js'
import { readNodeThreadRuntime, threadRuntimeResource } from './runtime-resource.js'
import { expandThreadSpawn, isShortThreadSpawn } from './short-spawn.js'
import { createThreadSourceBinding } from './runtime-peer.js'
import type { IRuntimeThreadPeerOptions, IRuntimeThreadSpawn } from './runtime-peer.js'

/**
 * Cold native source configuration retains original supervision options without endpoint
 * construction.
 */
export type IThreadCommonOptions = Omit<
  IRuntimeThreadPeerOptions,
  'spawn' | 'connect' | 'listen' | 'endpointFactory'
> &
  Readonly<{
    name?: string
    expose?: readonly string[]
    connect?: IRpcConnectOptions
  }>
/** A spawn selects an entry or original full native recipe, never a completed Peer callback. */
export type IThreadSpawnSource = Exclude<IRuntimeThreadPeerOptions['spawn'], Function | undefined>
/** Exactly one native source is selected before any Worker or channel is acquired. */
export type IThreadPluginOptions = IThreadCommonOptions &
  (
    | Readonly<{ spawn: IThreadSpawnSource; connectToParent?: never }>
    | Readonly<{ connectToParent: true; spawn?: never }>
  )

/** A reusable definition opens the original native binding with the Host's genuine launch context. */
async function threadManaged(
  options: IRuntimeThreadPeerOptions,
  context: IAdapterDeploymentContext
): Promise<IAdapterManagedDeployment> {
  /** Explicit Host diagnostics override native defaults without inventing an explicit default sink. */
  const configured = { ...options, report: options.report ?? context.configuredReport }
  /** Short entry expansion retains the original native runtime/launcher/budget selection. */
  const source = isShortThreadSpawn(configured.spawn)
    ? await expandThreadSpawn(configured, threadRuntimeResource)
    : (configured.spawn as IRuntimeThreadSpawn)
  /** The canonical binding owns every supervisor generation, health probe and drain counter. */
  const binding = createThreadSourceBinding(source, context.launcher!, context.connectTimeoutMs)
  return {
    binding: binding as unknown as IRemoteBinding<unknown, unknown>,
    keyFactory: options.keyFactory ?? source.keyFactory,
    retryPort: options.retryPort ?? source.retryPort,
    execution: binding.supervisor as unknown as IAdapterManagedDeployment['execution'],
    bindEndpoint: binding.bindEndpoint,
    beforeRelease: () => binding.drainCurrent(),
    callDeadlineCapMs: source.spec.limits?.callWallTimeMs
  }
}

/** Define one cold native transport; automatic identity comes only from the actual child's resource. */
export function threadPlugin(options: IThreadPluginOptions): IRpcTransportPlugin {
  /** Factory source admission reads no user bootstrap or copyable capability metadata. */
  const configured = options as IThreadPluginOptions & { connectToParent?: unknown }
  const spawn = configured?.spawn
  const parent = configured?.connectToParent
  if (
    detectServerRuntime() === undefined ||
    (parent !== undefined && parent !== true) ||
    [spawn, parent === true ? true : undefined].filter((source) => source !== undefined).length !==
      1 ||
    typeof spawn === 'function' ||
    (parent === true && !isNativeThreadChild())
  )
    throw createAdapterSourceConfigurationError()
  /** SDK connection options stay separate from the old native recipe's source fields. */
  const { spawn: _spawn, connectToParent: _parent, connect: _connect, ...defaults } = configured
  /** Cold native options retain the original report and feature/provider policy provenance. */
  const captured = Object.freeze({ ...defaults, spawn }) as IRuntimeThreadPeerOptions
  /** Only package-owned raw recipes can be adopted by the Host's one endpoint assembly. */
  const deployment = createAdapterDeployment({
    runtimeKey: RuntimePluginKey.thread,
    runtimeFamily: getThreadMessageAdapter(),
    runtimeOptions: captured,
    open: async () => {
      throw createAdapterSourceConfigurationError()
    },
    ...(parent === true
      ? {
          bootstrap: async (context: IAdapterDeploymentContext) => {
            /** Bun/Deno reuse child detection's existing buffered EventTarget resource. */
            const port = threadWebParent()
            if (port)
              return holdAdapterMessageBootstrapSource(threadChildResource(port), {
                connectTimeoutMs: context.connectTimeoutMs,
                report: context.report
              })
            /** Node supplies the same actual parentPort and native workerData as the original owner. */
            const native = readNodeThreadRuntime()
            if (!native?.parentPort) throw createAdapterSourceConfigurationError()
            return holdAdapterMessageBootstrapSource(
              createEventEmitterMessageResource(native.parentPort),
              {
                initial: { direction: 'inbound', read: () => native.workerData },
                connectTimeoutMs: context.connectTimeoutMs,
                report: context.report
              }
            )
          }
        }
      : { managed: (context: IAdapterDeploymentContext) => threadManaged(captured, context) })
  })
  return defineTransportPlugin({
    name: configured.name ?? RuntimePluginKey.thread,
    mode: parent === true ? RpcTransportMode['connect-to-parent'] : RpcTransportMode.spawn,
    ...(configured.expose ? { expose: configured.expose } : {}),
    ...(configured.connect ? { connect: configured.connect } : {}),
    deployment
  })
}
