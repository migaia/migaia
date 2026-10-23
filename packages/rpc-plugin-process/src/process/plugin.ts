import {
  createAdapterDeployment,
  createAdapterSourceConfigurationError,
  defineTransportPlugin,
  holdAdapterByteBootstrapSource,
  RpcPlatform,
  RuntimePluginKey,
  type IAdapterDeploymentContext,
  type IAdapterManagedDeployment,
  type IRpcConnectOptions,
  type IRpcTransportPlugin,
  type IRemoteBinding
} from '@migaia/rpc-host/plugin'
import { getProcessByteAdapter } from './adapter.js'
import { NativeProcessRuntimeLoader } from './runtime-loader.js'
import { openAutomaticProcessIO } from './automatic-peer.js'
import { invalidProcessRuntimeBootstrap } from './runtime-bootstrap.js'
import { isProcessChild } from './child.js'
import { normalizeProcessSources, type IProcessShortSpawn } from './adapters/short-source.js'
import {
  createSpawnProcessBinding,
  createConnectProcessBinding,
  reportSafely
} from './plugin/binding.js'
import { ProcessPluginWire } from './plugin/constants.js'
import { createNativeProcessOffer } from './offer.js'
import { openProcessListenerDeployment } from './runtime-listener.js'
import { readProcessFeatureConfiguration } from '../features/metadata.js'
import { ProcessChannelDiagnostics } from './diagnostics.js'
import { RpcProcessErrorText } from './error-text.js'
import type { IProcessCommonOptions } from './types.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
import type { IProcessPluginEstablish, IConnectProcessPluginDeployment } from './plugin/types.js'

/** Native process sources retain their existing short/full source grammar. */
export type IProcessSpawnSource = NonNullable<IRuntimeProcessPeerOptions['spawn']>
export type IProcessConnectSource = NonNullable<IRuntimeProcessPeerOptions['connect']>
export type IProcessListenSource = NonNullable<IRuntimeProcessPeerOptions['listen']>
/** Connection labels remain native-owned while callers select existing queue and logging policy. */
type IProcessIpcConfiguration = Partial<
  Pick<IProcessCommonOptions['ipc'], 'maxPendingData' | 'maxPendingControl' | 'log'>
>
/** Local host configuration and original native source defaults stay ordinary cold options. */
export type IProcessPluginCommonOptions = Omit<
  IRuntimeProcessPeerOptions,
  'spawn' | 'connect' | 'listen' | 'endpointFactory'
> &
  Omit<IProcessShortSpawn, 'entry'> &
  Readonly<{
    name?: string
    expose?: readonly string[]
    ipc?: IProcessIpcConfiguration
  }>
/** Exactly one physical source is admitted synchronously; timeout-only connect decorates any mode. */
export type IProcessPluginOptions = IProcessPluginCommonOptions &
  (
    | Readonly<{
        spawn: IProcessSpawnSource
        connect?: IRpcConnectOptions
        listen?: never
        connectToParent?: never
      }>
    | Readonly<{
        connect: IRpcConnectOptions & { target: IProcessConnectSource }
        spawn?: never
        listen?: never
        connectToParent?: never
      }>
    | Readonly<{
        listen: IProcessListenSource
        connect?: IRpcConnectOptions
        spawn?: never
        connectToParent?: never
      }>
    | Readonly<{
        connectToParent: true
        connect?: IRpcConnectOptions
        spawn?: never
        listen?: never
      }>
  )

/** Exact installed feature objects override only the corresponding original IPC fields. */
function processIpc(
  options: IProcessIpcConfiguration | undefined,
  context: IAdapterDeploymentContext
): IProcessIpcConfiguration {
  const ipc = { ...options }
  for (const feature of context.features ?? []) {
    const configured = readProcessFeatureConfiguration(feature)
    if (configured?.sendQueue?.maxPendingData !== undefined)
      ipc.maxPendingData = configured.sendQueue.maxPendingData
    if (configured?.sendQueue?.maxPendingControl !== undefined)
      ipc.maxPendingControl = configured.sendQueue.maxPendingControl
    if (configured?.log) ipc.log = configured.log.report
  }
  return ipc
}

/** Forward native preparation values into the original default/custom establish callback. */
function processEstablish(
  original: IProcessPluginEstablish,
  context: IAdapterDeploymentContext,
  ipc: IProcessIpcConfiguration
): IProcessPluginEstablish {
  return (raw, prepared) =>
    original(raw, { ...prepared, handshakeTimeoutMs: context.connectTimeoutMs, ipc })
}

