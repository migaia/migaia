import type {
  IWebRpcMiddleware,
  IWebRpcTimeoutCapability,
  IWebRpcTimeoutConfig
} from '../typing.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
import { WebRpcError, WebRpcErrorCode } from '../errors.js';
export const timeout = (config: IWebRpcTimeoutConfig = {}): IWebRpcMiddleware => ({
  name: 'timeout',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'timeout descriptor is invalid');
    let timeoutMs: IWebRpcTimeoutConfig['timeoutMs'];
    let retryConfig: IWebRpcTimeoutConfig['retry'];
    try {
      timeoutMs = config.timeoutMs;
      retryConfig = config.retry;
    } catch (error) {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout descriptor is unreadable',
        error
      );
    }
    try {
      if (
        retryConfig !== undefined &&
        (!retryConfig || typeof retryConfig !== 'object' || Array.isArray(retryConfig))
      )
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'timeout.retry descriptor is invalid');
    } catch (error) {
      if (error instanceof WebRpcError) throw error;
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout.retry descriptor is unreadable',
        error
      );
    }
    let retry: IWebRpcTimeoutConfig['retry'];
    try {
      retry = retryConfig ? { ...retryConfig } : undefined;
    } catch (error) {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeout.retry descriptor is unreadable',
        error
      );
    }
    if (
      timeoutMs !== undefined &&
      timeoutMs !== false &&
      (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'timeoutMs must be false or a non-negative number'
      );
    if (
      retry?.maxAttempts !== undefined &&
      (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'retry maxAttempts must be a positive safe integer'
      );
    const capability: IWebRpcTimeoutCapability = {
      timeoutMs,
      retry,
      resolveTimeout: (override) => (override === undefined ? timeoutMs : override)
    };
    capabilities.set(WebRpcCapabilityKey.timeout, capability);
    capabilities.set(WebRpcCapabilityKey.timeoutCapability, capability);
  }
});
