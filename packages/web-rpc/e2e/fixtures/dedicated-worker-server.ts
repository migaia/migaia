import { createWebWorkerTransport } from '../../src/adapters/web-worker';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, echoProvider } from './rpc';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const endpoint = await createRpc('worker', ['page'], createWebWorkerTransport(scope), {
  echo: echoProvider
});

scope.postMessage({ e2e: 'ready' });
scope.addEventListener('message', (event) => {
  if (event.data?.e2e === 'dispose')
    void endpoint
      .dispose()
      .then(() =>
        scope.postMessage({ e2e: 'disposed', snapshot: readEndpointDebugSnapshot(endpoint) })
      );
});
