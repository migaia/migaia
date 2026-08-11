import type { IWebRpcMiddleware, IWebRpcUuidConfig } from '../typing';
import { WebRpcCapabilityKey } from '../internal/runtime';
import { WebRpcError, WebRpcErrorCode } from '../errors';
export const uuid = (config: IWebRpcUuidConfig = {}): IWebRpcMiddleware => ({
  name: 'uuid',
  install: ({ capabilities }) => {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid descriptor is invalid');
    let generate: IWebRpcUuidConfig['generate'];
    try {
      generate = config.generate;
    } catch (error) {
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid descriptor is unreadable', error);
    }
    if (generate !== undefined && typeof generate !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid generate must be a function');
    capabilities.set(WebRpcCapabilityKey.uuid, { generate });
  }
});
