import type {
  IRpcPlugin,
  IRpcPluginInstallResult,
  IRpcTimeoutCapability,
  IRpcTimeoutConfig
} from '../typing.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'

const timeoutClaims = Object.freeze({
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
})

/** Snapshots timeout getters once at native or legacy installation time. */
function snapshotTimeout(
  config: IRpcTimeoutConfig
): { readonly timeoutMs?: number | false } | { readonly error: RpcError } {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return {
      error: new RpcError(RpcCoreErrorCode.invalidConfig, 'timeout descriptor is invalid')
    }
  let timeoutMs: IRpcTimeoutConfig['timeoutMs']
  try {
    timeoutMs = config.timeoutMs
  } catch (error) {
    return {
      error: new RpcError(RpcCoreErrorCode.invalidConfig, 'timeout descriptor is unreadable', error)
    }
  }
  try {
    return Object.freeze({ timeoutMs })
  } catch (error) {
    return {
      error: new RpcError(RpcCoreErrorCode.invalidConfig, 'timeout descriptor is unreadable', error)
    }
  }
}

/** Validates one factory snapshot and creates the immutable native timeout port. */
function createTimeoutPlugin(config: IRpcTimeoutConfig): IRpcPlugin {
  return Object.freeze({
    name: 'middleware:timeout',
    metadata: Object.freeze({ claims: timeoutClaims, sharedProvides: [RpcPortName.timeout] }),
    install: (): IRpcPluginInstallResult => {
      const snapshot = snapshotTimeout(config)
      if ('error' in snapshot) throw snapshot.error
      const { timeoutMs } = snapshot
      if (
        timeoutMs !== undefined &&
        timeoutMs !== false &&
        (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      )
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          'timeoutMs must be false or a non-negative number'
        )
      const port: IRpcTimeoutCapability = Object.freeze({
        timeoutMs,
        resolveTimeout: (override) => (override === undefined ? timeoutMs : override)
      })
      return {
        extension: Object.freeze({}),
        ports: Object.freeze({ [RpcPortName.timeout]: port })
      }
    }
  })
}

/** Creates the native timeout plugin and retains its legacy middleware call shape. */
export const timeout = (config: IRpcTimeoutConfig = {}): IRpcPlugin =>
  freezePlugin(createTimeoutPlugin(config))
