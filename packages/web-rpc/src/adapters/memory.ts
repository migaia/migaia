import type { IWebRpcTransport } from '../transport';

export type IMemoryTransport = IWebRpcTransport & {
  /**
   * Tears down the whole pair — closing either side closes both; after this, `send()` on either
   * throws.
   */
  close(): void;
  readonly closed: boolean;
};

/**
 * Same-process, no-DOM transport — mainly for tests and for wiring a client and server together
 * without a real channel. Delivery is queued as a microtask (not synchronous) so behavior matches a
 * real async transport: code that assumes "the other side hasn't seen this yet" immediately after
 * `send()` returns stays correct.
 */
export function createMemoryTransportPair(): readonly [IMemoryTransport, IMemoryTransport] {
  const listenersA = new Set<(message: { data: unknown }) => void>();
  const listenersB = new Set<(message: { data: unknown }) => void>();
  let closed = false;
  const errorsA = new Set<(error: unknown) => void>(),
    errorsB = new Set<(error: unknown) => void>();
  const listenerErrorsA = new Set<(error: unknown) => void>(),
    listenerErrorsB = new Set<(error: unknown) => void>();

  const makeSide = (
    outgoing: Set<(message: { data: unknown }) => void>,
    incoming: Set<(message: { data: unknown }) => void>,
    errors: Set<(error: unknown) => void>,
    listenerErrors: Set<(error: unknown) => void>,
    remoteListenerErrors: Set<(error: unknown) => void>
  ): IMemoryTransport => ({
    platform: 'Memory',
    topology: 'exclusive',
    ownership: 'borrowed',
    send(message) {
      if (closed) throw new Error('[rpc] memory transport is closed');
      queueMicrotask(() => {
        // Closed between send() and delivery — the other side is gone,
        // there is nobody left to deliver to.
        if (closed) return;
        for (const listener of Array.from(outgoing)) {
          try {
            listener({ data: message });
          } catch (error) {
            for (const report of Array.from(remoteListenerErrors)) {
              try {
                report(error);
              } catch {}
            }
          }
        }
      });
    },
    subscribe(listener) {
      incoming.add(listener);
      return () => incoming.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const report of [...errorsA, ...errorsB]) {
        try {
          report(new Error('[rpc] memory transport is closed'));
        } catch {}
      }
      listenersA.clear();
      listenersB.clear();
    },
    get closed() {
      return closed;
    },
    onTransportError(listener) {
      errors.add(listener);
      return () => errors.delete(listener);
    },
    onListenerError(listener) {
      listenerErrors.add(listener);
      return () => listenerErrors.delete(listener);
    }
  });

  return [
    makeSide(listenersB, listenersA, errorsA, listenerErrorsA, listenerErrorsB),
    makeSide(listenersA, listenersB, errorsB, listenerErrorsB, listenerErrorsA)
  ];
}
