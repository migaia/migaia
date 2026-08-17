import type { IWebRpcHooksConfig, IWebRpcMiddleware } from '../typing.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
import { WebRpcError, WebRpcErrorCode } from '../errors.js';
export const hooks = (config: IWebRpcHooksConfig = {}): IWebRpcMiddleware => ({
  name: 'hooks',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is invalid');
    let listenerValue: IWebRpcHooksConfig['listeners'];
    let onHookError: IWebRpcHooksConfig['onHookError'];
    try {
      listenerValue = config.listeners;
      onHookError = config.onHookError;
    } catch (error) {
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is unreadable', error);
    }
    try {
      const listeners =
        listenerValue === undefined
          ? []
          : Array.isArray(listenerValue)
            ? [...listenerValue]
            : [listenerValue];
      if (listeners.some((listener) => typeof listener !== 'function'))
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'hooks.listeners must contain functions'
        );
      if (onHookError !== undefined && typeof onHookError !== 'function')
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'hooks.onHookError must be a function'
        );
      capabilities.set(WebRpcCapabilityKey.hooks, { listeners, onHookError });
    } catch (error) {
      if (error instanceof WebRpcError) throw error;
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is invalid', error);
    }
  }
});
