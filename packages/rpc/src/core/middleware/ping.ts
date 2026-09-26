import type { IRpcPingCapability, IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'
import { RpcFirstPartyRoleSchema } from '../internal/plugin-contract.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

const pingPlugin: IRpcPlugin = Object.freeze({
  name: 'middleware:ping',
  metadata: Object.freeze({
    claims: emptyClaims,
    sharedProvides: RpcFirstPartyRoleSchema.ping.sharedProvides,
    sharedConsumes: RpcFirstPartyRoleSchema.ping.sharedConsumes,
    sharedOptionalConsumes: RpcFirstPartyRoleSchema.ping.sharedOptionalConsumes
  }),
  install: (): IRpcPluginInstallResult => {
    const capability: IRpcPingCapability = Object.freeze({ enabled: true })
    return {
      extension: Object.freeze({}),
      ports: Object.freeze({ [RpcPortName.ping]: capability })
    }
  }
})

export type IPingMiddleware = IRpcPlugin & { readonly pingCapability: true }

/** Creates the native ping enablement role; heartbeat ownership remains with control. */
export const ping = (): IPingMiddleware => freezePlugin({ ...pingPlugin, pingCapability: true })
