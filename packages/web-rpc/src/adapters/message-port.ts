import { WebRpcTransportError } from '../errors.js';
import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js';
import { safeRead, safeString } from '../internal/safe-value.js';
import { registerListeners, releaseListeners } from '../internal/listener-safety.js';
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js';

/**
 * Structural shape of Node's `worker_threads.MessagePort` (and close enough to `EventEmitter`
 * generally) — deliberately not imported from `node:worker_threads` itself, since this package's
 * app build has no Node lib/types configured and must stay usable in a browser-only build. Any
 * object with this shape works, including a real Node MessagePort at runtime.
 */
export type INodeMessagePortLike = {
  postMessage(message: unknown, transferList?: readonly unknown[]): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'messageerror' | 'close', listener: (error?: unknown) => void): unknown;
  off(event: 'message' | 'messageerror' | 'close', listener: (...args: unknown[]) => void): unknown;
};

/** Browser MessagePort surface with EventTarget lifecycle. */
export type IBrowserMessagePortLike<TTransfer = unknown, TEvent = unknown> = {
  postMessage(message: unknown, transfer?: readonly TTransfer[]): void;
  start(): void;
  close(): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void;
  removeEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void;
};

/** Controls whether the browser adapter is allowed to close the supplied port. */
export type IBrowserMessagePortTransportOptions = {
  readonly ownership?: 'owned' | 'borrowed';
};

/** Wraps a browser MessagePort and owns its terminal lifecycle. */
export function createBrowserMessagePortTransport<TTransfer = unknown, TEvent = unknown>(
  port: IBrowserMessagePortLike<TTransfer, TEvent>,
  options: IBrowserMessagePortTransportOptions = {}
): IWebRpcTransport<unknown, TTransfer> {
  const messageListeners = new Set<(message: { data: unknown }) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  const listenerErrors = new Set<(error: unknown) => void>();
  let closed = false;
  const ownership = options.ownership ?? 'owned';
  const onMessage = (event: TEvent): void => {
    const data = safeRead<unknown>(event, 'data');
    for (const listener of Array.from(messageListeners)) {
      try {
        listener({ data });
      } catch (error) {
        for (const report of Array.from(listenerErrors)) {
          try {
            report(error);
          } catch {}
        }
      }
    }
  };
  const onMessageError = (): void => {
    const error = new Error('[rpc] browser message port could not deserialize a message');
    for (const report of Array.from(errorListeners)) {
      try {
        report(error);
      } catch {}
    }
  };
  const detach = (): void => {
    releaseListeners([
      () => port.removeEventListener('message', onMessage),
      () => port.removeEventListener('messageerror', onMessageError)
    ]);
  };
  return {
    platform: WebRpcPlatform.messagePort,
    topology: 'exclusive',
    ownership,
    get closed() {
      return closed;
    },
    send(message, options?: IWebRpcSendOptions<TTransfer>) {
      if (closed) throw new WebRpcTransportError('[rpc] browser message port is closed');
      port.postMessage(message, options?.transfer);
    },
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('[rpc] browser message port is closed');
      if (messageListeners.size === 0) {
        registerListeners([
          {
            add: () => port.addEventListener('message', onMessage),
            remove: () => port.removeEventListener('message', onMessage)
          },
          {
            add: () => port.addEventListener('messageerror', onMessageError),
            remove: () => port.removeEventListener('messageerror', onMessageError)
          },
          { add: () => port.start(), remove: () => undefined }
        ]);
      }
      messageListeners.add(listener);
      return () => {
        if (!messageListeners.has(listener)) return;
        if (messageListeners.size === 1) detach();
        messageListeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      messageListeners.clear();
      const cleanupErrors: unknown[] = [];
      try {
        detach();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (ownership === 'owned') {
        try {
          port.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0)
        throw new AggregateError(cleanupErrors, '[rpc] message port cleanup failed');
    },
    onTransportError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  };
}

/**
 * Wraps a Node `worker_threads.MessagePort` (or anything with the same shape) as a web-rpc
 * transport.
 */
export function createNodeMessagePortTransport(port: INodeMessagePortLike): IWebRpcTransport {
  const messageListeners = new Set<(message: { data: unknown }) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  const listenerErrors = new Set<(error: unknown) => void>();
  let closed = false;
  let terminalReported = false;
  let terminalError: Error | undefined;

  const emitTransportError = (error: unknown): void => {
    for (const listener of Array.from(errorListeners)) {
      try {
        listener(error);
      } catch {}
    }
  };

  const onMessage = (message: unknown): void => {
    for (const listener of Array.from(messageListeners)) {
      try {
        listener({ data: message });
      } catch (error) {
        for (const report of Array.from(listenerErrors)) {
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
    const detail = error === undefined ? '' : `: ${safeString(error)}`;
    emitTransportError(new Error(`[rpc] message port could not deserialize a message${detail}`));
  };
  const onClose = (): void => {
    if (terminalReported) return;
    terminalReported = true;
    closed = true;
    terminalError = new Error('[rpc] message port closed');
    emitTransportError(terminalError);
  };

  return {
    platform: WebRpcPlatform.messagePort,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    get closed() {
      return closed;
    },
    send(message, options?: IWebRpcSendOptions) {
      if (closed) throw new WebRpcTransportError('[rpc] message port is closed');
      port.postMessage(message, options?.transfer);
    },
    // Lazily attached/detached the same way as the web-worker adapter —
    // a client that closes must not leave the underlying port still
    // referencing listeners it can no longer reach.
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('[rpc] message port is closed');
      if (messageListeners.size === 0) port.on('message', onMessage);
      messageListeners.add(listener);
      return () => {
        if (!messageListeners.has(listener)) return;
        if (messageListeners.size === 1) port.off('message', onMessage);
        messageListeners.delete(listener);
      };
    },
    onTransportError(listener) {
      if (errorListeners.size === 0)
        registerListeners([
          {
            add: () => port.on('messageerror', onMessageError),
            remove: () => port.off('messageerror', onMessageError)
          },
          {
            add: () => port.on('close', onClose),
            remove: () => port.off('close', onClose)
          }
        ]);
      errorListeners.add(listener);
      if (terminalError !== undefined) {
        try {
          listener(terminalError);
        } catch {}
      }
      return () => {
        if (!errorListeners.has(listener)) return;
        if (errorListeners.size === 1) {
          releaseListeners([
            () => port.off('messageerror', onMessageError),
            () => port.off('close', onClose)
          ]);
          errorListeners.delete(listener);
          return;
        }
        errorListeners.delete(listener);
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  };
}
