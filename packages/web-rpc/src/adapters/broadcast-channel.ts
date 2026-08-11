import type { IWebRpcTransport } from '../transport';

/** Adapts BroadcastChannel for tab-to-tab and storage-backed coordination. */
export function createBroadcastChannelTransport(channel: BroadcastChannel): IWebRpcTransport {
  const listeners = new Set<
    (message: { data: unknown; origin?: string; source?: unknown }) => void
  >();
  const listenerErrors = new Set<(error: unknown) => void>();
  const transportErrorWrappers = new Set<EventListener>();
  const onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown;
    let origin: string | undefined;
    let source: unknown;
    try {
      data = event.data;
      origin = event.origin;
      source = event.source;
    } catch (error) {
      for (const report of Array.from(listenerErrors)) {
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
    platform: 'BroadcastChannel',
    topology: 'broadcast',
    ownership: 'borrowed',
    send(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      if (listeners.size === 0) channel.addEventListener('message', onMessage);
      listeners.add(listener);
      return () => {
        if (!listeners.has(listener)) return;
        if (listeners.size === 1) channel.removeEventListener('message', onMessage);
        listeners.delete(listener);
      };
    },
    onTransportError(listener) {
      const wrapper: EventListener = (event) => {
        try {
          listener(event);
        } catch {
          // Transport diagnostics must not escape the channel's event dispatch.
        }
      };
      channel.addEventListener('messageerror', wrapper);
      transportErrorWrappers.add(wrapper);
      return () => {
        if (!transportErrorWrappers.has(wrapper)) return;
        channel.removeEventListener('messageerror', wrapper);
        transportErrorWrappers.delete(wrapper);
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  };
}
