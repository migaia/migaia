import type { RpcSendOptions, RpcTransport } from '../transport.js';

/**
 * Minimal event-listener worker/port surface — a real `Worker`, `MessagePort`, or
 * `SharedWorker.port` all satisfy this. Deliberately not `Worker` itself: shared workers and ports
 * must not use a mutable `onmessage` slot (that would silently steal another listener's
 * subscription), and this file has no other DOM dependency beyond the ambient
 * `Transferable`/`MessageEvent` types.
 */
export type WebWorkerLikePort = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
};

/**
 * Wraps a Worker/MessagePort-like object as an `RpcTransport`. `error` and `messageerror` (script
 * failure, structured-clone failure) have no message payload of their own — they're surfaced
 * through `onTransportError`, which the endpoint uses to fail every pending call at once instead of
 * leaving them hanging with no response ever coming.
 */
export function createWebWorkerTransport(
  port: WebWorkerLikePort
): RpcTransport<unknown, Transferable> {
  const messageListeners = new Set<(message: unknown) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  const listenerErrors = new Set<(error: unknown) => void>();

  const emitTransportError = (error: unknown): void => {
    for (const listener of [...errorListeners]) {
      try {
        listener(error);
      } catch {}
    }
  };

  // `event` is an external boundary — a real MessageEvent never throws
  // reading `.data`, but a hostile/mocked event object (or a getter that
  // itself throws) must not be allowed to escape as an uncaught exception
  // from inside the port's own event dispatch. Routed through
  // `onTransportError` rather than silently dropped: a message that could
  // not even be read is exactly the kind of thing pending callers need to
  // know happened, not have quietly vanish.
  const onMessage = (event: MessageEvent<unknown> | Event): void => {
    let data: unknown;
    try {
      data = (event as MessageEvent<unknown> | undefined)?.data;
    } catch (error) {
      emitTransportError(new Error(`[rpc] worker message could not be read: ${String(error)}`));
      return;
    }
    for (const listener of [...messageListeners]) {
      try {
        listener(data);
      } catch (error) {
        for (const report of [...listenerErrors]) {
          try {
            report(error);
          } catch {}
        }
      }
    }
  };
  const onFailure =
    (reason: string) =>
    (event: Event): void => {
      let detail: string;
      try {
        detail = (event as unknown as { message?: string } | undefined)?.message || reason;
      } catch {
        detail = reason;
      }
      emitTransportError(new Error(`[rpc] worker ${reason}: ${detail}`));
    };
  const onError = onFailure('failed');
  const onMessageError = onFailure('could not deserialize a message');

  return {
    send(message, options?: RpcSendOptions<Transferable>) {
      port.postMessage(message, options?.transfer);
    },
    // Attached lazily on first subscriber, detached once the last one
    // leaves — a client that closes must not leave the underlying port
    // still holding real listeners it can no longer reach.
    subscribe(listener) {
      if (messageListeners.size === 0) port.addEventListener('message', onMessage);
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
        if (messageListeners.size === 0) port.removeEventListener('message', onMessage);
      };
    },
    onTransportError(listener) {
      if (errorListeners.size === 0) {
        port.addEventListener('error', onError);
        port.addEventListener('messageerror', onMessageError);
      }
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
        if (errorListeners.size === 0) {
          port.removeEventListener('error', onError);
          port.removeEventListener('messageerror', onMessageError);
        }
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  };
}
