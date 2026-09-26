import type { IRpcHooksConfig, IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { RpcFirstPartyRoleSchema } from '../internal/plugin-contract.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
import { createConstructionDiagnosticReporter } from '../internal/hooks.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

/** Creates the native hooks role while retaining the public legacy middleware factory shape. */
function createHooksPlugin(config: IRpcHooksConfig): IRpcPlugin {
  return Object.freeze({
    name: 'middleware:hooks',
    metadata: Object.freeze({
      claims: emptyClaims,
      sharedProvides: RpcFirstPartyRoleSchema.hooks.sharedProvides,
      sharedConsumes: RpcFirstPartyRoleSchema.hooks.sharedConsumes,
      sharedOptionalConsumes: RpcFirstPartyRoleSchema.hooks.sharedOptionalConsumes
    }),
    install: (): IRpcPluginInstallResult => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new RpcError(RpcCoreErrorCode.invalidConfig, 'hooks descriptor is invalid')
      let listenerValue: IRpcHooksConfig['listeners']
      let onHookError: IRpcHooksConfig['onHookError']
      try {
        listenerValue = config.listeners
        onHookError = config.onHookError
      } catch (error) {
        throw new RpcError(RpcCoreErrorCode.invalidConfig, 'hooks descriptor is unreadable', error)
      }
      try {
        const listeners =
          listenerValue === undefined
            ? []
            : Array.isArray(listenerValue)
              ? [...listenerValue]
              : [listenerValue]
        if (listeners.some((listener) => typeof listener !== 'function'))
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            'hooks.listeners must contain functions'
          )
        if (onHookError !== undefined && typeof onHookError !== 'function')
          throw new RpcError(RpcCoreErrorCode.invalidConfig, 'hooks.onHookError must be a function')
        const port = Object.freeze({
          listeners: Object.freeze(listeners),
          ...(onHookError === undefined ? {} : { onHookError }),
          reportConstructionDiagnostic: createConstructionDiagnosticReporter(listeners, onHookError)
        })
        return {
          extension: Object.freeze({}),
          ports: Object.freeze({ [RpcPortName.hooks]: port })
        }
      } catch (error) {
        if (error instanceof RpcError) throw error
        throw new RpcError(RpcCoreErrorCode.invalidConfig, 'hooks descriptor is invalid', error)
      }
    }
  })
}

/** Creates a hooks middleware whose config is read only during Host installation. */
export const hooks = (config: IRpcHooksConfig = {}): IRpcPlugin =>
  freezePlugin(createHooksPlugin(config))
