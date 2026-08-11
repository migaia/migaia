import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import { WebRpcAbortError, WebRpcTimeoutError } from '../src/errors';
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../src/transport';
import type { IWebRpcAbortSignal } from '../src/typing';

function pair(): readonly [IWebRpcTransport, IWebRpcTransport] {
  const left = new Set<(message: IWebRpcInboundMessage<unknown>) => void>();
  const right = new Set<(message: IWebRpcInboundMessage<unknown>) => void>();
  const make = (
    outgoing: Set<(message: IWebRpcInboundMessage<unknown>) => void>,
    incoming: Set<(message: IWebRpcInboundMessage<unknown>) => void>,
    peerId: string
  ): IWebRpcTransport => ({
    platform: 'Memory',
    peerId,
    send(message) {
      queueMicrotask(() => {
        for (const listener of Array.from(outgoing))
          listener(message as IWebRpcInboundMessage<unknown>);
      });
    },
    subscribe(listener) {
      incoming.add(listener);
      return () => incoming.delete(listener);
    },
    close() {
      left.clear();
      right.clear();
    }
  });
  return [make(right, left, 'b'), make(left, right, 'a')];
}

describe('endpoint timeout race', () => {
  it('defaults retry attempts when the retry descriptor omits maxAttempts', async () => {
    const [clientTransport, serverTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: { retry: { shouldRetry: () => false } }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      echo: (context) => context.success(context.data)
    });
    try {
      await expect(client.send('server', 'echo', 'value')).resolves.toBe('value');
    } finally {
      await client.dispose();
      await server.dispose();
    }
  });

  it('uses a finite default deadline when timeout is omitted', async () => {
    const [clientTransport, serverTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      slow: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { ok: true, data: 'late' };
      }
    });
    try {
      await expect(client.send('server', 'slow', null)).rejects.toBeInstanceOf(WebRpcTimeoutError);
    } finally {
      await client.dispose();
      await server.dispose();
    }
  }, 2000);

  it('settles timeout before a late provider response without a second outcome', async () => {
    const [clientTransport, serverTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: { timeoutMs: 1 }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      slow: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { ok: true, data: 'late' };
      }
    });
    await expect(client.send('server', 'slow', null)).rejects.toBeInstanceOf(WebRpcTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await client.dispose();
    await server.dispose();
  });

  it('cancels an async retry policy when the endpoint is disposed', async () => {
    const [clientTransport, serverTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: {
        timeoutMs: false,
        retry: {
          maxAttempts: 2,
          shouldRetry: () => new Promise<boolean>(() => undefined)
        }
      }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      fail: () => {
        throw new Error('temporary');
      }
    });
    const pending = client.send('server', 'fail', null);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await client.dispose();
    await expect(pending).rejects.toBeInstanceOf(WebRpcAbortError);
    await server.dispose();
  });

  it('bounds an async retry policy by the caller deadline', async () => {
    const [clientTransport, serverTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: {
        timeoutMs: 5,
        retry: {
          maxAttempts: 2,
          shouldRetry: () => new Promise<boolean>(() => undefined)
        }
      }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      fail: () => {
        throw new Error('temporary');
      }
    });
    await expect(client.send('server', 'fail', null)).rejects.toBeInstanceOf(WebRpcTimeoutError);
    await client.dispose();
    await server.dispose();
  });

  it('stops retry when the retry predicate declines the failed operation', async () => {
    const [clientTransport, serverTransport] = pair();
    let attempts = 0;
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: {
        timeoutMs: 100,
        retry: {
          maxAttempts: 3,
          shouldRetry: () => false
        }
      }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      fail: () => {
        attempts += 1;
        throw new Error('temporary');
      }
    });
    await expect(client.send('server', 'fail', null)).rejects.toThrow('Provider failed');
    expect(attempts).toBe(1);
    await client.dispose();
    await server.dispose();
  });

  it('stops retry when the retry delay returns false', async () => {
    const [clientTransport, serverTransport] = pair();
    let attempts = 0;
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: {
        timeoutMs: 100,
        retry: {
          maxAttempts: 3,
          shouldRetry: () => true,
          delay: () => false
        }
      }
    });
    const server = new WebRpcEndpoint<'client'>('server', serverTransport, {
      fail: () => {
        attempts += 1;
        throw new Error('temporary');
      }
    });
    await expect(client.send('server', 'fail', null)).rejects.toThrow('Provider failed');
    expect(attempts).toBe(1);
    await client.dispose();
    await server.dispose();
  });

  it('rejects an already-aborted request before sending it', async () => {
    const [clientTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.send('server', 'never', null, {
        signal: controller.signal as unknown as IWebRpcAbortSignal
      })
    ).rejects.toBeInstanceOf(WebRpcAbortError);
    await client.dispose();
  });

  it('caps callers sharing one automatic discovery session', async () => {
    const [clientTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: { timeoutMs: false }
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 65 }, () => client.send('server', 'missing', null))
    );
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === 'rejected' &&
          (outcome.reason as { code?: unknown }).code === 'OVERLOADED'
      )
    ).toHaveLength(1);
    await client.dispose();
  });

  it('bounds an unbounded discovery caller by the session TTL', async () => {
    const [clientTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: { timeoutMs: false }
    });
    await expect(client.send('server', 'missing', null)).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    });
    await client.dispose();
  });

  it('isolates a short caller deadline from an unlimited shared-session caller', async () => {
    const [clientTransport] = pair();
    const client = new WebRpcEndpoint<'server'>('client', clientTransport, undefined, {
      timeout: { timeoutMs: false }
    });
    const short = client.send('server', 'missing', null, { timeoutMs: 5 });
    const unlimited = client.send('server', 'missing', null, { timeoutMs: false });

    await expect(short).rejects.toBeInstanceOf(WebRpcTimeoutError);
    await expect(unlimited).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' });
    await client.dispose();
  });

  it('caps distinct automatic discovery sessions globally', async () => {
    const [clientTransport] = pair();
    const client = new WebRpcEndpoint<string>('client', clientTransport, undefined, {
      timeout: { timeoutMs: false }
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 1025 }, (_, index) => client.send(`missing-${index}`, 'missing', null))
    );
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === 'rejected' &&
          (outcome.reason as { code?: unknown }).code === 'OVERLOADED'
      )
    ).toHaveLength(1);
    await client.dispose();
  });
});
