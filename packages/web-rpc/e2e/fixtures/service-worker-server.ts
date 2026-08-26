/// <reference lib="webworker" />
import { createServiceWorkerTransport } from '../../src/adapters/service-worker'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer'
import { createRpc, echoProvider, terminalProviders } from './rpc'

const scope = globalThis as unknown as ServiceWorkerGlobalScope
const endpoints = new Map<string, Awaited<ReturnType<typeof createRpc>>>()
let providerCalls = 0

const countedEcho = async (context: Parameters<typeof echoProvider>[0]) => {
  providerCalls += 1
  return echoProvider(context)
}

scope.addEventListener('install', () => void scope.skipWaiting())
scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
scope.addEventListener('message', (event) => {
  if (event.data?.e2e === 'disconnect' && event.source && 'id' in event.source) {
    const client = event.source as Client
    const endpoint = endpoints.get(client.id)
    if (!endpoint) return
    event.waitUntil(
      endpoint.dispose().finally(() => {
        endpoints.delete(client.id)
        client.postMessage({
          e2e: 'disconnected',
          snapshot: { ...readEndpointDebugSnapshot(endpoint), providerCalls }
        })
      })
    )
    return
  }
  if (event.data?.e2e !== 'connect' || !event.source || !('id' in event.source)) return
  const client = event.source as Client
  if (endpoints.has(client.id)) return
  event.waitUntil(
    createRpc(
      'service',
      ['page'],
      createServiceWorkerTransport({ target: client, receiver: scope, peerId: client.id }),
      {
        ...terminalProviders,
        echo: countedEcho,
        notify: (context) => {
          client.postMessage({ e2e: 'dispatch-result', value: context.data })
          return context.success(undefined)
        }
      },
      { uniqueTargetId: `service-${client.id}` },
      undefined,
      false,
      undefined,
      { chunkSize: 4 }
    )
      .then((endpoint) => {
        endpoints.set(client.id, endpoint)
        client.postMessage({ e2e: 'ready', clientId: client.id })
      })
      .catch((error: unknown) => {
        client.postMessage({
          e2e: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      })
  )
})
