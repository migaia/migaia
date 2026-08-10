import type { IWebRpcEventListener, IWebRpcProvider } from '../typing';
export type IProviderTable = {
  readonly providers: Map<string, IWebRpcProvider>;
  readonly events: Map<string, IWebRpcEventListener[]>;
};
