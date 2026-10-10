import { readRuntimeDefaultTimeout } from '../remote/runtime-api/timeout.js'
import type { IProcessHandle } from '@migaia/supervision/process'
import { RpcRuntimeGenerationKind } from '../contract/framing/v1.js'
import { defaultRpcId } from '../core/spi.js'
import { RpcError, RpcCoreErrorCode } from '../core/index.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import { RuntimePluginKey } from '../remote/index.js'
import { createManagedRuntimePeer } from '../remote/index.js'
import { prepareRuntimePeerSourceContext } from '../remote/runtime-api/peer.js'
import { type IRuntimePeerOptions, type IRuntimePeerSource } from '../remote/index.js'
import {
  withRuntimeLaunchContext,
  readRuntimePreparationContext
} from '../remote/runtime-api/launch-context.js'
import {
  createSpawnProcessBinding,
  createConnectProcessBinding,
  type IProcessPluginBinding
} from './plugin/binding.js'
import type {
  ISpawnProcessPluginDeployment,
  IConnectProcessPluginDeployment
} from './plugin/types.js'
import { createNativeProcessOffer } from './offer.js'
import { createProcessListenerPeer, type IRuntimeProcessListen } from './runtime-listener.js'

/**
 * Public deployed sources reuse the original native spawn and borrowed socket-session
 * specifications.
 */
export type IRuntimeProcessPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen'
> &
  Readonly<{
    spawn?: IRuntimePeerSource | ISpawnProcessPluginDeployment<THandle>
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment
    listen?: IRuntimePeerSource | IRuntimeProcessListen
  }>

/** Real execution and local socket sessions retain their existing independent supervision owners. */
export function createProcessSourcePeer<THandle extends IProcessHandle>(
  options: IRuntimeProcessPeerOptions<THandle>,
  runtime: string
) {
  readRuntimeDefaultTimeout(options)
  /** Multiple or unsupported source specifications fail before any original launcher or dial starts. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length !== 1 || sources[0] === null || typeof sources[0] !== 'object')
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** Parent identity is local; neither bootstrap markers nor peer claims may replace it. */
  const listen = typeof options.listen === 'object' ? options.listen : undefined
  /** Only the genuine local Plugin scope may identify its own generated default identity. */
  const preparation = readRuntimePreparationContext(options)
  /** A caller-owned listener offer fixes the local handshake identity before bind. */
  const self =
    listen && (options.self === undefined || preparation?.selfDefaulted)
      ? { name: options.self?.name ?? RuntimePluginKey.process, instanceId: listen.offer.peer.id }
      : (options.self ?? { name: RuntimePluginKey.process, instanceId: defaultRpcId() })
  /** The actual default offer names exactly the endpoint roots implemented by the shared owner. */
  const context = prepareRuntimePeerSourceContext(self, !options.endpointFactory)
  /**
   * Source objects retain authentication, codecs, budgets and their caller-selected supervision
   * policy.
   */
  const spawn = typeof options.spawn === 'object' ? options.spawn : undefined
  /** One factory owns the child's logical namespace across accepted execution replacements. */
  const providerId = spawn ? defaultRpcId() : undefined
  /** Connect supervision owns a local session, never the external target process. */
  const connect = typeof options.connect === 'object' ? options.connect : undefined
  /**
   * Existing user proposals stay narrower; default native proposals include the real compiled
   * offer.
   */
  const offer =
    spawn?.offer ??
    connect?.offer ??
    listen?.offer ??
    createNativeProcessOffer({
      peer: { id: self.instanceId, runtime },
      auth: spawn?.token ?? connect?.token,
      capabilities: context.capabilities
    })
  if (
    offer.peer.id !== self.instanceId ||
    offer.capabilities.some((value) => !context.capabilities.includes(value))
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
  if (listen)
    return createProcessListenerPeer(
      {
        self,
        provide: options.provide,
        providerLimits: options.providerLimits,
        defaultTimeoutMs: options.defaultTimeoutMs,
        contract: options.contract,
        endpointFactory: options.endpointFactory,
        report: options.report
      },
      listen,
      preparation
    )
  /** Distinct unit/spec domains retain their native types while sharing one generation assembly. */
  const managed = <TUnit extends object, TSpec>(
    binding: IProcessPluginBinding<TUnit, TSpec>,
    execution: Parameters<typeof createManagedRuntimePeer>[5]
  ) =>
    createManagedRuntimePeer(
      {
        self,
        provide: options.provide,
        providerLimits: options.providerLimits,
        defaultTimeoutMs: options.defaultTimeoutMs,
        contract: options.contract,
        keyFactory: options.keyFactory,
        retryPort: options.retryPort,
        endpointFactory: options.endpointFactory,
        callDeadlineCapMs: spawn?.supervision.spec.limits?.callWallTimeMs,
        report: options.report
      },
      binding,
      (channel, endpoint) => binding.bindEndpoint(channel, endpoint),
      preparation,
      () => binding.drainCurrent(),
      execution
    )
  /** The canonical binding's native health and drain are kept, rather than disabled for v2. */
  if (spawn) {
    /** Only an actual spawned binding supplies native execution operations. */
    const spawnedBinding = createSpawnProcessBinding(
      {
        ...spawn,
        offer,
        supervision: {
          ...spawn.supervision,
          launcher: {
            ...spawn.supervision.launcher,
            launch: (spec, request) =>
              withRuntimeLaunchContext(
                request,
                {
                  ...context,
                  childName: spawn.supervision.id,
                  generation: {
                    kind: RpcRuntimeGenerationKind.restart,
                    value: request.executionGeneration!,
                    providerId: providerId!
                  }
                },
                () => spawn.supervision.launcher.launch(spec, request)
              )
          }
        }
      },
      options.report
    )
    return managed(spawnedBinding, spawnedBinding.supervisor)
  }
  return managed(createConnectProcessBinding({ ...connect!, offer }, options.report), undefined)
}
