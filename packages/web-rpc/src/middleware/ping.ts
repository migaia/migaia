import type { IWebRpcMiddleware, IWebRpcPingCapability } from '../typing.js';
import { WebRpcCapabilityKey } from '../internal/runtime.js';
export type IPingMiddleware = IWebRpcMiddleware & { readonly pingCapability: true };
export const ping = (): IPingMiddleware => ({
  name: 'ping',
  pingCapability: true,
  install: ({ capabilities }) => {
    const capability: IWebRpcPingCapability = { enabled: true };
    capabilities.set(WebRpcCapabilityKey.ping, capability);
    capabilities.set(WebRpcCapabilityKey.pingCapability, capability);
  }
});
