import type { IRpcPortableValue } from '../../contract/types.js'
import type { IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOutboundCapability,
  IProviderCapability,
  IStreamCapability,
  IStreamInstallation
} from '../internal/feature-contract.js'
import { RpcStreamOwner } from '../internal/stream/owner.js'
import type { IAbortSignal } from '../internal/async-control.js'
import type { IRpcContext } from '../typing.js'

/** Connection owner answers whether a particular peer negotiated stream@1. */
export type IRpcStreamCapabilityPort = Readonly<{ supports: (peerId: string) => boolean }>

/**
 * Producer callback may return either native generator form; no synchronous iterable surface is
 * exposed.
 */
export type IRpcStreamRun = (
  params: unknown,
  context: Readonly<{ signal: IAbortSignal; context: IRpcContext }>
) => AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>

/** Optional stream runtime projected into a composed endpoint. */
export type IRpcStreamRuntime = Readonly<{
  open: (
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number }>
  ) => AsyncIterableIterator<IRpcPortableValue>
  provide: (method: string, run: IRpcStreamRun) => () => void
  dispose: () => Promise<void>
}>

/** The public key avoids colliding with ordinary endpoint provide/dispose methods. */
export type IRpcStreamSurface = Readonly<{ stream: IRpcStreamRuntime }>

/** Install the optional stream owner over the existing outbound and provider capabilities. */
export const createStreamFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>,
  providerCapability: IRpcFeature<IProviderCapability>,
  options?: Readonly<{ capability?: IRpcStreamCapabilityPort }>
): IRpcFeature<
  IStreamCapability,
  {
    readonly outbound: IRpcFeature<IOutboundCapability>
    readonly provider: IRpcFeature<IProviderCapability>
  },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature(
    {
      publicKeys: ['stream'],
      claims: {
        routes: ['stream'],
        provides: [],
        consumes: ['inbound-identity'],
        publicKeys: ['stream'],
        exposedKeys: ['stream'],
        activator: false
      }
    },
    (core, dependencies) => {
      let installation: IStreamInstallation | undefined
      return Object.freeze({
        prepare: (scope: import('../typing.js').IRpcPluginInstallScope) => {
          if (installation) return installation
          const outbound = dependencies.outbound.prepare(scope)
          const provider = dependencies.provider.prepare(scope)
          const owner = new RpcStreamOwner(
            core.featureExpose.getKernel(),
            core.featureExpose.getPrepared(),
            outbound.outboundOperations,
            provider.registerStream,
            options?.capability
          )
          scope.own(owner, () => owner.dispose())
          installation = Object.freeze({ public: Object.freeze({ stream: owner }) })
          return installation
        }
      })
    },
    { outbound: outboundCapability, provider: providerCapability }
  )
