import { MessageChannel } from 'node:worker_threads'
import { expect, it } from 'vitest'
import {
  connect,
  createEndpoint,
  createRuntimeApiEndpoint,
  defineMiddleware
} from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport
} from '../../dist/core/adapters/message-port.js'
import { createWebWorkerTransport } from '../../dist/core/adapters/web-worker.js'
import {
  defineProbe,
  probePlugin,
  readProbeStages,
  subscribeProbeStages
} from '../../dist/core/probe/index.js'

it('[RC-D03] publishes the binding disposal settlement before one synchronous reentry', async () => {
  /** The bound operation is allowed to synchronously join disposal before returning its Promise. */
  let calls = 0
  /** A reentrant observer must receive the same facade-owned settlement. */
  let nested: Promise<void> | undefined
  /** These complete public binding operations need no physical transport. */
  const endpoint = createRuntimeApiEndpoint({
    binding: {
      ready: Promise.resolve(),
      request: async () => undefined,
      notify: async () => undefined,
      stream: { open: () => (async function* () {})() },
      dispose() {
        calls++
        if (calls === 1) nested = endpoint.dispose()
        return Promise.resolve()
      }
    }
  })
  /** The public facade owns a stable Promise even while the binding is executing synchronously. */
  const closing = endpoint.dispose()
  await closing
  expect(calls).toBe(1)
  expect(nested).toBe(closing)
  expect(endpoint.dispose()).toBe(closing)
})

it('[RC-D04] rebuilds installed probe stages even when an earlier cold listener throws', async () => {
  /** Record only ordinary events actually emitted by the installed probe. */
  let events = 0
  /** The callback's native failure keeps its original identity and receives package classification. */
  const original = new Error('audit cold stage listener failed')
  /** The native handle is shared by the cold subscription and the endpoint emitter. */
  const probe = defineProbe({
    stages: ['message'],
    emit() {
      events++
    }
  })
  /** Register before endpoint installation to reproduce the original notification ordering. */
  const off = subscribeProbeStages(probe, () => {
    throw original
  })
  /** Actual memory traffic proves pause reaches the emitter rather than only updating the mask. */
  const [left, right] = createMemoryTransportPair()
  /** The provider handles the real request through the normal public endpoint. */
  const server = await createEndpoint({
    id: 'probe-server',
    transport: right,
    middlewares: [connect({ transport: right })]
  })
  server.provide('echo', (context) => context.success(context.data))
  /** Probe installation follows the failing cold listener. */
  const client = await createEndpoint({
    id: 'probe-client',
    transport: left,
    targetIds: ['probe-server'],
    middlewares: [connect({ transport: left }), probePlugin(probe)]
  })
  try {
    await client.send('probe-server', 'echo', 'before')
    expect(() => probe.setStages([])).toThrow(original)
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'CALLBACK_FAILED' })
    expect(readProbeStages(probe)).toBe(0)
    /** This scalar snapshot excludes events generated before pause. */
    const before = events
    await client.send('probe-server', 'echo', 'after')
    expect(events).toBe(before)
  } finally {
    off()
    await client.dispose()
    await server.dispose()
    left.close()
    right.close()
  }
})

it.each([
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport,
  createWebWorkerTransport
])(
  '[RC-D05] codes the native clone rejection from %s without changing its DOMException family',
  async (factory) => {
    /** A genuine native port rejects the unsupported function payload itself. */
    const pair = new MessageChannel()
    /** All adapters support this native MessagePort shape and borrow its raw physical resource. */
    const transport = factory(pair.port1)
    try {
      /** Capture the same error thrown by the public synchronous transport operation. */
      let failure: unknown
      try {
        transport.send(() => undefined)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({
        name: 'DataCloneError',
        source: '@migaia/rpc/core',
        code: 'TRANSPORT'
      })
      expect((failure as Error).stack).toBeTruthy()
    } finally {
      await transport.close?.()
      pair.port1.close()
      pair.port2.close()
    }
  }
)

it('[RC-D06] classifies the original middleware installation failure at the endpoint boundary', async () => {
  /** The application callback's original native instance and stack remain intact. */
  const original = new Error('audit installation failed')
  /** This middleware is admitted through its ordinary native descriptor. */
  const middleware = defineMiddleware('audit-install', () => ({
    install() {
      throw original
    }
  }))
  /** Construction rollback owns the actual local memory transport. */
  const [left, right] = createMemoryTransportPair()
  try {
    await expect(
      createEndpoint({
        id: 'audit-install',
        transport: left,
        middlewares: [connect({ transport: left }), middleware]
      })
    ).rejects.toBe(original)
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'CALLBACK_FAILED' })
  } finally {
    left.close()
    right.close()
  }
})

it('[RC-D07] retains the original native error event cause in the worker transport diagnostic', async () => {
  /** Native event dispatch supplies the supported Worker-like callback surface. */
  const events = new EventTarget()
  /** The actual event cause is distinct from its presentation message. */
  const original = new Error('audit worker cause')
  /** This complete structural port uses real EventTarget add/remove/dispatch behavior. */
  const port = {
    postMessage() {},
    addEventListener: (type: string, listener: EventListener) =>
      events.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      events.removeEventListener(type, listener)
  }
  /** Error listeners attach through the public adapter operation. */
  const transport = createWebWorkerTransport(port)
  /** Observe the real diagnostic delivered by the native error event. */
  const observed: unknown[] = []
  transport.onTransportError?.((error) => {
    observed.push(error)
  })
  /** Node's Event carries the same supported error/message fields as a browser ErrorEvent. */
  const event = new Event('error')
  Object.defineProperties(event, {
    error: { value: original },
    message: { value: original.message }
  })
  try {
    events.dispatchEvent(event)
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      source: '@migaia/rpc/core',
      code: 'TRANSPORT',
      cause: original
    })
  } finally {
    await transport.close?.()
  }
})

it.each([true, false])(
  '[RC-D12] keeps native AbortError and the exact reason (pre-aborted=%s)',
  async (preAborted) => {
    /** A normal manual endpoint exposes the public query operation without private state access. */
    const [left, right] = createMemoryTransportPair()
    /** Caller-owned cancellation must remain reachable without changing the original native reason. */
    const reason = new Error('audit discovery cancellation')
    /** A genuine native controller provides the supported signal domain. */
    const controller = new AbortController()
    if (preAborted) controller.abort(reason)
    /** Manual mode ensures no automatic discovery changes the cancellation path. */
    const endpoint = await createEndpoint({
      id: 'manual-client',
      transport: left,
      middlewares: [connect({ transport: left, discoveryMode: 'manual' })]
    })
    try {
      /** Both pre-admission and active-waiter cancellation use the same supported public query. */
      const pending = endpoint.connect
        .query('remote', { signal: controller.signal })
        .catch((error: unknown) => error)
      if (!preAborted) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        controller.abort(reason)
      }
      /** Cancellation is observed before any test-owned physical cleanup. */
      const failure = await pending
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({
        name: 'AbortError',
        source: '@migaia/rpc/core',
        code: 'CANCELLED',
        cause: reason
      })
    } finally {
      await endpoint.dispose()
      left.close()
      right.close()
    }
  }
)
