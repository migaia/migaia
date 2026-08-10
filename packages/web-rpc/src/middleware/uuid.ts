import type { IWebRpcMiddleware, IWebRpcUuidConfig } from '../typing';
export const uuid = (config: IWebRpcUuidConfig = {}): IWebRpcMiddleware => ({
  name: 'uuid',
  uuid: config,
  install: () => undefined
});
