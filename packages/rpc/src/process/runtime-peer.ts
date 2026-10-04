import type { IProcessHandle } from '@migaia/supervision/process'
import { defaultRpcId } from '../core/internal/id.js'
import { RpcError, RpcCoreErrorCode } from '../core/errors.js'
import { RuntimeApiErrorText, RuntimePluginKey } from '../remote/runtime-api/constants.js'
import { createManagedRuntimePeer } from '../remote/runtime-api/managed-peer.js'
import {
  prepareRuntimePeerSourceContext,
  readRuntimePeerConnection,
  type IRuntimePeerOptions,
  type IRuntimePeerSource
} from '../remote/runtime-api/peer.js'
import { withRuntimeLaunchContext } from '../remote/runtime-api/launch-context.js'
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

/**
 * Public deployed sources reuse the original native spawn and borrowed socket-session
 * specifications.
 */
export type IRuntimeProcessPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect'
> &
  Readonly<{
    spawn?: IRuntimePeerSource | ISpawnProcessPluginDeployment<THandle>
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment
  }>

/** Real execution and local socket sessions retain their existing independent supervision owners. */
export function createProcessSourcePeer<THandle extends IProcessHandle>(
  options: IRuntimeProcessPeerOptions<THandle>,
  runtime: string
) {
  /** Multiple or unsupported source specifications fail before any original launcher or dial starts. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length !== 1 || typeof sources[0] !== 'object' || options.listen)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** Parent identity is local; neither bootstrap markers nor peer claims may replace it. */
  const self = options.self ?? { name: RuntimePluginKey.process, instanceId: defaultRpcId() }
  /** The actual default offer names exactly the endpoint roots implemented by the shared owner. */
  const context = prepareRuntimePeerSourceContext(self)
  /**
   * Source objects retain authentication, codecs, budgets and their caller-selected supervision
   * policy.
   */
  const spawn = typeof options.spawn === 'object' ? options.spawn : undefined
  /** Connect supervision owns a local session, never the external target process. */
  const connect = typeof options.connect === 'object' ? options.connect : undefined
  /**
   * Existing user proposals stay narrower; default native proposals include the real compiled
   * offer.
   */
  const offer =
    spawn?.offer ??
    connect?.offer ??
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
  /** Distinct unit/spec domains retain their native types while sharing one generation assembly. */
  const managed = <TUnit extends object, TSpec>(binding: IProcessPluginBinding<TUnit, TSpec>) =>
    createManagedRuntimePeer(
      {
        self,
        provide: options.provide,
        providerLimits: options.providerLimits,
        report: options.report
      },
      binding,
      (endpoint, peer) => binding.bindEndpoint(readRuntimePeerConnection(peer).channel, endpoint)
    )
  /** The canonical binding's native health and drain are kept, rather than disabled for v2. */
  return spawn
    ? managed(
        createSpawnProcessBinding(
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
                    { ...context, childName: spawn.supervision.id },
                    () => spawn.supervision.launcher.launch(spec, request)
                  )
              }
            }
          },
          options.report
        )
      )
    : managed(createConnectProcessBinding({ ...connect!, offer }, options.report))
}
