import type {
  IWebRpcPlugin,
  IWebRpcPluginInstallResult,
  IWebRpcTimeoutCapability,
  IWebRpcTimeoutConfig
} from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
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
  config: IWebRpcTimeoutConfig
): { readonly timeoutMs?: number | false } | { readonly error: WebRpcError } {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return {
      error: new WebRpcError(WebRpcErrorCode.invalidConfig, 'timeout descriptor is invalid')
    }
  let timeoutMs: IWebRpcTimeoutConfig['timeoutMs']
  try {
    timeoutMs = config.timeoutMs
  } catch (error) {
    return {
      error: new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout descriptor is unreadable',
        error
      )
    }
  }
  try {
    return Object.freeze({ timeoutMs })
  } catch (error) {
    return {
      error: new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout descriptor is unreadable',
        error
      )
    }
  }
}

/** Validates one factory snapshot and creates the immutable native timeout port. */
function createTimeoutPlugin(config: IWebRpcTimeoutConfig): IWebRpcPlugin {
  return Object.freeze({
    name: 'middleware:timeout',
    metadata: Object.freeze({ claims: timeoutClaims, sharedProvides: [WebRpcPortName.timeout] }),
    install: (): IWebRpcPluginInstallResult => {
      const snapshot = snapshotTimeout(config)
      if ('error' in snapshot) throw snapshot.error
      const { timeoutMs } = snapshot
      if (
        timeoutMs !== undefined &&
        timeoutMs !== false &&
        (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'timeoutMs must be false or a non-negative number'
        )
      const port: IWebRpcTimeoutCapability = Object.freeze({
        timeoutMs,
        resolveTimeout: (override) => (override === undefined ? timeoutMs : override)
      })
      return {
        extension: Object.freeze({}),
        ports: Object.freeze({ [WebRpcPortName.timeout]: port })
      }
    }
  })
}

/** Creates the native timeout plugin and retains its legacy middleware call shape. */
export const timeout = (config: IWebRpcTimeoutConfig = {}): IWebRpcPlugin =>
  freezePlugin(createTimeoutPlugin(config))
