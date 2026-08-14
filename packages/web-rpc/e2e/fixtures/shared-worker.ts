import { createSharedWorkerTransport } from '../../src/adapters/shared-worker';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, installErrorGuards } from './rpc';

const errors = installErrorGuards();
let endpoint: Awaited<ReturnType<typeof createRpc>> | undefined;
let worker: SharedWorker | undefined;
let serverSnapshot: unknown;
const serverErrors: string[] = [];

globalThis.connectSharedWorker = async (clientUniqueId: string) => {
  let generatedIds = 0;
  worker = new SharedWorker(new URL('./shared-worker-server.ts', import.meta.url), {
    type: 'module',
    name: 'web-rpc-e2e'
  });
  const ready = new Promise<number>((resolve) => {
    worker!.port.addEventListener('message', (event) => {
      if (event.data?.e2e === 'ready') resolve(event.data.index);
      if (event.data?.e2e === 'error') serverErrors.push(String(event.data.message));
    });
    worker!.port.start();
  });
  endpoint = await createRpc(
    'client',
    ['shared-service'],
    createSharedWorkerTransport(worker.port),
    {},
    { uniqueTargetId: clientUniqueId },
    () => (++generatedIds === 1 ? 'same-task' : crypto.randomUUID()),
    false,
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
    },
    { chunkSize: 4 }
  );
  return ready;
};

globalThis.sendSharedWorker = (value: unknown) => endpoint!.send('shared-service', 'echo', value);
globalThis.sendSharedWorkerTerminal = async () => {
  const chunkedRequest = await endpoint!.send(
    'shared-service',
    'echo',
    'shared-worker-chunked-request-😀'
  );
  const chunkedTimeout = await endpoint!
    .send('shared-service', 'hang', 'shared-worker-chunked-timeout-😀', { timeoutMs: 40 })
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    );
  const dispatchResult = new Promise<unknown>((resolve) => {
    worker!.port.addEventListener('message', function onDispatch(event) {
      if (event.data?.e2e === 'dispatch-result') {
        worker!.port.removeEventListener('message', onDispatch);
        resolve(event.data.value);
      }
    });
  });
  endpoint!.dispatch('shared-service', 'notify', 'shared-worker-chunked-dispatch-😀');
  const dispatchPayload = String(await dispatchResult);
  const remoteError = await endpoint!
    .send('shared-service', 'fail', 'shared-worker-chunked-error-😀')
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    );
  const controller = new AbortController();
  const pending = endpoint!.send('shared-service', 'hang', 'shared-worker-chunked-abort-😀', {
    signal: controller.signal
  });
  controller.abort();
  const aborted = await pending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const schemaError = await endpoint!
    .send('shared-service', 'schema', 'shared-worker-chunked-schema-😀')
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    );
  const pingSuccess = await endpoint!.ping('shared-service');
  const pingTimeout = await endpoint!.ping('missing', undefined, { timeoutMs: 40 });
  const pingController = new AbortController();
  const pingAbortedPending = endpoint!.ping('shared-service', undefined, {
    signal: pingController.signal
  });
  pingController.abort();
  const pingAborted = await pingAbortedPending;
  const activePageSnapshot = readEndpointDebugSnapshot(endpoint!);
  if (activePageSnapshot === undefined) throw new Error('missing endpoint snapshot');
  return {
    chunkedRequest,
    chunkedTimeout,
    dispatchPayload,
    remoteError,
    aborted,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    activePageSnapshot
  };
};
globalThis.injectSharedWorkerSpoof = (): void => {
  worker?.port.postMessage({
    kind: 'request',
    version: '1',
    taskId: `spoof-${Date.now()}`,
    senderId: 'client',
    targetId: 'shared-service',
    method: 'echo',
    data: { forged: true },
    sentAt: Date.now()
  });
};

globalThis.disposeSharedWorker = async () => {
  await endpoint?.dispose();
  const disconnected = new Promise<void>((resolve) => {
    worker!.port.addEventListener(
      'message',
      (event) => {
        if (event.data?.e2e === 'disconnected') {
          serverSnapshot = event.data.snapshot;
          resolve();
        }
      },
      { once: true }
    );
  });
  worker!.port.postMessage({ e2e: 'disconnect' });
  await disconnected;
  worker?.port.close();
  return errors;
};
globalThis.sharedWorkerSnapshots = () => ({
  page: readEndpointDebugSnapshot(endpoint!),
  server: serverSnapshot,
  serverErrors
});

declare global {
  var connectSharedWorker: (clientUniqueId: string) => Promise<number>;
  var sendSharedWorker: (value: unknown) => Promise<unknown>;
  var sendSharedWorkerTerminal: () => Promise<{
    chunkedRequest: unknown;
    chunkedTimeout: string;
    dispatchPayload: string;
    remoteError: string;
    aborted: string;
    schemaError: string;
    pingSuccess: boolean;
    pingTimeout: boolean;
    pingAborted: boolean;
    activePageSnapshot: {
      phase: string;
      pending: number;
      chunks: number;
      activeControllers: number;
    };
  }>;
  var injectSharedWorkerSpoof: () => void;
  var disposeSharedWorker: () => Promise<string[]>;
  var sharedWorkerSnapshots: () => unknown;
}
