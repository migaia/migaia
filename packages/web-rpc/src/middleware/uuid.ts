import type { IWebRpcPlugin, IWebRpcPluginInstallResult, IWebRpcUuidConfig } from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
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

/** Creates the native UUID role with an immutable install-time generator snapshot. */
function createUuidPlugin(config: IWebRpcUuidConfig): IWebRpcPlugin {
  return Object.freeze({
    name: 'middleware:uuid',
    metadata: Object.freeze({
      claims: emptyClaims,
      sharedProvides: WebRpcFirstPartyRoleSchema.uuid.sharedProvides,
      sharedConsumes: WebRpcFirstPartyRoleSchema.uuid.sharedConsumes,
      sharedOptionalConsumes: WebRpcFirstPartyRoleSchema.uuid.sharedOptionalConsumes
    }),
    install: (): IWebRpcPluginInstallResult => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid descriptor is invalid')
      let generate: IWebRpcUuidConfig['generate']
      try {
        generate = config.generate
      } catch (error) {
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid descriptor is unreadable', error)
      }
      if (generate !== undefined && typeof generate !== 'function')
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid generate must be a function')
      return {
        extension: Object.freeze({}),
        shared: Object.freeze({ [WebRpcSharedKey.uuid]: Object.freeze({ generate }) })
      }
    }
  })
}

/** Creates a UUID middleware whose generator is read only during Host installation. */
export const uuid = (config: IWebRpcUuidConfig = {}): IWebRpcPlugin =>
  freezePlugin(createUuidPlugin(config))
