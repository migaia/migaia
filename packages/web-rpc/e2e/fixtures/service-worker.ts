import { createServiceWorkerTransport } from '../../src/adapters/service-worker';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, installErrorGuards } from './rpc';

const errors = installErrorGuards();
let endpoint: Awaited<ReturnType<typeof createRpc>> | undefined;
let serverSnapshot: unknown;
const serverErrors: string[] = [];
let controllerChanges = 0;

globalThis.connectServiceWorker = async (uniqueId: string) => {
  await navigator.serviceWorker.register(new URL('./service-worker-server.ts', import.meta.url), {
    type: 'module',
    scope: './'
  });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          controllerChanges += 1;
          resolve();
        },
        { once: true }
      )
    );
  }
  const controller = navigator.serviceWorker.controller!;
  const ready = new Promise<string>((resolve) => {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.e2e === 'ready') resolve(event.data.clientId);
      if (event.data?.e2e === 'error') serverErrors.push(String(event.data.message));
    });
  });
  controller.postMessage({ e2e: 'connect' });
  const clientId = await ready;
  endpoint = await createRpc(
    'page',
    ['service'],
    createServiceWorkerTransport({
      target: controller,
      receiver: navigator.serviceWorker,
      peerId: 'service'
    }),
    {},
    { uniqueTargetId: uniqueId }
  );
  return clientId;
};

globalThis.sendServiceWorker = (value: unknown) => endpoint!.send('service', 'echo', value);
globalThis.injectServiceWorkerSpoof = (): void => {
  navigator.serviceWorker.controller?.postMessage({
    kind: 'request',
    version: '1',
    taskId: `spoof-${Date.now()}`,
    senderId: 'page',
    targetId: 'service',
    method: 'echo',
    data: { forged: true },
    sentAt: Date.now()
  });
};
globalThis.disposeServiceWorker = async () => {
  await endpoint?.dispose();
  const disconnected = new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener(
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
  navigator.serviceWorker.controller?.postMessage({ e2e: 'disconnect' });
  await disconnected;
  return errors;
};
globalThis.serviceWorkerSnapshots = () => ({
  page: readEndpointDebugSnapshot(endpoint!),
  server: serverSnapshot,
  serverErrors
});
globalThis.serviceWorkerControllerChanges = () => controllerChanges;

declare global {
  var connectServiceWorker: (uniqueId: string) => Promise<string>;
  var sendServiceWorker: (value: unknown) => Promise<unknown>;
  var injectServiceWorkerSpoof: () => void;
  var disposeServiceWorker: () => Promise<string[]>;
  var serviceWorkerSnapshots: () => unknown;
  var serviceWorkerControllerChanges: () => number;
}
