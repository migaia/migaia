import { createWebTransportDatagramTransport } from '../../src/adapters/web-transport';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createEndpoint } from '../../src/factory';
import { connect } from '../../src/middleware/connect';
import { protocol } from '../../src/middleware/protocol';
import { timeout } from '../../src/middleware/timeout';
import { abort } from '../../src/middleware/abort';
import { ping } from '../../src/middleware/ping';
import { contract } from '../../src/middleware/contract';
import { chunk } from '../../src/middleware/chunk';
import type { IWebRpcContractConfig, IWebRpcEndpoint, IWebRpcProvider } from '../../src/typing';
import { installErrorGuards, terminalProviders } from './rpc';

const errors = installErrorGuards();

/** Builds an endpoint using the adapter's required Uint8Array wire codec. */
const createWebTransportRpc = (
  id: string,
  targetIds: readonly string[],
  transport: ReturnType<typeof createWebTransportDatagramTransport>,
  provider: Readonly<Record<string, IWebRpcProvider>> = {},
  contractConfig?: IWebRpcContractConfig
): Promise<IWebRpcEndpoint<string, 'automatic', true>> =>
  createEndpoint({
    id,
    targetIds,
    provider,
    middlewares: [
      connect({ transport }),
      protocol({
        encodedType: 'uint8array',
        encode: (value) => new TextEncoder().encode(JSON.stringify(value)),
        decode: (value) => JSON.parse(new TextDecoder().decode(value as Uint8Array))
      }),
      timeout({ timeoutMs: 2_000 }),
      abort(),
      ping(),
      ...(contractConfig === undefined ? [] : [contract(contractConfig)])
    ]
  }) as Promise<IWebRpcEndpoint<string, 'automatic', true>>;

/** Creates two in-memory datagram directions with the same stream contract as WebTransport. */
const createDatagramPair = () => {
  let leftToRightController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let rightToLeftController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let leftToRightClosed = false;
  let rightToLeftClosed = false;
  const leftToRightReadable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      leftToRightController = controller;
    }
  });
  const rightToLeftReadable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      rightToLeftController = controller;
    }
  });
  const leftToRightWritable = new WritableStream<Uint8Array>({
    write: (value) => {
      if (!leftToRightClosed) leftToRightController?.enqueue(value);
    },
    close: () => {
      if (leftToRightClosed) return;
      leftToRightClosed = true;
      try {
        leftToRightController?.close();
      } catch {}
    }
  });
  const rightToLeftWritable = new WritableStream<Uint8Array>({
    write: (value) => {
      if (!rightToLeftClosed) rightToLeftController?.enqueue(value);
    },
    close: () => {
      if (rightToLeftClosed) return;
      rightToLeftClosed = true;
      try {
        rightToLeftController?.close();
      } catch {}
    }
  });
  return {
    left: { writable: leftToRightWritable, readable: rightToLeftReadable },
    right: { writable: rightToLeftWritable, readable: leftToRightReadable }
  };
};

globalThis.runWebTransportScenario = async () => {
  const unsupportedChunkResult = await (async () => {
    const unsupportedTransport = createWebTransportDatagramTransport(createDatagramPair().left);
    try {
      await createEndpoint({
        id: 'unsupported-chunk',
        middlewares: [
          connect({ transport: unsupportedTransport }),
          protocol({
            encodedType: 'uint8array',
            encode: (value) => new TextEncoder().encode(JSON.stringify(value)),
            decode: (value) => JSON.parse(new TextDecoder().decode(value as Uint8Array))
          }),
          chunk({ chunkSize: 4 })
        ]
      });
      return 'resolved';
    } catch (error) {
      return (error as { readonly code?: string }).code ?? 'error';
    } finally {
      await unsupportedTransport.close?.();
    }
  })();
  const datagrams = createDatagramPair();
  const leftTransport = createWebTransportDatagramTransport(datagrams.left);
  const rightTransport = createWebTransportDatagramTransport(datagrams.right);
  const left = await createWebTransportRpc(
    'left',
    ['right'],
    leftTransport,
    {},
    {
      schemas: {
        schema: {
          params: {
            parse: () => {
              throw new Error('schema rejected');
            }
          },
          result: { parse: (value) => value }
        }
      }
    }
  );
  let dispatchCalls = 0;
  const right = await createWebTransportRpc('right', ['left'], rightTransport, {
    ...terminalProviders,
    notify: (context) => {
      dispatchCalls += 1;
      return context.success(undefined);
    }
  });
  const result = await left.send('right', 'echo', { value: 42 });
  left.dispatch('right', 'notify', { value: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const remoteError = await left.send('right', 'fail', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const timeout = await left.send('right', 'hang', null, { timeoutMs: 40 }).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const controller = new AbortController();
  const abortedPending = left.send('right', 'hang', null, { signal: controller.signal });
  controller.abort();
  const aborted = await abortedPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const schemaError = await left.send('right', 'schema', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const pingSuccess = await left.ping('right');
  const pingTimeout = await left.ping('missing', undefined, { timeoutMs: 40 });
  const pingController = new AbortController();
  const pingAbortedPending = left.ping('right', undefined, { signal: pingController.signal });
  pingController.abort();
  const pingAborted = await pingAbortedPending;
  await leftTransport.close?.();
  const transportError = await left.send('right', 'echo', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const transportTerminalSnapshot = readEndpointDebugSnapshot(left);
  const cleanup = await Promise.allSettled([right.dispose(), left.dispose()]);
  return {
    result,
    unsupportedChunkResult,
    dispatchCalls,
    remoteError,
    timeout,
    aborted,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    transportError,
    transportTerminalSnapshot,
    cleanup: cleanup.map((entry) => (entry.status === 'fulfilled' ? 'ok' : String(entry.reason))),
    errors,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  };
};

declare global {
  var runWebTransportScenario: () => Promise<unknown>;
}
