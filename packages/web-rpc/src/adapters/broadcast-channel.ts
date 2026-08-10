import type { RpcTransport } from '../transport.js';

/** Adapts BroadcastChannel for tab-to-tab and storage-backed coordination. */
export function createBroadcastChannelTransport(channel: BroadcastChannel): RpcTransport {
  const listeners = new Set<(message: unknown) => void>();
  const onMessage = (event: MessageEvent<unknown>): void => {
    for (const listener of [...listeners]) listener(event.data);
  };
  return {
    send(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      if (listeners.size === 0) channel.addEventListener('message', onMessage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) channel.removeEventListener('message', onMessage);
      };
    },
    onTransportError(listener) {
      channel.addEventListener('messageerror', listener as EventListener);
      return () => channel.removeEventListener('messageerror', listener as EventListener);
    },
    onListenerError() {
      return () => undefined;
    }
  };
}
