import { assert, describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import {
  ProviderExecutor,
  type IProviderRequestInput
} from '../../src/core/internal/provider-executor.js'
import { ProviderRegistry } from '../../src/core/internal/provider.js'
import { RpcRoutingProfile } from '../../src/core/internal/routing-data.js'
import { connect } from '../../src/core/middleware/connect.js'
import { createProviderEndpoint } from '../../src/core/provider.js'

/** Allows a dispatched frame to cross the memory transport before assertions. */
const delivered = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Builds the public client/provider path used by listener ownership cases. */
async function makeEndpoints() {
  const [clientTransport, serverTransport] = createMemoryTransportPair()
  const server = await createProviderEndpoint({
    id: 'event-server',
    transport: serverTransport,
    targetIds: ['event-client'],
    middlewares: [connect({ transport: serverTransport })]
  })
  const client = await createClientEndpoint({
    id: 'event-client',
    transport: clientTransport,
    targetIds: ['event-server'],
    middlewares: [connect({ transport: clientTransport })]
  })
  return { client, server }
}

/** One dispatch-only request for direct executor failure-order checks. */
const envelope = normalizeRpcEnvelope({
  kind: 'request',
  id: 'fanout-task',
  method: 'event',
  data: null
})
assert(envelope.kind === 'request')
const request: IProviderRequestInput = {
  envelope,
  route: {
    webRpc: {
      profile: RpcRoutingProfile,
      type: 'request',
      applicationVersion: '1.0',
      senderId: 'peer',
      targetId: 'host',
      sentAt: 0,
      dispatchOnly: true
    },
    payload: null
  }
}

describe('provider event listener handles', () => {
  it('A1: repeated disposer calls leave the other identical registration active', async () => {
    const { client, server } = await makeEndpoints()
    const calls: unknown[] = []
    const listener = (context: { data: unknown }): void => {
      calls.push(context.data)
    }
    const first = server.on('event', listener)
    const second = server.on('event', listener)
    try {
      first()
      first()
      client.dispatch('event-server', 'event', { sequence: 1 })
      await delivered()
      expect(calls).toEqual([{ sequence: 1 }])
      second()
      client.dispatch('event-server', 'event', { sequence: 2 })
      await delivered()
      expect(calls).toEqual([{ sequence: 1 }])
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('A2: a stale disposer cannot withdraw a later identical registration', async () => {
    const { client, server } = await makeEndpoints()
    const calls: unknown[] = []
    const listener = (context: { data: unknown }): void => {
      calls.push(context.data)
    }
    const stale = server.on('event', listener)
    try {
      stale()
      const current = server.on('event', listener)
      stale()
      client.dispatch('event-server', 'event', { sequence: 1 })
      await delivered()
      expect(calls).toEqual([{ sequence: 1 }])
      current()
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('A2: clear prevents an old handle from withdrawing a new registration', () => {
    const registry = new ProviderRegistry()
    const listener = () => undefined
    const stale = registry.listen('event', listener)
    registry.clear()
    registry.listen('event', listener)
    stale()
    expect(registry.hasListeners('event')).toBe(true)
    expect(registry.listenerCount).toBe(1)
  })

  it.each(['throw', 'reject'] as const)(
    'A3: serial dispatch stops on the first %s and reports its identity',
    async (mode) => {
      const registry = new ProviderRegistry()
      const calls: string[] = []
      const error = new Error('listener failed')
      const failures: Array<{ error: unknown; code: string }> = []
      const sent: unknown[] = []
      registry.listen('event', async () => {
        await Promise.resolve()
        calls.push('first')
      })
      registry.listen('event', () => {
        calls.push('second')
        if (mode === 'throw') throw error
        return Promise.reject(error)
      })
      registry.listen('event', () => {
        calls.push('third')
      })
      const executor = new ProviderExecutor<string>({
        timestamp: () => 0,
        id: 'host',
        registry,
        controllers: new Map(),
        admission: new ProviderAdmissionRegistry(),
        peers: [],
        dispatch: () => undefined,
        send: async (response) => {
          sent.push(response)
        },
        validate: () => undefined,
        emitFailure: (failure, code) => failures.push({ error: failure, code })
      })
      await executor.execute(request)
      expect(calls).toEqual(['first', 'second'])
      expect(failures).toEqual([{ error, code: 'INTERNAL' }])
      expect(sent).toEqual([])
    }
  )

  it('A4: dispatch snapshots order before listener mutation', async () => {
    const { client, server } = await makeEndpoints()
    const calls: number[] = []
    let withdrawSecond: () => void = () => undefined
    let installedThird = false
    const first = server.on('event', () => {
      calls.push(1)
      if (!installedThird) {
        installedThird = true
        withdrawSecond()
        server.on('event', () => {
          calls.push(3)
        })
      }
    })
    withdrawSecond = server.on('event', () => {
      calls.push(2)
    })
    try {
      client.dispatch('event-server', 'event', null)
      await delivered()
      expect(calls).toEqual([1, 2])
      client.dispatch('event-server', 'event', null)
      await delivered()
      expect(calls).toEqual([1, 2, 1, 3])
    } finally {
      first()
      withdrawSecond()
      await client.dispose()
      await server.dispose()
    }
  })

  it('A4: duplicate registrations count separately while request calls its provider', async () => {
    const registry = new ProviderRegistry()
    const listeners: string[] = []
    const sent: unknown[] = []
    const listener = () => {
      listeners.push('event')
    }
    registry.listen('event', listener)
    registry.listen('event', listener)
    registry.register('event', (context) => context.success('provider'))
    expect(registry.listenerCount).toBe(2)

    const executor = new ProviderExecutor<string>({
      timestamp: () => 0,
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send: async (response) => {
        sent.push(response)
      },
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute({
      ...request,
      route: { ...request.route, webRpc: { ...request.route.webRpc, dispatchOnly: false } }
    })
    expect(listeners).toEqual([])
    expect(sent).toEqual([expect.objectContaining({ ok: true, data: 'provider' })])
  })
})
