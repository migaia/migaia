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
  const endpoint = await createRpc('page', ['worker'], createWebWorkerTransport(worker));
  const values = await Promise.all(
    Array.from({ length: 8 }, (_, index) => endpoint.send('worker', 'echo', index))
  );
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
