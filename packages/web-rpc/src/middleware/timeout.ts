import type {
  IWebRpcPlugin,
  IWebRpcPluginInstallResult,
  IWebRpcTimeoutCapability,
  IWebRpcTimeoutConfig,
  IWebRpcRetryConfig
} from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
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
):
  | { readonly timeoutMs?: number | false; readonly retry?: IWebRpcRetryConfig }
  | { readonly error: WebRpcError } {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return {
      error: new WebRpcError(WebRpcErrorCode.invalidConfig, 'timeout descriptor is invalid')
    }
  let timeoutMs: IWebRpcTimeoutConfig['timeoutMs']
  let retryConfig: IWebRpcTimeoutConfig['retry']
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
    retryConfig = config.retry
  } catch (error) {
    return {
      error: new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout.retry descriptor is unreadable',
        error
      )
    }
  }
  try {
    if (
      retryConfig !== undefined &&
      (!retryConfig || typeof retryConfig !== 'object' || Array.isArray(retryConfig))
    )
      return {
        error: new WebRpcError(WebRpcErrorCode.invalidConfig, 'timeout.retry descriptor is invalid')
      }
    const retry = retryConfig
      ? {
          maxAttempts: retryConfig.maxAttempts,
          shouldRetry: retryConfig.shouldRetry,
          delay: retryConfig.delay
        }
      : undefined
    return Object.freeze({ timeoutMs, retry: retry && Object.freeze(retry) })
  } catch (error) {
    return {
      error: new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout.retry descriptor is unreadable',
        error
      )
    }
  }
}

/** Validates one factory snapshot and creates the immutable native timeout port. */
function createTimeoutPlugin(config: IWebRpcTimeoutConfig): IWebRpcPlugin {
  return Object.freeze({
    name: 'middleware:timeout',
    metadata: Object.freeze({ claims: timeoutClaims, sharedProvides: [WebRpcSharedKey.timeout] }),
    install: (): IWebRpcPluginInstallResult => {
      const snapshot = snapshotTimeout(config)
      if ('error' in snapshot) throw snapshot.error
      const { timeoutMs, retry } = snapshot
      if (
        timeoutMs !== undefined &&
        timeoutMs !== false &&
        (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'timeoutMs must be false or a non-negative number'
        )
      if (
        retry?.maxAttempts !== undefined &&
        (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1)
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'retry maxAttempts must be a positive safe integer'
        )
      const port: IWebRpcTimeoutCapability = Object.freeze({
        timeoutMs,
        retry,
        resolveTimeout: (override) => (override === undefined ? timeoutMs : override)
      })
      return {
        extension: Object.freeze({}),
        shared: Object.freeze({ [WebRpcSharedKey.timeout]: port })
      }
    }
  })
}

/** Creates the native timeout plugin and retains its legacy middleware call shape. */
export const timeout = (config: IWebRpcTimeoutConfig = {}): IWebRpcPlugin =>
  freezePlugin(createTimeoutPlugin(config))
