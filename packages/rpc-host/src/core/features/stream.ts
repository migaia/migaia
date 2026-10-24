import type { IFeatureCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
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
import type { IRpcContext } from '../typing.js'

/** Connection owner answers whether a particular peer negotiated stream@1. */
export type IRpcStreamCapabilityPort = Readonly<{
  /** Check this direct peer's actual stream agreement. */ supports: (peerId: string) => boolean
}>

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
  /** Open one negotiated stream; the caller owns iteration and early return cleanup. */
  open: (
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number | false }>
  ) => AsyncIterableIterator<IRpcPortableValue>
  /** Register a stream producer and return the remover for that method registration. */
  provide: (method: string, run: IRpcStreamRun) => () => void
  /** Retire this stream owner and settle/cancel its retained producer and consumer work. */
  dispose: () => Promise<void>
}>

/** The public key avoids colliding with ordinary endpoint provide/dispose methods. */
export type IRpcStreamSurface = Readonly<{
  /** Original endpoint-owned producer/consumer runtime. */ stream: IRpcStreamRuntime
}>

/** Own one optional stream Feature's deferred native stream attachment. */
class StreamFeatureInstallation {
  /** The native Feature core lends the actual endpoint kernel and prepared configuration. */
  #core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>
  /** Original outbound and provider capabilities remain the only send and registration owners. */
  #dependencies: { readonly outbound: IOutboundCapability; readonly provider: IProviderCapability }
  /** The original options reference is read at preparation time, preserving its existing policy. */
  #options: Readonly<{ capability?: IRpcStreamCapabilityPort }> | undefined
  /** All stream projections retain the same first prepared installation. */
  #installation: IStreamInstallation | undefined
  /** The original frozen preparation capability remains detached-call safe. */
  readonly value: IStreamCapability
  /** Capture native inputs without creating an eager stream owner. */
  constructor(
    core: IFeatureCore<IEndpointCapabilitiesFeatureExpose>,
    dependencies: {
      readonly outbound: IOutboundCapability
      readonly provider: IProviderCapability
    },
    options: Readonly<{ capability?: IRpcStreamCapabilityPort }> | undefined
  ) {
    this.#core = core
    this.#dependencies = dependencies
    this.#options = options
    this.value = Object.freeze({ prepare: this.#prepare })
  }
  /** Prepare one canonical stream owner under the existing outbound/provider lifetime. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IStreamInstallation => {
    if (this.#installation) return this.#installation
    /** Prepare the canonical outbound dependency before publishing any dependent surface. */
    const outbound = this.#dependencies.outbound.prepare(scope)
    /** Keep the canonical provider attachment as the registration and execution owner. */
    const provider = this.#dependencies.provider.prepare(scope)
    /** Own stream registration and cleanup in the original kernel scope. */
    const owner = new RpcStreamOwner(
      this.#core.featureExpose.getKernel(),
      this.#core.featureExpose.getPrepared(),
      outbound.outboundOperations,
      provider.registerStream,
      this.#options?.capability
    )
    scope.own(owner, () => owner.dispose())
    this.#installation = Object.freeze({ public: Object.freeze({ stream: owner }) })
    return this.#installation
  }
}

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
    (core, dependencies) => new StreamFeatureInstallation(core, dependencies, options).value,
    { outbound: outboundCapability, provider: providerCapability }
  )
