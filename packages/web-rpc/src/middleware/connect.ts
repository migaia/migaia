import type { IWebRpcMiddleware, IWebRpcConnectConfig } from '../typing';
export type IConnectConfig = IWebRpcConnectConfig;
export const connect = (config: IConnectConfig): IWebRpcMiddleware => ({
  name: 'connect',
  transport: config.transport,
  connect: config,
  install: () => undefined
});
