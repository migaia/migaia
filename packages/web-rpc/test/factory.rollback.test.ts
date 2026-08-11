import { describe, expect, it } from 'vitest';
import { createEndpoint } from '../src/factory';
import { connect } from '../src/middleware/connect';
import type { IWebRpcTransport } from '../src/transport';

const transport = (): IWebRpcTransport => ({
  platform: 'Memory',
  send() {},
  subscribe() {
    return () => undefined;
  }
});

describe('factory rollback', () => {
  it('disposes installed middleware when endpoint construction fails', async () => {
    let disposed = 0;
    const failing = {
      name: 'failing',
      install() {
        return () => {
          disposed += 1;
        };
      }
    };
    const invalidProvider = {
      name: 'invalid-provider',
      install() {
        throw new Error('construction failed');
      }
    };
    await expect(
      createEndpoint({
        id: 'local',
        middlewares: [connect({ transport: transport() }), failing, invalidProvider]
      })
    ).rejects.toThrow();
    expect(disposed).toBe(1);
  });
});
