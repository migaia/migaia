import type { IWebRpcHookEvent } from '../typing';
export type IWebRpcRuntimeHooks = { readonly emit: (event: IWebRpcHookEvent) => void };
