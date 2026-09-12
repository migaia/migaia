import { createServiceWorkerTransport } from '../../src/adapters/service-worker'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer'
import { createRpc, installErrorGuards } from './rpc'

const errors = installErrorGuards()
let endpoint: Awaited<ReturnType<typeof createRpc>> | undefined
let serverSnapshot: unknown
const serverErrors: string[] = []
let controllerChanges = 0

globalThis.connectServiceWorker = async (uniqueId: string) => {
  await navigator.serviceWorker.register(new URL('./service-worker-server.ts', import.meta.url), {
    type: 'module',
    scope: './'
  })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          controllerChanges += 1
          resolve()
        },
        { once: true }
      )
    )
  }
  const controller = navigator.serviceWorker.controller!
  const ready = new Promise<string>((resolve, reject) => {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.e2e === 'ready') resolve(event.data.clientId)
      if (event.data?.e2e === 'error') {
        const message = String(event.data.message)
        serverErrors.push(message)
        reject(new Error(message))
      }
    })
  })
  controller.postMessage({ e2e: 'connect' })
  const clientId = await ready
  endpoint = await createRpc(
    'page',
    ['service'],
    createServiceWorkerTransport({
      target: controller,
      receiver: navigator.serviceWorker,
      peerId: 'service'
    }),
    {},
    { uniqueTargetId: uniqueId },
    undefined,
    false,
    {
      schemas: {
        schema: {
          params: {
            parse: () => {
              throw new Error('schema rejected')
            }
          },
          result: { parse: (value) => value }
        }
      }
    },
    { chunkSize: 4 }
  )
  return clientId
}

globalThis.sendServiceWorker = (value: unknown) => endpoint!.send('service', 'echo', value)
globalThis.sendServiceWorkerTerminal = async () => {
  const chunkedRequest = await endpoint!.send(
    'service',
    'echo',
    'service-worker-chunked-request-😀'
  )
  const dispatchResult = new Promise<unknown>((resolve) => {
    navigator.serviceWorker.addEventListener('message', function onDispatch(event) {
      if (event.data?.e2e === 'dispatch-result') {
        navigator.serviceWorker.removeEventListener('message', onDispatch)
        resolve(event.data.value)
      }
    })
  })
  endpoint!.dispatch('service', 'notify', 'service-worker-chunked-dispatch-😀')
  const dispatchPayload = String(await dispatchResult)
  const remoteError = await endpoint!
    .send('service', 'fail', 'service-worker-chunked-error-😀')
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const timeout = await endpoint!
    .send('service', 'hang', 'service-worker-chunked-timeout-😀', { timeoutMs: 40 })
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const controller = new AbortController()
  const pending = endpoint!.send('service', 'hang', 'service-worker-chunked-abort-😀', {
    signal: controller.signal
  })
  controller.abort()
  const aborted = await pending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const schemaError = await endpoint!
    .send('service', 'schema', 'service-worker-chunked-schema-😀')
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const pingSuccess = await endpoint!.ping('service')
  const pingTimeout = await endpoint!.ping('missing', undefined, { timeoutMs: 40 })
  const pingController = new AbortController()
  const pingAbortedPending = endpoint!.ping('service', undefined, {
    signal: pingController.signal
  })
  pingController.abort()
  const pingAborted = await pingAbortedPending
  const activePageSnapshot = readEndpointDebugSnapshot(endpoint!)
  if (activePageSnapshot === undefined) throw new Error('missing endpoint snapshot')
  return {
    chunkedRequest,
    dispatchPayload,
    remoteError,
    timeout,
    aborted,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    activePageSnapshot
  }
}
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
  })
}
globalThis.disposeServiceWorker = async () => {
  await endpoint?.dispose()
  const disconnected = new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener(
      'message',
      (event) => {
        if (event.data?.e2e === 'disconnected') {
          serverSnapshot = event.data.snapshot
          resolve()
        }
      },
      { once: true }
    )
  })
  navigator.serviceWorker.controller?.postMessage({ e2e: 'disconnect' })
  await disconnected
  return errors
}
globalThis.serviceWorkerSnapshots = () => ({
  page: readEndpointDebugSnapshot(endpoint!),
  server: serverSnapshot,
  serverErrors
})
globalThis.serviceWorkerControllerChanges = () => controllerChanges

declare global {
  var connectServiceWorker: (uniqueId: string) => Promise<string>
  var sendServiceWorker: (value: unknown) => Promise<unknown>
  var sendServiceWorkerTerminal: () => Promise<{
    chunkedRequest: unknown
    activePageSnapshot: {
      phase: string
      pending: number
      chunks?: number
      activeControllers: number
    }
    dispatchPayload: string
    remoteError: string
    timeout: string
    aborted: string
    schemaError: string
    pingSuccess: boolean
    pingTimeout: boolean
    pingAborted: boolean
  }>
  var injectServiceWorkerSpoof: () => void
  var disposeServiceWorker: () => Promise<string[]>
  var serviceWorkerSnapshots: () => unknown
  var serviceWorkerControllerChanges: () => number
}
