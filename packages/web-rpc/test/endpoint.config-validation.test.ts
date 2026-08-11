import { describe, expect, it } from 'vitest';
import { WebRpcEndpoint } from '../src/endpoint';
import type { IWebRpcTransport } from '../src/transport';

/** Creates a minimal valid physical boundary for constructor validation tests. */
const transport = (): IWebRpcTransport => ({
  platform: 'Memory',
  send() {},
  subscribe: () => () => undefined
});

/** Constructs one endpoint from intentionally hostile, runtime-only options. */
const construct = (options: unknown = {}, endpointTransport: unknown = transport()): void => {
  new WebRpcEndpoint('host', endpointTransport as IWebRpcTransport, undefined, options as never);
};

describe('endpoint configuration boundary', () => {
  it.each([
    ['missing send', { platform: 'Memory', subscribe: () => () => undefined }],
    ['missing subscribe', { platform: 'Memory', send() {} }],
    ['invalid close', { ...transport(), close: true }],
    ['invalid transport error hook', { ...transport(), onTransportError: true }],
    ['invalid listener error hook', { ...transport(), onListenerError: true }],
    ['invalid platform', { ...transport(), platform: 'Unknown' }],
    ['invalid topology', { ...transport(), topology: 'shared' }],
    ['invalid origin', { ...transport(), origin: 1 }],
    ['invalid encoded type', { ...transport(), encodedType: 'json' }],
    ['invalid ownership', { ...transport(), ownership: 'shared' }]
  ])('rejects %s transport metadata', (_label, candidate) => {
    expect(() => construct({}, candidate)).toThrow();
  });

  it.each(['contract', 'uuid', 'protocol', 'timeout', 'hooks', 'chunk', 'features'])(
    'rejects a non-object %s descriptor',
    (name) => {
      expect(() => construct({ [name]: null })).toThrow();
      expect(() => construct({ [name]: [] })).toThrow();
    }
  );

  it('rejects malformed provider and codec descriptors', () => {
    expect(() => new WebRpcEndpoint('host', transport(), [] as never)).toThrow();
    expect(() => construct({ contract: { validateData: true } })).toThrow('validateData');
    expect(() => construct({ uuid: { generate: true } })).toThrow('uuid.generate');
    expect(() => construct({ protocol: { encode: true } })).toThrow('protocol.encode');
    expect(() => construct({ protocol: { decode: true } })).toThrow('protocol.decode');
    expect(() => construct({ protocol: { encodedType: 'json' } })).toThrow('encodedType');
    expect(() => construct({ authentication: { enabled: false } })).toThrow('authentication');
    expect(() => construct({ authentication: { enabled: true, encodedType: 'json' } })).toThrow(
      'authentication'
    );
    expect(() =>
      construct(
        { protocol: { encodedType: 'string' } },
        { ...transport(), encodedType: 'uint8array' }
      )
    ).toThrow('incompatible');
  });

  it.each([
    null,
    [],
    { shouldRetry: true },
    { delay: true },
    { maxAttempts: 0 },
    { maxAttempts: Number.NaN }
  ])('rejects malformed retry configuration %#', (retry) => {
    expect(() => construct({ timeout: { retry } })).toThrow();
  });

  it('rejects malformed timeout and hook callbacks', () => {
    expect(() => construct({ timeout: { resolveTimeout: true } })).toThrow('resolveTimeout');
    expect(() => construct({ hooks: { listeners: true } })).toThrow('hooks');
    expect(() => construct({ hooks: { listeners: [() => undefined, true] } })).toThrow('hooks');
    expect(() => construct({ hooks: { onHookError: true } })).toThrow('hooks');
    expect(() => construct({ initialHookEvents: {} })).toThrow('initialHookEvents');
  });

  it.each([
    'chunkSize',
    'maxMessageBytes',
    'maxConcurrentMessages',
    'maxConcurrentMessagesPerPeer',
    'maxBufferedBytes',
    'maxChunksPerMessage',
    'maxChunkBytes',
    'assemblyTimeoutMs'
  ])('rejects invalid %s limits', (name) => {
    expect(() => construct({ chunk: { [name]: 0 } })).toThrow();
    expect(() => construct({ chunk: { [name]: 1.5 } })).toThrow();
  });

  it('rejects malformed chunk functions and undersized UTF-8 chunks', () => {
    expect(() => construct({ chunk: { chunkSize: 3 } })).toThrow('at least 4');
    expect(() => construct({ chunk: { byteLength: true } })).toThrow('byteLength');
    expect(() => construct({ chunk: { split: true } })).toThrow('split');
  });

  it('rejects malformed target and connect descriptors', () => {
    expect(() => construct({ targetIds: 'peer' })).toThrow('targetIds');
    expect(() => construct({ connect: null })).toThrow('connect descriptor');
    expect(() => construct({ connect: 1 })).toThrow('connect descriptor');
    expect(() => construct({ connect: false })).toThrow('connect descriptor');
    expect(() => construct({ connect: {} })).toThrow('transport is required');
    expect(() => construct({ connect: { transport: transport(), identifier: true } })).toThrow(
      'identifier'
    );
    expect(() => construct({ connect: { transport: transport(), verify: true } })).toThrow(
      'verify'
    );
    expect(() => construct({ connect: { transport: { ...transport(), peerId: 1 } } })).toThrow(
      'identity descriptor'
    );
    expect(() => construct({ connect: { transport: { ...transport(), origin: 1 } } })).toThrow(
      'identity descriptor'
    );
    expect(() =>
      construct({ connect: { transport: { ...transport(), topology: 'shared' } } })
    ).toThrow('identity descriptor');
  });

  it('rejects malformed feature, identity, and contract values', () => {
    expect(() => construct({ features: { abort: 'yes' } })).toThrow('features');
    expect(() => construct({ features: { ping: 'yes' } })).toThrow('features');
    expect(() => new WebRpcEndpoint('', transport())).toThrow('id');
    expect(() => new WebRpcEndpoint(1 as never, transport())).toThrow('id');
    expect(() => construct({ contract: { version: '' } })).toThrow('version');
    expect(() => construct({ contract: { version: 1 } })).toThrow('version');
    expect(() => construct({ contract: { maxIdentifierLength: 0 } })).toThrow(
      'maxIdentifierLength'
    );
    expect(() => construct({ contract: { maxIdentifierLength: 1.5 } })).toThrow(
      'maxIdentifierLength'
    );
    expect(() => construct({ contract: { acceptVersions: ['1.0', ''] } })).toThrow(
      'acceptVersions'
    );
  });

  it('accepts and snapshots every optional capability owner', async () => {
    const endpointTransport: IWebRpcTransport = {
      ...transport(),
      encodedType: 'string',
      ownership: 'owned',
      close: () => undefined,
      onTransportError: () => () => undefined,
      onListenerError: () => () => undefined
    };
    const endpoint = new WebRpcEndpoint('host', endpointTransport, {}, {
      targetIds: ['host', 'peer'],
      contract: {
        version: '2.0',
        acceptVersions: ['1.0', '2.0'],
        maxIdentifierLength: 64,
        validateData: () => undefined
      },
      uuid: { generate: () => 'id' },
      protocol: {
        encodedType: 'string',
        encode: (value: unknown) => JSON.stringify(value),
        decode: (value: unknown) => JSON.parse(String(value))
      },
      timeout: {
        timeoutMs: 10,
        resolveTimeout: (override?: number | false) => override ?? 10,
        retry: {
          maxAttempts: 2,
          shouldRetry: () => true,
          delay: () => 0
        }
      },
      hooks: {
        listeners: [() => undefined],
        onHookError: () => undefined
      },
      initialHookEvents: [{ name: 'configured', at: 1, localId: 'host' }],
      chunk: {
        chunkSize: 8,
        maxMessageBytes: 64,
        maxConcurrentMessages: 4,
        maxConcurrentMessagesPerPeer: 2,
        maxBufferedBytes: 128,
        maxChunksPerMessage: 8,
        maxChunkBytes: 8,
        assemblyTimeoutMs: 100,
        byteLength: (value: string) => value.length,
        split: (value: string) => [value]
      },
      connect: {
        transport: endpointTransport,
        uniqueTargetId: 'host-unique',
        verify: () => true
      },
      features: { abort: false, ping: false }
    } as never);
    await endpoint.dispose();
  });

  it('accepts single hook listeners and default capability implementations', async () => {
    const endpoint = new WebRpcEndpoint('host', transport(), undefined, {
      hooks: { listeners: () => undefined },
      contract: { schemas: {} },
      targetIds: []
    } as never);
    await endpoint.dispose();
  });

  it('accepts a valid authentication capability and matches its encoded type', async () => {
    const endpointTransport = { ...transport(), encodedType: 'string' as const };
    const endpoint = new WebRpcEndpoint('host', endpointTransport, undefined, {
      authentication: {
        enabled: true,
        encodedType: 'string',
        protect: async (value: unknown) => value,
        unprotect: async (value: unknown) => value
      },
      protocol: { encodedType: 'string' },
      connect: { transport: endpointTransport }
    });
    await endpoint.dispose();
  });
});
