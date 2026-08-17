import { WorkerAdapter } from '@migaia/store-worker';

declare global {
  interface Window {
    runStoreWorkerScenario(): Promise<number>;
    runStoreWorkerTimeoutScenario(): Promise<unknown>;
  }
}

window.runStoreWorkerScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  try { return await adapter.request<number, number>(21); }
  finally { await adapter.dispose(); worker.terminate(); }
};

window.runStoreWorkerTimeoutScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker, { timeoutMs: 25 });
  try {
    return await adapter.request('hang');
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
};
