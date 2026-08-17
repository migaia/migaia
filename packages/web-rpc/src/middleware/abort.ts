import type { IWebRpcAbortCapability, IWebRpcMiddleware } from '../typing.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
export const abort = (): IWebRpcMiddleware => ({
  name: 'abort',
  install: ({ capabilities }) => {
    const capability: IWebRpcAbortCapability = { enabled: true };
    capabilities.set(WebRpcCapabilityKey.abort, capability);
    capabilities.set(WebRpcCapabilityKey.abortCapability, capability);
  }
});
