import type { IWebRpcFeature } from '../feature.js'
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
export type IWebRpcOneWayOptions = Readonly<{ transfer?: readonly unknown[] }>

/** Public surface added only when callers explicitly select {@link oneWay}. */
export type IOneWaySurface = Readonly<{
  sendOneWay: (
    targetId: string,
    method: string,
    data: unknown,
    options?: IWebRpcOneWayOptions
  ) => Promise<void>
}>

/** Native optional one-way Feature reuses the direct outbound capability rather than shared lookup. */
export const createOneWayFeature = (
  outboundCapability: IWebRpcFeature<IOutboundCapability>
): IWebRpcFeature<
  IOneWayCapability,
  { readonly outbound: IWebRpcFeature<IOutboundCapability> },
  IEndpointCapabilitiesFeatureExpose
> =>
  defineRpcFeature<
    IOneWayCapability,
    { readonly outbound: IWebRpcFeature<IOutboundCapability> },
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
    (_core, dependencies) => {
      let installation: IOneWayInstallation | undefined
      const prepare = (
        scope: import('../typing.js').IWebRpcPluginInstallScope
      ): IOneWayInstallation => {
        if (installation) return installation
        const outbound = dependencies.outbound.prepare(scope)
        const publicSurface: IOneWaySurface = Object.freeze({
          sendOneWay: (targetId, method, data, options) =>
            outbound.outboundOperations.send({
              kind: 'one-way',
              targetId,
              method,
              data,
              ...(options?.transfer === undefined ? {} : { transfer: options.transfer })
            })
        })
        const preparedInstallation: IOneWayInstallation = Object.freeze({ public: publicSurface })
        installation = preparedInstallation
        return preparedInstallation
      }
      return Object.freeze({ prepare })
    },
    { outbound: outboundCapability }
  )