/** Reuse the existing native binding; supervision and generation publication stay canonical. */
async function processManaged(
  options: IRuntimeProcessPeerOptions,
  defaults: IProcessPluginCommonOptions,
  context: IAdapterDeploymentContext
): Promise<IAdapterManagedDeployment> {
  const loaded = new NativeProcessRuntimeLoader().load()
  if (!loaded) throw createAdapterSourceConfigurationError()
  const module = await loaded
  const discovery = module.processRuntimeIO.discover()
  const resolved = await normalizeProcessSources(
    { ...options, report: options.report ?? context.configuredReport },
    discovery.runtime,
    { context },
    defaults
  )
  const ipc = processIpc(defaults.ipc, context)
  const spawn = typeof resolved.spawn === 'object' ? resolved.spawn : undefined
  const connect = typeof resolved.connect === 'object' ? resolved.connect : undefined
  if (!spawn && !connect) throw createAdapterSourceConfigurationError()
  const offer =
    spawn?.offer ??
    connect?.offer ??
    createNativeProcessOffer({
      peer: { id: context.self.instanceId, runtime: discovery.runtime },
      auth: spawn?.token ?? connect?.token,
      capabilities: context.capabilities
    })
  const report = options.report ?? context.report
  if (spawn) {
    const launcher =
      spawn.wire === ProcessPluginWire.jsonrpc
        ? spawn.supervision.launcher
        : context.launcher!(spawn.supervision.launcher, spawn.supervision.id)
    const binding = createSpawnProcessBinding(
      {
        ...spawn,
        offer,
        establish: processEstablish(spawn.establish, context, ipc),
        supervision: { ...spawn.supervision, launcher }
      },
      report
    )
    return {
      binding: binding as unknown as IRemoteBinding<unknown, unknown>,
      execution: binding.supervisor as unknown as NonNullable<
        IAdapterManagedDeployment['execution']
      >,
      bindEndpoint: (channel, endpoint, onExecution) =>
        binding.bindEndpoint(channel, endpoint, onExecution),
      beforeRelease: () => binding.drainCurrent(),
      callDeadlineCapMs: spawn.supervision.spec.limits?.callWallTimeMs
    }
  }
  const binding = createConnectProcessBinding(
    {
      ...connect!,
      offer,
      supervision:
        connect!.supervision ??
        (defaults.supervision as IConnectProcessPluginDeployment['supervision']),
      establish: processEstablish(connect!.establish, context, ipc)
    },
    report
  )
  return {
    binding: binding as unknown as IRemoteBinding<unknown, unknown>,
    bindEndpoint: (channel, endpoint, onExecution) =>
      binding.bindEndpoint(channel, endpoint, onExecution),
    beforeRelease: () => binding.drainCurrent()
  }
}

/** Define a reusable cold native transport; opening happens only in the genuine Host lifecycle. */
export function processPlugin(options: IProcessPluginOptions): IRpcTransportPlugin {
  const configured = options as IProcessPluginOptions & { connectToParent?: unknown }
  const spawn = configured?.spawn
  const listen = configured?.listen
  const connect = configured?.connect
  const target = connect && 'target' in connect ? connect.target : undefined
  const parent = configured?.connectToParent
  if (
    (parent !== undefined && parent !== true) ||
    [spawn, target, listen, parent === true ? true : undefined].filter(
      (source) => source !== undefined
    ).length !== 1 ||
    (parent === true && !isProcessChild())
  )
    throw createAdapterSourceConfigurationError()
  const {
    spawn: _spawn,
    listen: _listen,
    connect: _connect,
    connectToParent: _parent,
    ...defaults
  } = configured
  const captured = Object.freeze({
    ...defaults,
    spawn,
    listen,
    connect: target
  }) as IRuntimeProcessPeerOptions
  const source = spawn ?? target
  const mode =
    parent === true
      ? 'connect-to-parent'
      : listen !== undefined
        ? 'listen'
        : spawn !== undefined
          ? 'spawn'
          : 'connect'
  const deployment = createAdapterDeployment({
    runtimeKey: RuntimePluginKey.process,
    runtimeFamily: getProcessByteAdapter(),
    runtimeOptions: captured,
    open:
      typeof source === 'function'
        ? (context) => source(context)
        : async () => {
            throw createAdapterSourceConfigurationError()
          },
    ...(parent === true
      ? {
          bootstrap: async (context: IAdapterDeploymentContext) => {
            const loaded = new NativeProcessRuntimeLoader().load()
            if (!loaded) throw createAdapterSourceConfigurationError()
            const module = await loaded
            const discovery = module.processRuntimeIO.discover()
            const opened = await openAutomaticProcessIO({
              ...discovery,
              open: () => module.processRuntimeIO.open()
            })
            try {
              if (!opened.bootstrap) invalidProcessRuntimeBootstrap()
              return holdAdapterByteBootstrapSource(opened.channel, {
                runtime: discovery.runtime,
                platform: RpcPlatform.process,
                diagnostics: ProcessChannelDiagnostics,
                expectedStringText: RpcProcessErrorText.expectedString,
                bootstrapInvalidText: RpcProcessErrorText.runtimeBootstrapInvalid,
                ipc: processIpc(defaults.ipc, context)
              })
            } catch (primary) {
              try {
                await opened.channel.close()
              } catch (cleanup) {
                reportSafely(context.report, cleanup)
              }
              throw primary
            }
          }
        }
      : listen !== undefined
        ? {
            listen: async (context, accept) => {
              const loaded = new NativeProcessRuntimeLoader().load()
              if (!loaded) throw createAdapterSourceConfigurationError()
              const module = await loaded
              const discovery = module.processRuntimeIO.discover()
              const resolved = await normalizeProcessSources(
                captured,
                discovery.runtime,
                { context },
                defaults
              )
              if (!resolved.listen || typeof resolved.listen !== 'object')
                throw createAdapterSourceConfigurationError()
              const ingress = resolved.listen
              const originalContext = ingress.createConnectionContext
              return openProcessListenerDeployment(
                defaults,
                {
                  ...ingress,
                  createConnectionContext: (pending) => {
                    const prepared = originalContext(pending)
                    return {
                      ...prepared,
                      ipc: { ...prepared.ipc, ...processIpc(defaults.ipc, context) }
                    }
                  }
                },
                context,
                accept
              )
            }
          }
        : typeof source !== 'function'
          ? {
              managed: (context: IAdapterDeploymentContext) =>
                processManaged(captured, defaults, context)
            }
          : {})
  })
  return defineTransportPlugin({
    name: defaults.name ?? RuntimePluginKey.process,
    expose: defaults.expose,
    mode,
    connect,
    deployment
  })
}
