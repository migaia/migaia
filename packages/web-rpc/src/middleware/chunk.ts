import type { IWebRpcChunkConfig, IWebRpcMiddleware } from '../typing';
export const chunk = (config: IWebRpcChunkConfig = {}): IWebRpcMiddleware => ({
  name: 'chunk',
  chunk: config,
  install: () => undefined
});
