import type { IWebRpcContractConfig, IWebRpcMiddleware } from '../typing';
export const contract = (config: IWebRpcContractConfig = {}): IWebRpcMiddleware => ({
  name: 'contract',
  contract: config,
  install: () => undefined
});
