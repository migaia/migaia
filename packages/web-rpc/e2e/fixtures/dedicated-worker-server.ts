import { createWebWorkerTransport } from '../../src/adapters/web-worker'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer'
import { createRpc, terminalProviders } from './rpc'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const endpoint = await createRpc(
  'worker',
  ['page'],
  createWebWorkerTransport(scope),
  {
    ...terminalProviders,
    notify: (context) => {
      scope.postMessage({ e2e: 'dispatch-result', value: context.data })
      return context.success(undefined)
    }
  },
  undefined,
  undefined,
  false,
  undefined,
  { chunkSize: 4 }
)

scope.postMessage({ e2e: 'ready' })
scope.addEventListener('message', (event) => {
  if (event.data?.e2e === 'dispose')
    void endpoint
      .dispose()
      .then(() =>
        scope.postMessage({ e2e: 'disposed', snapshot: readEndpointDebugSnapshot(endpoint) })
      )
})
