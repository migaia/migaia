import { describe, expect, it } from 'vitest';
import { createWindowMessageTransport } from '../../src/adapters/window';

describe('window adapter source proof', () => {
  it('accepts only the configured endpoint and origin', () => {
    const target = {
      postMessage() {}
    };
    const receiver = {
      addEventListener() {},
      removeEventListener() {}
    };
    const transport = createWindowMessageTransport({
      target,
      receiver,
      targetOrigin: 'https://peer.test'
    });
    expect(transport.topology).toBe('multiplexed');
    expect(transport.sourceProof?.(target, 'https://peer.test')).toBe(true);
    expect(transport.sourceProof?.({}, 'https://peer.test')).toBe(false);
    expect(transport.sourceProof?.(target, 'https://spoof.test')).toBe(false);
  });

  it('accepts the configured endpoint with wildcard origin but never another source', () => {
    const target = {
      postMessage() {}
    };
    const receiver = {
      addEventListener() {},
      removeEventListener() {}
    };
    const transport = createWindowMessageTransport({
      target,
      receiver,
      targetOrigin: '*',
      allowUnsafeTargetOrigin: true
    });
    expect(transport.sourceProof?.(target, 'https://any.test')).toBe(true);
    expect(transport.sourceProof?.({}, 'https://any.test')).toBe(false);
  });

  it('registers inbound listeners on the receiver rather than the outbound target', () => {
    const registrations: string[] = [];
    const target = { postMessage() {} };
    const receiver = {
      addEventListener(type: 'message') {
        registrations.push(`add:${type}`);
      },
      removeEventListener(type: 'message') {
        registrations.push(`remove:${type}`);
      }
    };
    const transport = createWindowMessageTransport({
      target,
      receiver,
      targetOrigin: 'https://peer.test'
    });
    const unsubscribe = transport.subscribe(() => undefined);
    unsubscribe();
    expect(registrations).toEqual(['add:message', 'remove:message']);
  });

  it('forwards transfer and inbound metadata while isolating listener failures', () => {
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined;
    const sent: unknown[][] = [];
    const target = {
      postMessage(...args: unknown[]) {
        sent.push(args);
      }
    };
    const receiver = {
      addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener;
      },
      removeEventListener() {}
    };
    const transport = createWindowMessageTransport({
      target,
      receiver,
      targetOrigin: 'https://peer.test'
    });
    const failures: unknown[] = [];
    transport.onListenerError?.(() => {
      throw new Error('reporter failed');
    });
    transport.onListenerError?.((error) => failures.push(error));
    transport.subscribe(() => {
      throw new Error('listener failed');
    });
    const received: unknown[] = [];
    transport.subscribe((message) => received.push(message));
    const transfer = {} as Transferable;
    transport.send('outbound', { transfer: [transfer] });
    const source = {};
    expect(() =>
      inbound?.({ data: 'inbound', origin: 'https://peer.test', source } as MessageEvent)
    ).not.toThrow();
    expect(sent).toEqual([['outbound', 'https://peer.test', [transfer]]]);
    expect(received).toEqual([{ data: 'inbound', origin: 'https://peer.test', source }]);
    expect(failures).toHaveLength(1);
    expect(transport.onTransportError?.(() => undefined)).toBeTypeOf('function');
  });

  it('rejects empty target origins and reports hostile inbound getters', () => {
    const target = { postMessage() {} };
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined;
    const receiver = {
      addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener;
      },
      removeEventListener() {}
    };
    expect(() => createWindowMessageTransport({ target, receiver, targetOrigin: '' })).toThrow(
      'targetOrigin'
    );
    expect(() => createWindowMessageTransport({ target, receiver, targetOrigin: '*' })).toThrow(
      'allowUnsafeTargetOrigin'
    );
    const transport = createWindowMessageTransport({
      target,
      receiver,
      targetOrigin: '*',
      allowUnsafeTargetOrigin: true
    });
    const failures: unknown[] = [];
    transport.onListenerError?.((error) => failures.push(error));
    transport.subscribe(() => undefined);
    inbound?.(
      Object.defineProperty({}, 'data', {
        get: () => {
          throw new Error('hostile data');
        }
      }) as MessageEvent
    );
    expect(failures).toHaveLength(1);
  });
});
