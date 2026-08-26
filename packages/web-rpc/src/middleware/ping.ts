import type { IWebRpcPingCapability, IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'
import { WebRpcFirstPartyRoleSchema } from '../internal/plugin-contract.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

const pingPlugin: IWebRpcPlugin = Object.freeze({
  name: 'middleware:ping',
  metadata: Object.freeze({
    claims: emptyClaims,
    sharedProvides: WebRpcFirstPartyRoleSchema.ping.sharedProvides,
    sharedConsumes: WebRpcFirstPartyRoleSchema.ping.sharedConsumes,
    sharedOptionalConsumes: WebRpcFirstPartyRoleSchema.ping.sharedOptionalConsumes
  }),
  install: (): IWebRpcPluginInstallResult => {
    const capability: IWebRpcPingCapability = Object.freeze({ enabled: true })
    return {
      extension: Object.freeze({}),
      shared: Object.freeze({ [WebRpcSharedKey.ping]: capability })
    }
  }
})

export type IPingMiddleware = IWebRpcPlugin & { readonly pingCapability: true }

/** Creates the native ping enablement role; heartbeat ownership remains with control. */
export const ping = (): IPingMiddleware => freezePlugin({ ...pingPlugin, pingCapability: true })
