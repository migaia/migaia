import type { IWebRpcHooksConfig, IWebRpcMiddleware } from '../typing';
export const hooks = (config: IWebRpcHooksConfig = {}): IWebRpcMiddleware => ({
  name: 'hooks',
  hooks: config,
  install: () => undefined
});
