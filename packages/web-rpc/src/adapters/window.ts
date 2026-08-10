import type { RpcSendOptions, RpcTransport } from '../transport.js';

/** Adapts a Window-like postMessage endpoint (tabs, iframes, storage bridges). */
export type WindowMessageEndpoint = {
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
};

export function createWindowMessageTransport(
  endpoint: WindowMessageEndpoint,
  targetOrigin = '*'
): RpcTransport<unknown, Transferable> {
  const listeners = new Set<(message: unknown) => void>();
  const onMessage = (event: MessageEvent<unknown>): void => {
    for (const listener of [...listeners]) listener(event.data);
  };
  return {
    send(message, options?: RpcSendOptions<Transferable>) {
      endpoint.postMessage(message, targetOrigin, options?.transfer);
    },
    subscribe(listener) {
      if (listeners.size === 0) endpoint.addEventListener('message', onMessage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) endpoint.removeEventListener('message', onMessage);
      };
    },
    onTransportError() {
      return () => undefined;
    },
    onListenerError() {
      return () => undefined;
    }
  };
}
