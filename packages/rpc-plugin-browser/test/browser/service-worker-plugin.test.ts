import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { serviceWorkerRealm } from './fixtures/service-worker.ts'

/** Scheduling a wrong source must not complete an independent pending native session. */
const deliveryTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

afterEach(() => vi.unstubAllGlobals())

describe('ServiceWorker raw session plugin', () => {
  it('isolates two Clients before handshake and business, with separate outbound target and receiver', async () => {
    /** The native worker scope and two page containers share no outbound receiver identity. */
    const realm = serviceWorkerRealm()
    const first = realm.page('client-a')
    const second = realm.page('client-b')
    /** This third native-looking source has no current Clients entry or admitted session. */
    const wrong = { id: 'wrong-client', postMessage: vi.fn() }
    /** Provider observations prove forged traffic never executes another page's business call. */
    const calls: unknown[] = []
    const reports: unknown[] = []
    const server = await createRpcHost({
      plugins: [serviceWorkerPlugin({ clients: realm.scope })],
      provide: { record: (value: unknown) => (calls.push(value), value) },
      report: (error) => reports.push(error)
    })
    /** Wrong-worker handshake frames cannot satisfy this page's original opening Promise. */
    first.holdToPage()
    let firstReady = false
    const opening = createRpcHost({
      self: { name: 'page-a', instanceId: 'page-a' },
      plugins: [
        serviceWorkerPlugin({ serviceWorker: first.serviceWorker, receiver: first.receiver })
      ],
      provide: { who: () => 'a' },
      report: (error) => reports.push(error)
    }).then((host) => {
      firstReady = true
      return host
    })
    let a: Awaited<typeof opening> | undefined
    let b: Awaited<typeof opening> | undefined
    try {
      await vi.waitFor(() => expect(first.incoming.length).toBeGreaterThan(0))
      for (const data of first.incoming) first.deliver(data, second.serviceWorker)
      await deliveryTurn()
      expect(firstReady).toBe(false)
      first.releaseToPage()
      a = await opening
      /** Unknown Client handshakes are filtered without entering the real page-b resource. */
      second.holdToWorker()
      let secondReady = false
      const next = createRpcHost({
        self: { name: 'page-b', instanceId: 'page-b' },
        plugins: [
          serviceWorkerPlugin({ serviceWorker: second.serviceWorker, receiver: second.receiver })
        ],
        provide: { who: () => 'b' },
        report: (error) => reports.push(error)
      }).then((host) => {
        secondReady = true
        return host
      })
      await vi.waitFor(() => expect(second.outgoing.length).toBeGreaterThan(0))
      for (const data of second.outgoing) realm.dispatch(data, wrong)
      await deliveryTurn()
      expect(secondReady).toBe(false)
      expect(calls).toEqual([])
      second.releaseToWorker()
      b = await next
      expect(await server.serviceWorker.send('page-a', 'who')).toBe('a')
      expect(await server.serviceWorker.send('page-b', 'who')).toBe('b')
      /** A Client-b native source cannot dispatch a frame belonging to Client-a's admitted peer. */
      first.holdToWorker()
      let completed = false
      const pending = a.serviceWorker.request('record', 'client-a-value').then((value) => {
        completed = true
        return value
      })
      await vi.waitFor(() => expect(first.outgoing.length).toBeGreaterThan(0))
      for (const data of first.outgoing) realm.dispatch(data, second.client)
      await deliveryTurn()
      expect(calls).toEqual([])
      expect(completed).toBe(false)
      first.releaseToWorker()
      expect(await pending).toBe('client-a-value')
      /** A wrong ServiceWorker cannot complete the page's pending business response either. */
      first.holdToPage()
      completed = false
      const response = a.serviceWorker.request('record', 'correct-reply').then((value) => {
        completed = true
        return value
      })
      await vi.waitFor(() => expect(first.incoming.length).toBeGreaterThan(0))
      for (const data of first.incoming) first.deliver(data, second.serviceWorker)
      await deliveryTurn()
      expect(completed).toBe(false)
      first.releaseToPage()
      expect(await response).toBe('correct-reply')
      expect(calls).toEqual(['client-a-value', 'correct-reply'])
      /** A reply injected through Client-b cannot settle the server's actual Client-a request. */
      first.holdToWorker()
      completed = false
      const serverPending = server.serviceWorker.send('page-a', 'who').then((value) => {
        completed = true
        return value
      })
      await vi.waitFor(() => expect(first.outgoing.length).toBeGreaterThan(0))
      for (const data of first.outgoing) realm.dispatch(data, second.client)
      await deliveryTurn()
      expect(completed).toBe(false)
      first.releaseToWorker()
      expect(await serverPending).toBe('a')
      expect(realm.lifetimes.length).toBeGreaterThan(0)
    } finally {
      first.releaseToWorker()
      first.releaseToPage()
      second.releaseToWorker()
      await Promise.all([a?.close(), b?.close(), server.close()])
      expect(first.listeners()).toBe(0)
      expect(second.listeners()).toBe(0)
      expect(realm.listeners()).toBe(0)
      /** These original targets still post to the test-owned physical pipe after Host close. */
      const received = first.physicalReceipts()
      first.serviceWorker.postMessage('borrowed-still-open')
      await vi.waitFor(() => expect(first.physicalReceipts()).toBeGreaterThan(received))
      realm.close()
    }
    expect(reports).toEqual([])
  })

  it('uses the original handshake budget and request deadline without an invented idle close', async () => {
    /** No receiver exists in this host realm unless the caller supplies a concrete container. */
    vi.stubGlobal('navigator', undefined)
    expect(() => serviceWorkerPlugin({ serviceWorker: { postMessage: () => undefined } })).toThrow(
      expect.objectContaining({ source: 'rpc.transport.browser', code: 'INVALID_PEER_SOURCE' })
    )
    /** A silent real-shaped target never supplies the canonical initial response. */
    const empty = serviceWorkerRealm()
    const quiet = empty.page('quiet-client')
    try {
      await expect(
        createRpcHost({
          plugins: [
            serviceWorkerPlugin({
              serviceWorker: quiet.serviceWorker,
              receiver: quiet.receiver,
              connect: { timeoutMs: 25 }
            })
          ]
        })
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      expect(quiet.listeners()).toBe(0)
    } finally {
      empty.close()
    }
    /** Existing business deadline observes silent native loss, without a synthesized close event. */
    const realm = serviceWorkerRealm()
    const page = realm.page('deadline-client')
    const server = await createRpcHost({
      plugins: [serviceWorkerPlugin({ clients: realm.scope })],
      provide: { echo: (value: unknown) => value }
    })
    const host = await createRpcHost({
      plugins: [serviceWorkerPlugin({ serviceWorker: page.serviceWorker, receiver: page.receiver })]
    })
    try {
      expect(await host.serviceWorker.request('echo', 'before')).toBe('before')
      realm.silence()
      await expect(
        host.serviceWorker.request('echo', 'silent', { timeout: timeoutFeature({ ms: 30 }) })
      ).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'DEADLINE_EXCEEDED'
      })
      expect(host.self.instanceId).toBeDefined()
    } finally {
      await Promise.all([host.close(), server.close()])
      realm.close()
    }
  })

  it('opens the current active worker in a new host with a new endpoint instance', async () => {
    /** Separate realm fixtures model replacing registration.active, with no invented native exit. */
    const oldRealm = serviceWorkerRealm()
    const oldPage = oldRealm.page('same-page')
    const oldServer = await createRpcHost({
      plugins: [serviceWorkerPlugin({ clients: oldRealm.scope })],
      provide: { generation: () => 'old' }
    })
    const oldHost = await createRpcHost({
      plugins: [
        serviceWorkerPlugin({ serviceWorker: oldPage.serviceWorker, receiver: oldPage.receiver })
      ]
    })
    const freshRealm = serviceWorkerRealm()
    const freshPage = freshRealm.page('same-page')
    const registration = { active: freshPage.serviceWorker }
    const freshServer = await createRpcHost({
      plugins: [serviceWorkerPlugin({ clients: freshRealm.scope })],
      provide: { generation: () => 'new' }
    })
    /** Default navigator.serviceWorker is the separate native inbound owner for this new page. */
    vi.stubGlobal('navigator', { serviceWorker: freshPage.receiver })
    const freshHost = await createRpcHost({
      plugins: [serviceWorkerPlugin({ serviceWorker: registration.active })]
    })
    try {
      expect(await oldHost.serviceWorker.request('generation')).toBe('old')
      oldRealm.silence()
      expect(await freshHost.serviceWorker.request('generation')).toBe('new')
      expect(freshHost.self.instanceId).not.toBe(oldHost.self.instanceId)
      expect(freshServer.self.instanceId).not.toBe(oldServer.self.instanceId)
    } finally {
      await Promise.all([
        oldHost.close(),
        oldServer.close(),
        freshHost.close(),
        freshServer.close()
      ])
      expect(oldRealm.listeners()).toBe(0)
      expect(freshRealm.listeners()).toBe(0)
      oldRealm.close()
      freshRealm.close()
    }
  })
})
