import { describe, expect, it } from 'vitest';
import { createEndpoint } from './factory';
import { connect } from './middleware/connect';
import type { IWebRpcTransport } from './transport';

const transport = (): IWebRpcTransport => ({
  send() {},
  subscribe() {
    return () => undefined;
  }
});

describe('factory', () => {
  it('requires explicit id, connect and transport', async () => {
    await expect(createEndpoint({ id: 'x', middlewares: [] })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [connect({ transport: transport() })]
    });
    await endpoint.dispose();
  });
  it('installs middleware serially and rejects duplicates', async () => {
    const order: string[] = [];
    const middleware = (name: string) => ({
      name,
      install: async () => {
        order.push(name);
      }
    });
    const endpoint = await createEndpoint({
      id: 'x',
      middlewares: [connect({ transport: transport() }), middleware('a'), middleware('b')]
    });
    expect(order).toEqual(['a', 'b']);
    await endpoint.dispose();
    await expect(
      createEndpoint({
        id: 'x',
        middlewares: [connect({ transport: transport() }), middleware('a'), middleware('a')]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
