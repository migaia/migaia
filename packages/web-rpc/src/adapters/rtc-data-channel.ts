import { WebRpcErrorCode, WebRpcTransportError, tagWebRpcError } from '../errors.js';
import type { IWebRpcTransport } from '../transport.js';
import { safeRead } from '../internal/safe-value.js';
import { registerListeners, releaseListeners } from '../internal/listener-safety.js';
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js';

/** Minimal RTCDataChannel surface accepted by the adapter. */
export type IRTCDataChannel = {
  send(data: string): void;
  readonly readyState: string;
  addEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void;
  removeEventListener(
    type: 'message' | 'closing' | 'close' | 'error',
    listener: (event: unknown) => void
  ): void;
};

/** Uses the reliable ordered data channel as a string-message transport. */
export function createRtcDataChannelTransport(channel: IRTCDataChannel): IWebRpcTransport {
  if (
    !channel ||
    typeof channel !== 'object' ||
    typeof channel.send !== 'function' ||
    typeof channel.readyState !== 'string' ||
    typeof channel.addEventListener !== 'function' ||
    typeof channel.removeEventListener !== 'function'
  )
    throw tagWebRpcError(
      new TypeError('RTCDataChannel must expose readyState and terminal event listeners'),
      WebRpcErrorCode.invalidConfig
    );
  if (channel.readyState !== 'open' && channel.readyState !== 'closed')
    throw tagWebRpcError(
      new TypeError('RTCDataChannel must be open before transport construction'),
      WebRpcErrorCode.invalidConfig
    );
  const listeners = new Set<(message: { data: unknown }) => void>();
  const listenerErrors = new Set<(error: unknown) => void>();
  const transportErrors = new Set<(error: unknown) => void>();
  let closed = channel.readyState === 'closed';
  let terminalReported = closed;
  let terminalError: unknown = closed ? new Error('RTCDataChannel closed') : undefined;
  let terminalListenersInstalled = false;
  const installTerminalListeners = (): void => {
    if (terminalListenersInstalled) return;
    registerListeners([
      {
        add: () => channel.addEventListener('closing', onTerminal),
        remove: () => channel.removeEventListener('closing', onTerminal)
      },
      {
        add: () => channel.addEventListener('close', onTerminal),
        remove: () => channel.removeEventListener('close', onTerminal)
      },
      {
        add: () => channel.addEventListener('error', onTerminal),
        remove: () => channel.removeEventListener('error', onTerminal)
      }
    ]);
    terminalListenersInstalled = true;
  };
  const removeTerminalListeners = (): void => {
    if (!terminalListenersInstalled) return;
    terminalListenersInstalled = false;
    releaseListeners([
      () => channel.removeEventListener('closing', onTerminal),
      () => channel.removeEventListener('close', onTerminal),
      () => channel.removeEventListener('error', onTerminal)
    ]);
  };
  const onMessage = (event: unknown): void => {
    const data = safeRead<unknown>(event, 'data');
    for (const listener of Array.from(listeners)) {
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
  const onTerminal = (event: unknown): void => {
    if (terminalReported) return;
    terminalReported = true;
    closed = true;
    listeners.clear();
    const cleanupErrors: unknown[] = [];
    try {
      channel.removeEventListener('message', onMessage);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      removeTerminalListeners();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const error = event instanceof Error ? event : new Error('RTCDataChannel closed');
    terminalError = error;
    const failures = [error, ...cleanupErrors];
    for (const failure of failures) {
      for (const report of Array.from(transportErrors)) {
        try {
          report(failure);
        } catch {}
      }
    }
  };
  return {
    platform: WebRpcPlatform.rtcDataChannel,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    get closed() {
      return closed;
    },
    encodedType: 'string',
    send(message) {
      if (closed) throw new WebRpcTransportError('RTCDataChannel is closed');
      channel.send(typeof message === 'string' ? message : JSON.stringify(message));
    },
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('RTCDataChannel is closed');
      if (listeners.size === 0) {
        installTerminalListeners();
        try {
          channel.addEventListener('message', onMessage);
        } catch (error) {
          try {
            removeTerminalListeners();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'subscription setup failed');
          }
          throw error;
        }
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          channel.removeEventListener('message', onMessage);
          if (transportErrors.size === 0) removeTerminalListeners();
        }
      };
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    },
    onTransportError(listener) {
      if (!terminalReported) installTerminalListeners();
      transportErrors.add(listener);
      if (terminalReported) {
        try {
          listener(terminalError);
        } catch {}
      }
      return () => {
        transportErrors.delete(listener);
        if (transportErrors.size === 0 && listeners.size === 0) removeTerminalListeners();
      };
    }
  };
}
