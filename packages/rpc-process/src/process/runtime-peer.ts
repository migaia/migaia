import {
  createAdapterSourceConfigurationError,
  validateAdapterPeerTimeout as readRuntimeDefaultTimeout
} from '@migaia/rpc-core/adapter'
import type { IAdapterPeerPreparation } from '@migaia/rpc-core/adapter'
import type { IProcessHandle } from '@migaia/supervision/process'
import {
  type IRuntimePeerOptions,
  type IRuntimePeerSource,
  type IRuntimePeer
} from '@migaia/rpc-core/remote'

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
import { ProcessPluginWire } from './plugin/constants.js'
import type { IProcessShortSpawn, IProcessShortSourceOptions } from './short-source.js'

/**
 * Public deployed sources reuse the original native spawn and borrowed socket-session
 * specifications.
 */
export type IRuntimeProcessFullPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen'
> &
  Readonly<{
    spawn?: IRuntimePeerSource | ISpawnProcessPluginDeployment<THandle>
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment
    listen?: IRuntimePeerSource | IRuntimeProcessListen
  }>

/** Short forms select ordinary sources; Core still captures the original options' Host provenance. */
export type IRuntimeProcessPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimeProcessFullPeerOptions<THandle>,
  'spawn' | 'connect' | 'listen' | 'report'
> &
  IProcessShortSourceOptions &
  Readonly<{
    spawn?:
      | IRuntimePeerSource
      | ISpawnProcessPluginDeployment<THandle>
      | true
      | string
      | URL
      | IProcessShortSpawn
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment | string
    listen?: IRuntimePeerSource | IRuntimeProcessListen | string
    report?(error: unknown): void
  }>

/** Real execution and local socket sessions retain their existing independent supervision owners. */
export function createProcessSourcePeer<THandle extends IProcessHandle>(
  options: IRuntimeProcessFullPeerOptions<THandle>,
  runtime: string,
  preparation: IAdapterPeerPreparation
): Promise<IRuntimePeer> {
  readRuntimeDefaultTimeout(options)
  /** Multiple or unsupported source specifications fail before any original launcher or dial starts. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length !== 1 || sources[0] === null || typeof sources[0] !== 'object')
    throw createAdapterSourceConfigurationError()
  /** Core retains the original Host/default-self provenance and compiled local proposal. */
  const context = preparation.context
  /** The actual prepared local identity is independent of the caller's display/default marker. */
  const self = context.self
  /** The listener's held deployment stays separate from spawn/connect supervision. */
  const listen = typeof options.listen === 'object' ? options.listen : undefined
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
    listen?.offer ??
    createNativeProcessOffer({
      peer: { id: self.instanceId, runtime },
      auth: spawn?.token ?? connect?.token,
      capabilities: context.capabilities
    })
  preparation.validateOffer(offer)
  if (listen)
    return createProcessListenerPeer(
      {
        self,
        provide: options.provide,
        providerLimits: options.providerLimits,
        authentication: options.authentication,
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
    execution: Parameters<IAdapterPeerPreparation['managed']>[2]
  ) =>
    preparation.managed(
      {
        self,
        provide: options.provide,
        providerLimits: options.providerLimits,
        authentication: options.authentication,
        defaultTimeoutMs: options.defaultTimeoutMs,
        contract: options.contract,
        keyFactory: options.keyFactory,
        retryPort: options.retryPort,
        endpointFactory: options.endpointFactory,
        callDeadlineCapMs: spawn?.supervision.spec.limits?.callWallTimeMs,
        report: options.report
      },
      binding,
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
          /** JSON-RPC children consume the original token frame, without native runtime bootstrap. */
          launcher:
            spawn.wire === ProcessPluginWire.jsonrpc
              ? spawn.supervision.launcher
              : preparation.launcher(spawn.supervision.launcher, spawn.supervision.id)
        }
      },
      options.report
    )
    return managed(spawnedBinding, spawnedBinding.supervisor)
  }
  return managed(createConnectProcessBinding({ ...connect!, offer }, options.report), undefined)
}
