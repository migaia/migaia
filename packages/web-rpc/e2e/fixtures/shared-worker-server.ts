import { createSharedWorkerTransport } from '../../src/adapters/shared-worker';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, terminalProviders } from './rpc';

const endpoints = new Map<MessagePort, { dispose(): Promise<void> }>();
let connection = 0;

globalThis.addEventListener('connect', (event: Event) => {
  const port = (event as MessageEvent).ports[0];
  const index = ++connection;
  port.addEventListener('message', (message: MessageEvent) => {
    if (message.data?.e2e !== 'disconnect') return;
    const endpoint = endpoints.get(port);
    if (!endpoint) return;
    void endpoint.dispose().finally(() => {
      endpoints.delete(port);
      port.postMessage({ e2e: 'disconnected', snapshot: readEndpointDebugSnapshot(endpoint) });
    });
  });
  port.start();
  void createRpc(
    'shared-service',
    ['client'],
    createSharedWorkerTransport(port),
    {
      ...terminalProviders,
      notify: (context) => {
        port.postMessage({ e2e: 'dispatch-result', value: context.data });
        return context.success(undefined);
      }
    },
    { uniqueTargetId: `shared-${index}` },
    'same-task',
    false,
    undefined,
    { chunkSize: 4 }
  )
    .then((endpoint) => {
      endpoints.set(port, endpoint);
      port.postMessage({ e2e: 'ready', index });
    })
    .catch((error: unknown) => {
      port.postMessage({
        e2e: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    });
});
