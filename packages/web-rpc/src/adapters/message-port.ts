import type { RpcSendOptions, RpcTransport } from '../transport.js';

/**
 * Structural shape of Node's `worker_threads.MessagePort` (and close enough to `EventEmitter`
 * generally) — deliberately not imported from `node:worker_threads` itself, since this package's
 * app build has no Node lib/types configured and must stay usable in a browser-only build. Any
 * object with this shape works, including a real Node MessagePort at runtime.
 */
export type NodeMessagePortLike = {
  postMessage(message: unknown, transferList?: readonly unknown[]): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'messageerror' | 'close', listener: (error?: unknown) => void): unknown;
  off(event: 'message' | 'messageerror' | 'close', listener: (...args: unknown[]) => void): unknown;
};

/** Wraps a Node `worker_threads.MessagePort` (or anything with the same shape) as an `RpcTransport`. */
export function createNodeMessagePortTransport(port: NodeMessagePortLike): RpcTransport {
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

  const onMessage = (message: unknown): void => {
    for (const listener of [...messageListeners]) {
      try {
        listener(message);
      } catch (error) {
        for (const report of [...listenerErrors]) {
          try {
            report(error);
          } catch {}
        }
      }
    }
  };
  // `error` here is an external boundary the same way a DOM event is —
  // stringifying it must not itself throw and escape as an uncaught
  // exception from inside Node's event emitter dispatch.
  const onMessageError = (error?: unknown): void => {
    let detail = '';
    if (error !== undefined) {
      try {
        detail = `: ${String(error)}`;
      } catch {
        detail = ': (error could not be stringified)';
      }
    }
    emitTransportError(new Error(`[rpc] message port could not deserialize a message${detail}`));
  };
  const onClose = (): void => {
    emitTransportError(new Error('[rpc] message port closed'));
  };

  return {
    send(message, options?: RpcSendOptions) {
      port.postMessage(message, options?.transfer);
    },
    // Lazily attached/detached the same way as the web-worker adapter —
    // a client that closes must not leave the underlying port still
    // referencing listeners it can no longer reach.
    subscribe(listener) {
      if (messageListeners.size === 0) port.on('message', onMessage);
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
        if (messageListeners.size === 0) port.off('message', onMessage);
      };
    },
    onTransportError(listener) {
      if (errorListeners.size === 0) {
        port.on('messageerror', onMessageError);
        port.on('close', onClose);
      }
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
        if (errorListeners.size === 0) {
          port.off('messageerror', onMessageError);
          port.off('close', onClose);
        }
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  };
}
