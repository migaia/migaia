import { WorkerAdapter } from '@migaia/store-worker';

declare global { interface Window { runStoreWorkerScenario(): Promise<number>; } }

window.runStoreWorkerScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  try { return await adapter.request<number, number>(21); }
  finally { adapter.dispose(); worker.terminate(); }
};
