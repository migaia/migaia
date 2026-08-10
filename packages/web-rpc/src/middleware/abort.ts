import type { IWebRpcMiddleware } from '../typing';
export const abort = (): IWebRpcMiddleware => ({ name: 'abort', install: () => undefined });
