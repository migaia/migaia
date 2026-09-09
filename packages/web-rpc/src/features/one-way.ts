import { defineEndpointModule, EndpointModuleKey } from '../internal/endpoint-modules.js'
import {
  WebRpcSharedKey,
  type IWebRpcOutboundOperationsPort
} from '../internal/plugin-shared-keys.js'
import { outbound } from './outbound.js'
import type { IWebRpcCoreConfig } from '../core.js'

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

/** Is the sole reusable module token for opt-in physical one-way delivery. */
const oneWayModule = defineEndpointModule<IWebRpcCoreConfig, IOneWaySurface>(
  EndpointModuleKey.oneWay,
  async ({ getShared }) => {
    /** Existing outbound owner port selected by the declared dependency. */
    const outboundOperations = getShared(
      WebRpcSharedKey.outboundOperations
    ) as IWebRpcOutboundOperationsPort
    return Object.freeze({
      sendOneWay: (
        targetId: string,
        method: string,
        data: unknown,
        options?: IWebRpcOneWayOptions
      ) => {
        /** Snapshots the caller option once before forwarding to the canonical outbound owner. */
        const transfer = options?.transfer
        return outboundOperations.send({
          kind: 'one-way',
          targetId,
          method,
          data,
          ...(transfer === undefined ? {} : { transfer })
        })
      }
    })
  },
  [outbound()],
  [],
  {
    routes: [],
    provides: [],
    consumes: [],
    publicKeys: ['sendOneWay'],
    sharedConsumes: [WebRpcSharedKey.outboundOperations],
    activator: false
  }
)

/** Returns the opt-in first-party endpoint module for physical one-way delivery. */
export function oneWay() {
  return oneWayModule
}
