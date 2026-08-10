import type { IWebRpcMiddleware } from '../typing';
export const ping = (): IWebRpcMiddleware => ({ name: 'ping', install: () => undefined });
