import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js';
import { safeRead } from '../internal/safe-value.js';
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js';

/** Outbound ServiceWorker or Client target. */
export type IServiceWorkerMessageTarget = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  readonly id?: string;
};

/** Inbound page or ServiceWorkerGlobalScope event target. */
export type IServiceWorkerMessageReceiver = {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
};

export type IServiceWorkerTransportOptions = {
  readonly target: IServiceWorkerMessageTarget;
  readonly receiver: IServiceWorkerMessageReceiver;
  readonly peerId?: string;
};

/** Wraps distinct ServiceWorker send and receive owners. */
export function createServiceWorkerTransport(
  options: IServiceWorkerTransportOptions
): IWebRpcTransport<unknown, Transferable> {
  const { target, receiver } = options;
  const peerId = options.peerId ?? target.id;
  const listeners = new Set<
    (message: { data: unknown; origin?: string; source?: unknown }) => void
  >();
  const listenerErrors = new Set<(error: unknown) => void>();
  const transportErrors = new Set<(error: unknown) => void>();
  const onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown;
    let origin: string | undefined;
    let source: unknown;
    try {
      data = event.data;
      origin = event.origin;
      source = event.source;
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
        listener({ data, origin, source });
      } catch (error) {
        for (const report of Array.from(listenerErrors)) {
          try {
            report(error);
          } catch {}
        }
      }
    }
  };
  return {
    platform: WebRpcPlatform.worker,
    topology: 'multiplexed',
    ownership: WebRpcTransportOwnership.borrowed,
    peerId,
    sourceProof: (source) =>
      source === target || (peerId !== undefined && safeRead<unknown>(source, 'id') === peerId),
    send(message, options?: IWebRpcSendOptions<Transferable>) {
      target.postMessage(message, options?.transfer);
    },
    subscribe(listener) {
      if (listeners.size === 0) receiver.addEventListener('message', onMessage);
      listeners.add(listener);
      return () => {
        if (!listeners.has(listener)) return;
        if (listeners.size === 1) receiver.removeEventListener('message', onMessage);
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
