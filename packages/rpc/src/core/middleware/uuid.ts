import { RpcMiddlewareErrorText } from './error-text.js'
import type { IRpcPlugin, IRpcPluginInstallResult, IRpcUuidConfig } from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
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

/** Creates the native UUID role with an immutable install-time generator snapshot. */
function createUuidPlugin(config: IRpcUuidConfig): IRpcPlugin {
  return Object.freeze({
    name: 'middleware:uuid',
    metadata: Object.freeze({
      claims: emptyClaims,
      sharedProvides: RpcFirstPartyRoleSchema.uuid.sharedProvides,
      sharedConsumes: RpcFirstPartyRoleSchema.uuid.sharedConsumes,
      sharedOptionalConsumes: RpcFirstPartyRoleSchema.uuid.sharedOptionalConsumes
    }),
    install: (): IRpcPluginInstallResult => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcMiddlewareErrorText.uuidDescriptorIsInvalid
        )
      let generate: IRpcUuidConfig['generate']
      try {
        generate = config.generate
      } catch (error) {
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcMiddlewareErrorText.uuidDescriptorIsUnreadable,
          error
        )
      }
      if (generate !== undefined && typeof generate !== 'function')
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcMiddlewareErrorText.uuidGenerateMustBeAFunction
        )
      return {
        extension: Object.freeze({}),
        ports: Object.freeze({ [RpcPortName.uuid]: Object.freeze({ generate }) })
      }
    }
  })
}

/** Creates a UUID middleware whose generator is read only during Host installation. */
export const uuid = (config: IRpcUuidConfig = {}): IRpcPlugin =>
  freezePlugin(createUuidPlugin(config))
