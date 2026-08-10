import type { IWebRpcMiddleware, IWebRpcProtocolConfig } from '../typing';
export const protocol = (config: IWebRpcProtocolConfig = {}): IWebRpcMiddleware => ({
  name: 'protocol',
  protocol: config,
  install: () => undefined
});
