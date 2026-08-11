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
    () => (++generatedIds === 1 ? 'same-task' : crypto.randomUUID())
  );
  return ready;
};

globalThis.sendSharedWorker = (value: unknown) => endpoint!.send('shared-service', 'echo', value);
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
  var injectSharedWorkerSpoof: () => void;
  var disposeSharedWorker: () => Promise<string[]>;
  var sharedWorkerSnapshots: () => unknown;
}
