import type { IWebRpcAbortCapability, IWebRpcMiddleware } from '../typing';
import { WebRpcCapabilityKey } from '../internal/runtime';
export const abort = (): IWebRpcMiddleware => ({
  name: 'abort',
  install: ({ capabilities }) => {
    const capability: IWebRpcAbortCapability = { enabled: true };
    capabilities.set(WebRpcCapabilityKey.abort, capability);
    capabilities.set(WebRpcCapabilityKey.abortCapability, capability);
  }
});
