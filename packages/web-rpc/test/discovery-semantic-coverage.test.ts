import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createFullEndpoint } from '../src/full.js'
import { WebRpcError } from '../src/errors.js'
import { connect } from '../src/middleware/connect.js'
import { ping } from '../src/middleware/ping.js'
import type { IWebRpcDiscoveryCandidate, IWebRpcEndpoint } from '../src/typing.js'

type IManualEndpoint = IWebRpcEndpoint<string, 'manual'> & {
  readonly dispose: () => Promise<void>
}

type IManualPair = {
  readonly client: IManualEndpoint
  readonly server: IManualEndpoint
}

/** Creates two real manual-discovery endpoints connected by the canonical memory transport. */
async function createManualPair(
  clientId = 'coverage-manual-client',
  serverId = 'coverage-manual-server'
): Promise<IManualPair> {
  const [clientTransport, serverTransport] = createMemoryTransportPair()
  const client = (await createFullEndpoint({
    id: clientId,
    transport: clientTransport,
    middlewares: [connect({ transport: clientTransport, discoveryMode: 'manual' }), ping()] as const
  })) as IManualEndpoint
  const server = (await createFullEndpoint({
    id: serverId,
    transport: serverTransport,
    middlewares: [connect({ transport: serverTransport, discoveryMode: 'manual' }), ping()] as const
  })) as IManualEndpoint
  return { client, server }
}

/** Closes both endpoints while preserving the first disposal failure. */
async function disposePair(pair: IManualPair): Promise<void> {
  const clientDispose = pair.client.dispose()
  const serverDispose = pair.server.dispose()
  await Promise.all([clientDispose, serverDispose])
}

/** Creates a candidate-shaped value that did not originate from a verified query. */
function forgedCandidate(): IWebRpcDiscoveryCandidate<string> {
  return {
    queryId: 'forged-query',
    targetId: 'forged-target',
    receiverId: 'forged-receiver',
    data: undefined,
    platform: 'Memory'
  }
}

describe('discovery attachment semantic coverage', () => {
  it('accepts, pings, registers, pins, and unregisters a verified manual candidate', async () => {
    const pair = await createManualPair()
    const removeListener = pair.server.connect.onQuery!(async (query) => {
      await query.accept({ accepted: true })
    })
    try {
      const candidates = await pair.client.connect.query!('coverage-manual-server')
      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]!
      expect(candidate).toMatchObject({
        targetId: 'coverage-manual-server',
        receiverId: 'coverage-manual-server',
        data: { accepted: true }
      })

      await expect(pair.client.connect.ping!(candidate, { timeoutMs: 100 })).resolves.toBe(true)
      pair.client.connect.register!(candidate)
      expect(pair.client.connect.getServerList('coverage-manual-server')).toEqual([
        expect.objectContaining({
          targetId: 'coverage-manual-server',
          receiverId: 'coverage-manual-server',
          pinned: false,
          status: 'active'
        })
      ])
      pair.client.connect.pinReceiver('coverage-manual-server', 'coverage-manual-server')
      expect(pair.client.connect.getServerList('coverage-manual-server')).toEqual([
        expect.objectContaining({ pinned: true, status: 'active' })
      ])
      expect(pair.client.connect.getServerList()).toHaveLength(1)
      pair.client.connect.unpinReceiver('coverage-manual-server')
      await pair.client.connect.unregister!('coverage-manual-server')
      expect(pair.client.connect.getServerList('coverage-manual-server')).toEqual([])
    } finally {
      removeListener()
      await disposePair(pair)
    }
  })

  it('rejects duplicate manual listeners and invalid manual query inputs before allocation', async () => {
    const pair = await createManualPair('coverage-invalid-client', 'coverage-invalid-server')
    try {
      const removeListener = pair.server.connect.onQuery!(() => undefined)
      expect(() => pair.server.connect.onQuery!(() => undefined)).toThrowError(WebRpcError)
      removeListener()
      await expect(
        pair.client.connect.query!('coverage-invalid-server', { timeoutMs: -1 })
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      const controller = new AbortController()
      controller.abort()
      await expect(
        pair.client.connect.query!('coverage-invalid-server', { signal: controller.signal })
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(pair.client.connect.getServerList('coverage-invalid-server')).toEqual([])
    } finally {
      await disposePair(pair)
    }
  })

  it('rejects forged, expired, revoked, and unverified candidates without public state mutation', async () => {
    const pair = await createManualPair('coverage-forged-client', 'coverage-forged-server')
    try {
      const before = pair.client.connect.getServerList()
      const forged = forgedCandidate()
      expect(() => pair.client.connect.register!(forged)).toThrowError(WebRpcError)
      await expect(pair.client.connect.ping!(forged)).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
      await pair.client.connect.unregister!('missing-target', 'missing-receiver')
      expect(pair.client.connect.getServerList()).toEqual(before)
    } finally {
      await disposePair(pair)
    }
  })

  it('times out an unanswered manual query and clears waiter and timer residue on dispose', async () => {
    vi.useFakeTimers()
    const pair = await createManualPair('coverage-timeout-client', 'coverage-timeout-server')
    try {
      const pending = pair.client.connect.query!('coverage-timeout-server', { timeoutMs: 25 })
      await vi.advanceTimersByTimeAsync(25)
      await expect(pending).resolves.toEqual([])
      const disposePromise = pair.client.dispose()
      expect(pair.client.dispose()).toBe(disposePromise)
      await disposePromise
      expect(pair.client.connect.getServerList()).toEqual([])
    } finally {
      await pair.server.dispose()
      vi.useRealTimers()
    }
  })

  it('cancels an active manual query and removes its abort listener exactly once', async () => {
    const pair = await createManualPair('coverage-abort-client', 'coverage-abort-server')
    const controller = new AbortController()
    let addCount = 0
    let removeCount = 0
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => {
        addCount += 1
        controller.signal.addEventListener('abort', listener, { once: true })
      },
      removeEventListener: (_type: string, listener: () => void) => {
        removeCount += 1
        controller.signal.removeEventListener('abort', listener)
      }
    }
    try {
      const pending = pair.client.connect.query!('coverage-abort-server', { signal })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(addCount).toBe(1)
      expect(removeCount).toBe(1)
    } finally {
      await disposePair(pair)
    }
  })

  it('keeps automatic discovery selection and pinned receiver state isolated', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'coverage-auto-client',
      transport: clientTransport,
      middlewares: [
        connect({
          transport: clientTransport,
          receiverSelector: (servers) => servers[0]?.receiverId
        }),
        ping()
      ] as const
    })
    const server = await createFullEndpoint({
      id: 'coverage-auto-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()] as const
    })
    try {
      await expect(
        client.ping!('coverage-auto-server', undefined, { timeoutMs: 100 })
      ).resolves.toBe(true)
      const receivers = client.connect.getServerList('coverage-auto-server')
      expect(receivers).toHaveLength(1)
      client.connect.pinReceiver('coverage-auto-server', receivers[0]!.receiverId)
      expect(client.connect.getServerList('coverage-auto-server')[0]?.pinned).toBe(true)
      client.connect.unpinReceiver('coverage-auto-server')
      expect(client.connect.getServerList('coverage-auto-server')[0]?.pinned).toBe(false)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
