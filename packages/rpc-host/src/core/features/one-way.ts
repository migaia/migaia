import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcFeature } from '../feature.js'
import type { IEndpointCapabilitiesFeatureExpose } from '../internal/endpoint-capabilities-plugin.js'
import { defineRpcFeature } from '../internal/define-rpc-feature.js'
import type {
  IOneWayCapability,
  IOneWayInstallation,
  IOutboundCapability
} from '../internal/feature-contract.js'

/**
 * Optional transfer elements whose identity/order reach the canonical sender; that sender captures
 * the caller list into its own immutable snapshot before physical transport.
 */
export type IRpcOneWayOptions = Readonly<{
  /** Physical ownership transfer remains exclusively validated by the existing sender. */
  transfer?: readonly unknown[]
  /** Cancellation controls only local send admission; it is never sent as business data. */
  signal?: IAbortSignal
  /** Only an explicit deadline limits physical send; false keeps the original unbounded send. */
  timeoutMs?: number | false
}>

/** Public surface added only when callers select the one-way endpoint preset. */
export type IOneWaySurface = Readonly<{
  sendOneWay: (
    targetId: string,
    method: string,
    data: unknown,
    options?: IRpcOneWayOptions
  ) => Promise<void>
}>

/** Own one optional one-way Feature's deferred native registration. */
class OneWayFeatureInstallation {
  /** The original outbound capability supplies the sole send and identity owner. */
  #dependencies: { readonly outbound: IOutboundCapability }
  /** Repeated preparation returns the original frozen installation by identity. */
  #installation: IOneWayInstallation | undefined
  /** The original one-method capability remains callable without a receiver. */
  readonly value: IOneWayCapability
  /** Capture native dependency outputs before preparing any endpoint resources. */
  constructor(dependencies: { readonly outbound: IOutboundCapability }) {
    this.#dependencies = dependencies
    this.value = Object.freeze({ prepare: this.#prepare })
  }
  /** Prepare the existing outbound dependency once and publish the original one-way projection. */
  #prepare = (scope: import('../typing.js').IRpcPluginInstallScope): IOneWayInstallation => {
    if (this.#installation) return this.#installation
    /** Prepare the canonical outbound dependency before publishing any dependent surface. */
    const outbound = this.#dependencies.outbound.prepare(scope)
    const publicSurface: IOneWaySurface = Object.freeze({
      sendOneWay: (targetId, method, data, options) =>
        outbound.outboundOperations.send({
          kind: 'one-way',
          targetId,
          method,
          data,
          ...(options?.transfer === undefined ? {} : { transfer: options.transfer }),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
        })
    })
    const preparedInstallation: IOneWayInstallation = Object.freeze({ public: publicSurface })
    this.#installation = preparedInstallation
    return preparedInstallation
  }
}

/** Native optional one-way Feature reuses the direct outbound capability rather than shared lookup. */
export const createOneWayFeature = (
  outboundCapability: IRpcFeature<IOutboundCapability>
): IRpcFeature<
  IOneWayCapability,
  { readonly outbound: IRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IOneWayCapability,
    { readonly outbound: IRpcFeature<IOutboundCapability> },
    IEndpointCapabilitiesFeatureExpose
  >(
    {
      publicKeys: ['sendOneWay'],
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: ['sendOneWay'],
        exposedKeys: [],
        activator: false
      }
    },
    (_core, dependencies) => new OneWayFeatureInstallation(dependencies).value,
    { outbound: outboundCapability }
  )
