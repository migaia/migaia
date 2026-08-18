import { WorkerAdapter, workerComputed } from '@migaia/store-worker';

declare global {
  interface Window {
    runStoreWorkerScenario(): Promise<number>;
    runStoreWorkerTimeoutScenario(): Promise<unknown>;
    runStoreWorkerTransferScenario(): Promise<readonly number[]>;
    runStoreWorkerAbortScenario(): Promise<unknown>;
    runStoreWorkerErrorScenario(): Promise<readonly string[]>;
    runStoreWorkerRequestOptionsScenario(): Promise<readonly number[]>;
    runStoreWorkerComputedScenario(): Promise<readonly number[]>;
  }
}

window.runStoreWorkerScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  try {
    return await adapter.request<number, number>(21);
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
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

window.runStoreWorkerTransferScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
  try {
    const size = await adapter.request<ArrayBuffer, number>(buffer, { transfer: [buffer] });
    return [size, buffer.byteLength];
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
};

window.runStoreWorkerAbortScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  const controller = new AbortController();
  const pending = adapter.request('hang', { signal: controller.signal });
  controller.abort('browser-e2e-abort');
  try {
    return await pending;
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
};

window.runStoreWorkerErrorScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  try {
    await adapter.request('fail');
    return [];
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error && messages.length < 8) {
      messages.push(`${current.name}: ${current.message}`);
      current = current.cause;
    }
    return messages;
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
};

window.runStoreWorkerRequestOptionsScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  let signalReads = 0;
  let transferReads = 0;
  const options = {} as { signal?: AbortSignal; transfer?: readonly Transferable[] };
  Object.defineProperties(options, {
    signal: {
      get: () => {
        signalReads++;
        if (signalReads > 1) throw new Error('signal reread');
        return undefined;
      }
    },
    transfer: {
      get: () => {
        transferReads++;
        if (transferReads > 1) throw new Error('transfer reread');
        return [];
      }
    }
  });
  try {
    const result = await adapter.request<number, number>(21, options);
    return [result, signalReads, transferReads];
  } finally {
    await adapter.dispose();
    worker.terminate();
  }
};

window.runStoreWorkerComputedScenario = async () => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const adapter = new WorkerAdapter(worker);
  let transferReads = 0;
  let unknownReads = 0;
  const options = {} as Record<string, unknown>;
  Object.defineProperties(options, {
    transfer: {
      enumerable: true,
      get: () => {
        transferReads++;
        if (transferReads > 1) throw new Error('workerComputed transfer reread');
        return () => [];
      }
    },
    unknown: {
      enumerable: true,
      get: () => {
        unknownReads++;
        throw new Error('workerComputed unknown option read');
      }
    }
  });
  const resource = workerComputed<number, number>(adapter, () => 21, options as never);
  try {
    return [await resource.promise, transferReads, unknownReads];
  } finally {
    resource.dispose();
    await adapter.dispose();
    worker.terminate();
  }
};
