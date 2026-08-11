import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport';
import { registerListeners, releaseListeners } from '../internal/listener-safety';

/** Minimal SharedWorker port surface accepted by the adapter. */
export type ISharedWorkerPort = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  start?(): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
};

/** Wraps a SharedWorker's `port` without importing DOM or worker globals at runtime. */
export function createSharedWorkerTransport(
  port: ISharedWorkerPort
): IWebRpcTransport<unknown, Transferable> {
  const listeners = new Set<
    (message: { data: unknown; origin?: string; source?: unknown }) => void
  >();
  const listenerErrors = new Set<(error: unknown) => void>();
  const transportErrors = new Set<(error: unknown) => void>();
  const onMessage = (event: MessageEvent<unknown> | Event): void => {
    let data: unknown;
    let origin: string | undefined;
    let source: unknown;
    try {
      data = (event as { data?: unknown }).data;
      const eventOrigin = (event as { origin?: unknown }).origin;
      origin = typeof eventOrigin === 'string' ? eventOrigin : undefined;
      source = (event as { source?: unknown }).source;
    } catch (error) {
      for (const report of Array.from(transportErrors)) {
        try {
          report(error);
        } catch {}
      }
      return;
    }
    for (const listener of Array.from(listeners)) {
      try {
        listener({
          data,
          origin: typeof origin === 'string' ? origin : undefined,
          source
        });
      } catch (error) {
        for (const report of Array.from(listenerErrors)) {
          try {
            report(error);
          } catch {}
        }
      }
    }
  };
  const onError = (): void => {
    for (const listener of Array.from(transportErrors)) {
      try {
        listener(new Error('[rpc] shared worker message error'));
      } catch {}
    }
  };
  return {
    platform: 'Worker',
    topology: 'exclusive',
    ownership: 'borrowed',
    send(message, options?: IWebRpcSendOptions<Transferable>) {
      port.postMessage(message, options?.transfer);
    },
    subscribe(listener) {
      if (listeners.size === 0) {
        registerListeners([
          { add: () => port.start?.(), remove: () => undefined },
          {
            add: () => port.addEventListener('message', onMessage),
            remove: () => port.removeEventListener('message', onMessage)
          },
          {
            add: () => port.addEventListener('messageerror', onError),
            remove: () => port.removeEventListener('messageerror', onError)
          }
        ]);
      }
      listeners.add(listener);
      return () => {
        if (!listeners.has(listener)) return;
        if (listeners.size === 1) {
          releaseListeners([
            () => port.removeEventListener('message', onMessage),
            () => port.removeEventListener('messageerror', onError)
          ]);
          listeners.delete(listener);
          return;
        }
        listeners.delete(listener);
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    },
    onTransportError(listener) {
      transportErrors.add(listener);
      return () => transportErrors.delete(listener);
    }
  };
}
