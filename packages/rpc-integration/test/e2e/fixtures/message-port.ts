import { createBrowserMessagePortTransport } from '@migaia/rpc-host/plugin'
import { readEndpointDebugSnapshot } from '../../../../rpc-host/dist/core/internal/test-observer.js'
import { createRpc, installErrorGuards, terminalProviders } from './rpc.js'

const errors = installErrorGuards()

/** Test-owned physical observations never replace MessagePort or RPC lifecycle behavior. */
type IMessagePortFixture = {
  channel: MessageChannel
  closeCounts: number[]
  dispatchPayload: string
}

/** Project one actual native port while counting only its original close calls. */
function observedPort(fixture: IMessagePortFixture, port: MessagePort, index: number) {
  return {
    postMessage: (message: unknown, transfer?: readonly Transferable[]) =>
      transfer ? port.postMessage(message, { transfer: [...transfer] }) : port.postMessage(message),
    start: () => port.start(),
    close: () => {
      fixture.closeCounts[index] += 1
      port.close()
    },
    addEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.addEventListener(type, listener),
    removeEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.removeEventListener(type, listener)
  }
}

/** Prepare the physical carrier and original provider/schema configuration before business begins. */
async function prepareMessagePorts(fixture: IMessagePortFixture) {
  const leftTransport = createBrowserMessagePortTransport(
    observedPort(fixture, fixture.channel.port1, 0)
  )
  const rightTransport = createBrowserMessagePortTransport(
    observedPort(fixture, fixture.channel.port2, 1)
  )
  const left = await createRpc(
    'left',
    ['right'],
    leftTransport,
    {},
    undefined,
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
  const right = await createRpc(
    'right',
    ['left'],
    rightTransport,
    {
      ...terminalProviders,
      hang: (context) =>
        new Promise((resolve) =>
          context.signal.addEventListener(
            'abort',
            () => resolve(context.failed('aborted', 'CANCELLED')),
            {
              once: true
            }
          )
        ),
      notify: (context) => {
        fixture.dispatchPayload = String(context.data)
        return context.success(undefined)
      }
    },
    undefined,
    undefined,
    false,
    undefined,
    { chunkSize: 4 }
  )
  return { leftTransport, left, right }
}

/** Execute one original MessagePort business and cleanup transaction on its prepared physical pair. */
globalThis.runMessagePortScenario = async () => {
  const fixture: IMessagePortFixture = {
    channel: new MessageChannel(),
    closeCounts: [0, 0],
    dispatchPayload: ''
  }
  const { leftTransport, left, right } = await prepareMessagePorts(fixture)
  const result = await left.send('right', 'echo', { value: 42 })
  const chunkedRequest = await left.send('right', 'echo', 'chunked-request-😀-payload')
  const chunkedRemoteError = await left.send('right', 'fail', 'chunked-error-😀-payload').then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const chunkedTimeout = await left
    .send('right', 'hang', 'chunked-timeout-😀-payload', { timeoutMs: 40 })
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    )
  const chunkedAbortController = new AbortController()
  const chunkedAbortPending = left.send('right', 'hang', 'chunked-abort-😀-payload', {
    timeoutMs: 1_000,
    signal: chunkedAbortController.signal
  })
  chunkedAbortController.abort()
  const chunkedAbort = await chunkedAbortPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const chunkedSchemaError = await left.send('right', 'schema', 'chunked-schema-😀-payload').then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  left.dispatch('right', 'notify', 'chunked-dispatch-😀-payload')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const remoteError = await left.send('right', 'fail', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const timeout = await left.send('right', 'hang', null, { timeoutMs: 40 }).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const controller = new AbortController()
  const abortedPending = left.send('right', 'hang', null, { signal: controller.signal })
  controller.abort()
  const aborted = await abortedPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const schemaError = await left.send('right', 'schema', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const pingSuccess = await left.ping('right')
  const pingTimeout = await left.ping('missing', undefined, { timeoutMs: 40 })
  const pingController = new AbortController()
  const pingAbortedPending = left.ping('right', undefined, {
    signal: pingController.signal
  })
  pingController.abort()
  const pingAborted = await pingAbortedPending
  await new Promise((resolve) => setTimeout(resolve, 500))
  const providerTerminalSnapshot = readEndpointDebugSnapshot(right)
  const chunkedTransportPending = left.send('right', 'echo', 'chunked-transport-😀-payload', {
    timeoutMs: 1_000
  })
  await leftTransport.close?.()
  const transportError = await chunkedTransportPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  )
  const transportTerminalSnapshot = readEndpointDebugSnapshot(left)
  await left.dispose()
  await right.dispose()
  return {
    result,
    chunkedRequest,
    chunkedRemoteError,
    chunkedTimeout,
    chunkedAbort,
    chunkedSchemaError,
    dispatchPayload: fixture.dispatchPayload,
    remoteError,
    timeout,
    aborted,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    providerTerminalSnapshot,
    transportError,
    transportTerminalSnapshot,
    errors,
    portsClosed: fixture.closeCounts,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  }
}

globalThis.runBorrowedMessagePortScenario = async () => {
  const fixture: IMessagePortFixture = {
    channel: new MessageChannel(),
    closeCounts: [0, 0],
    dispatchPayload: ''
  }
  const left = await createRpc(
    'left',
    ['right'],
    createBrowserMessagePortTransport(observedPort(fixture, fixture.channel.port1, 0), {
      ownership: 'borrowed'
    })
  )
  const right = await createRpc(
    'right',
    ['left'],
    createBrowserMessagePortTransport(observedPort(fixture, fixture.channel.port2, 1)),
    terminalProviders
  )
  const result = await left.send('right', 'echo', 'borrowed')
  await left.dispose()
  await right.dispose()
  fixture.channel.port1.close()
  return {
    result,
    errors,
    portsClosed: fixture.closeCounts,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  }
}

declare global {
  var runMessagePortScenario: () => Promise<unknown>
  var runBorrowedMessagePortScenario: () => Promise<unknown>
}
