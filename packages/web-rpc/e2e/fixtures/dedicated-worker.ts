import { createWebWorkerTransport } from '../../src/adapters/web-worker';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, installErrorGuards } from './rpc';

const errors = installErrorGuards();

globalThis.runDedicatedWorkerScenario = async () => {
  const worker = new Worker(new URL('./dedicated-worker-server.ts', import.meta.url), {
    type: 'module'
  });
  const workerErrors: string[] = [];
  let workerReady = false;
  await new Promise<void>((resolve, reject) => {
    worker.addEventListener('error', (event) => {
      if (workerReady) workerErrors.push(event.message);
      else reject(event.error);
    });
    worker.addEventListener('message', (event) => {
      if (event.data?.e2e === 'ready') {
        workerReady = true;
        resolve();
      }
    });
    worker.addEventListener('messageerror', () => {
      if (workerReady) workerErrors.push('messageerror');
    });
  });
  const endpoint = await createRpc(
    'page',
    ['worker'],
    createWebWorkerTransport(worker),
    {},
    undefined,
    undefined,
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
  const values = await Promise.all(
    Array.from({ length: 8 }, (_, index) => endpoint.send('worker', 'echo', index))
  );
  const chunkedRequest = await endpoint.send('worker', 'echo', 'worker-chunked-request-😀');
  const chunkedTimeout = await endpoint
    .send('worker', 'hang', 'worker-chunked-timeout-😀', { timeoutMs: 40 })
    .then(
      () => 'unexpected',
      (error: { code?: string }) => error.code ?? 'error'
    );
  const dispatchResult = new Promise<unknown>((resolve) => {
    worker.addEventListener('message', function onDispatch(event) {
      if (event.data?.e2e === 'dispatch-result') {
        worker.removeEventListener('message', onDispatch);
        resolve(event.data.value);
      }
    });
  });
  endpoint.dispatch('worker', 'notify', 'worker-chunked-dispatch-😀');
  const dispatchPayload = String(await dispatchResult);
  const remoteError = await endpoint.send('worker', 'fail', 'worker-chunked-error-😀').then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  const aborted = new AbortController();
  const abortedRequest = endpoint
    .send('worker', 'hang', 'worker-chunked-abort-😀', { signal: aborted.signal })
    .then(
      () => 'unexpected',
      (error: { code?: string }) => error.code ?? 'error'
    );
  aborted.abort();
  const abortedResult = await abortedRequest;
  const schemaError = await endpoint.send('worker', 'schema', 'worker-chunked-schema-😀').then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  const pingSuccess = await endpoint.ping('worker');
  const pingTimeout = await endpoint.ping('missing', undefined, { timeoutMs: 40 });
  const pingController = new AbortController();
  const pingAbortedPending = endpoint.ping('worker', undefined, {
    signal: pingController.signal
  });
  pingController.abort();
  const pingAborted = await pingAbortedPending;
  const activePageSnapshot = readEndpointDebugSnapshot(endpoint);
  const workerDisposed = new Promise<unknown>((resolve) => {
    worker.addEventListener('message', (event) => {
      if (event.data?.e2e === 'disposed') resolve(event.data.snapshot);
    });
  });
  worker.postMessage({ e2e: 'dispose' });
  const workerSnapshot = await workerDisposed;
  worker.terminate();
  const terminal = await endpoint.send('worker', 'echo', 'late', { timeoutMs: 50 }).then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  await endpoint.dispose().catch(() => undefined);
  return {
    values,
    chunkedRequest,
    chunkedTimeout,
    dispatchPayload,
    remoteError,
    abortedResult,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    activePageSnapshot,
    terminal,
    errors,
    workerErrors,
    workerSnapshot,
    pageSnapshot: readEndpointDebugSnapshot(endpoint)
  };
};

declare global {
  var runDedicatedWorkerScenario: () => Promise<unknown>;
}
