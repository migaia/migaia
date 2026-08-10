import type { IWebRpcMiddleware, IWebRpcTimeoutConfig } from '../typing';
export const timeout = (config: IWebRpcTimeoutConfig = {}): IWebRpcMiddleware => ({
  name: 'timeout',
  timeout: config,
  install: () => undefined
});
