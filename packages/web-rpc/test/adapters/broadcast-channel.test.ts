import { describe, expect, it } from 'vitest';
import { createBroadcastChannelTransport } from '../../src/adapters/broadcast-channel';

type IChannel = {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
};

describe('BroadcastChannel adapter', () => {
  it('preserves source metadata and isolates hostile event reads', () => {
    let onMessage: ((event: unknown) => void) | undefined;
    const errors: unknown[] = [];
    const channel: IChannel = {
      postMessage() {},
      addEventListener(_type, listener) {
        onMessage = listener;
      },
      removeEventListener() {}
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    expect(transport.topology).toBe('broadcast');
    transport.onListenerError?.((error) => errors.push(error));
    const received: unknown[] = [];
    transport.subscribe((message) => received.push(message));
    const source = {};
    onMessage?.({ data: 'payload', origin: 'https://peer.test', source });
    expect(received).toEqual([{ data: 'payload', origin: 'https://peer.test', source }]);
    onMessage?.(
      new Proxy(
        {},
        {
          get() {
            throw new Error('hostile event');
          }
        }
      )
    );
    expect(errors).toHaveLength(1);
    onMessage?.({
      data: new Proxy(
        {},
        {
          get() {
            throw new Error('hostile data');
          }
        }
      )
    });
    expect(errors).toHaveLength(1);
    expect(received).toHaveLength(2);
  });

  it('isolates transport-error listener failures and removes the exact wrapper', () => {
    let onMessageError: ((event: unknown) => void) | undefined;
    let removed: ((event: unknown) => void) | undefined;
    const channel: IChannel = {
      postMessage() {},
      addEventListener(type, listener) {
        if (type === 'messageerror') onMessageError = listener;
      },
      removeEventListener(type, listener) {
        if (type === 'messageerror') removed = listener;
      }
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    const unsubscribe = transport.onTransportError?.(() => {
      throw new Error('diagnostic failed');
    });
    expect(() => onMessageError?.({})).not.toThrow();
    unsubscribe?.();
    expect(removed).toBe(onMessageError);
  });

  it('keeps duplicate transport-error registrations independent', () => {
    const removed: unknown[] = [];
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(_type, listener) {
        removed.push(listener);
      }
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    const listener = () => undefined;
    const first = transport.onTransportError?.(listener);
    const second = transport.onTransportError?.(listener);
    first?.();
    expect(removed).toHaveLength(1);
    second?.();
    expect(removed).toHaveLength(2);
    expect(removed[0]).not.toBe(removed[1]);
  });

  it('shares message registration, forwards send, and isolates listener reporters', () => {
    let onMessage: ((event: unknown) => void) | undefined;
    const registrations: string[] = [];
    const sent: unknown[] = [];
    const channel: IChannel = {
      postMessage(message) {
        sent.push(message);
      },
      addEventListener(type, listener) {
        registrations.push(`add:${type}`);
        if (type === 'message') onMessage = listener;
      },
      removeEventListener(type) {
        registrations.push(`remove:${type}`);
      }
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    const failures: unknown[] = [];
    transport.onListenerError?.(() => {
      throw new Error('reporter failed');
    });
    transport.onListenerError?.((error) => failures.push(error));
    const stopFirst = transport.subscribe(() => {
      throw new Error('listener failed');
    });
    const received: unknown[] = [];
    const stopSecond = transport.subscribe((message) => received.push(message.data));
    transport.send('outbound');
    expect(() => onMessage?.({ data: 'inbound' })).not.toThrow();
    expect(sent).toEqual(['outbound']);
    expect(received).toEqual(['inbound']);
    expect(failures).toHaveLength(1);
    expect(registrations).toEqual(['add:message']);
    stopFirst();
    expect(registrations).toEqual(['add:message']);
    stopSecond();
    expect(registrations).toEqual(['add:message', 'remove:message']);
  });

  it('makes duplicate transport-error cleanup idempotent', () => {
    let removals = 0;
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {},
      removeEventListener() {
        removals += 1;
      }
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    const stop = transport.onTransportError?.(() => undefined);
    stop?.();
    stop?.();
    expect(removals).toBe(1);
  });

  it('retains a subscription when final listener removal fails so it can be retried', () => {
    let attempts = 0;
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {},
      removeEventListener() {
        attempts += 1;
        if (attempts === 1) throw new Error('remove failed');
      }
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);
    const unsubscribe = transport.subscribe(() => undefined);

    expect(() => unsubscribe()).toThrow('remove failed');
    expect(() => unsubscribe()).not.toThrow();
    expect(attempts).toBe(2);
  });

  it('does not retain a transport-error wrapper when registration fails', () => {
    let attempts = 0;
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {
        attempts += 1;
        if (attempts === 1) throw new Error('messageerror registration failed');
      },
      removeEventListener() {}
    };
    const transport = createBroadcastChannelTransport(channel as BroadcastChannel);

    expect(() => transport.onTransportError?.(() => undefined)).toThrow(
      'messageerror registration failed'
    );
    expect(() => transport.onTransportError?.(() => undefined)).not.toThrow();
    expect(attempts).toBe(2);
  });
});
