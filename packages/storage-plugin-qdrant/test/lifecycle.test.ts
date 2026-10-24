import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { QdrantClient } from '@qdrant/js-client-rest'
import { deferred } from '@migaia/utils/promise'
import { vector } from '@migaia/storage-contract'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { qdrantBackendPlugin } from '../src/plugin.js'
import { qdrantClientHttp } from '../src/client.js'
import { qdrantManagementFeature } from '../src/features/management.js'

/** The canonical launcher supplies the actual engine; no alternate service or private API is used. */
const url = process.env.MIGAIA_QDRANT_URL
/** Record only fixture protocol bodies, never authentication headers or SDK configuration. */
type IWire = { readonly path: string; readonly method: string; readonly body: string }

/** Forward real SDK traffic, controlling only one already-completed native mutation's response. */
async function forwardedNative() {
  /** Every collection recorded here was created through this fresh fixture's own listener. */
  const created = new Set<string>()
  /** Observations distinguish actual wire sends from the caller's logical attempts. */
  const requests: IWire[] = []
  /** Unexpected forwarding faults remain explicit test failures rather than detached rejections. */
  const failures: unknown[] = []
  /** The held request has already received a full success response from the real upstream. */
  const applied = deferred<IWire>()
  /** Cleanup may always release a response, even when a preceding assertion fails. */
  const resume = deferred<void>()
  /**
   * This finite fixture controls at most one selected mutation; it never queues or retries
   * requests.
   */
  let selected:
    | {
        readonly suffix: string
        readonly outcome: 'hold' | 'disconnect'
        readonly method: 'POST' | 'PUT'
      }
    | undefined
  /** The local listener changes response delivery, not Qdrant execution or SDK behavior. */
  const server = createServer((request, response) => {
    void (async () => {
      /** Fixture JSON bodies are retained only to prove the native send happened exactly once. */
      let body = ''
      for await (const chunk of request) body += chunk
      /** Request paths already carry the SDK's actual collection and query parameters. */
      const wire = { path: request.url!, method: request.method!, body }
      requests.push(wire)
      /** Use the real service's response without replacing schema, point or operation data. */
      const upstream = await fetch(new URL(wire.path, url!), {
        method: wire.method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === '' ? {} : { body }),
        redirect: 'manual'
      })
      /** Reading the complete upstream body establishes actual native settlement before holding. */
      const text = await upstream.text()
      /** Only successful creates transfer fixture cleanup ownership of a fresh collection. */
      const path = new URL(wire.path, url!).pathname
      if (upstream.ok && wire.method === 'PUT' && /^\/collections\/[^/]+$/.test(path))
        created.add(decodeURIComponent(path.split('/')[2]!))
      if (
        selected !== undefined &&
        wire.method === selected.method &&
        path.endsWith(selected.suffix)
      ) {
        /** Selection is consumed once, so any SDK replay would be a second observable real send. */
        const control = selected
        selected = undefined
        applied.resolve(wire)
        if (control.outcome === 'hold') await resume.promise
        else {
          response.destroy()
          return
        }
      }
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json'
      })
      response.end(text)
    })().catch((error) => {
      failures.push(error)
      response.destroy()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  /** The actual caller-owned SDK talks to this listener and remains usable after backend disposal. */
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const client = new QdrantClient({ url: origin })
  return {
    origin,
    client,
    http: qdrantClientHttp(client),
    requests,
    created,
    applied: applied.promise,
    release: () => resume.resolve(),
    control: (suffix: string, outcome: 'hold' | 'disconnect', method: 'POST' | 'PUT' = 'POST') => {
      selected = { suffix, outcome, method }
    },
    close: async () => {
      resume.resolve()
      try {
        for (const name of created) await client.deleteCollection(name)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
      expect(failures).toEqual([])
    }
  }
}

describe('real SDK request and backend lifetime boundaries', () => {
  it.skipIf(!url)(
    'drains an already-sent SDK snapshot after cancellation and preserves both disposal Promises',
    async () => {
      const native = await forwardedNative()
      const name = 'lifetime_' + crypto.randomUUID().replaceAll('-', '')
      await native.client.createCollection(name, { vectors: { size: 2, distance: 'Dot' } })
      const host = await createStorageHost({
        plugins: [
          qdrantBackendPlugin(
            { url: native.origin, http: native.http },
            { management: qdrantManagementFeature() }
          )
        ]
      })
      const store = host.backend('qdrant')
      const caller = new AbortController()
      try {
        native.control('/snapshots', 'hold')
        let settled = false
        const pending = store.api.qdrantManagement
          .createSnapshot(name, { wait: true }, { signal: caller.signal })
          .finally(() => {
            settled = true
          })
        const wire = await native.applied
        expect(wire.method).toBe('POST')
        caller.abort('caller cancellation after native dispatch')
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(settled).toBe(false)
        const main = store.dispose()
        const symbolic = store[Symbol.asyncDispose]()
        expect(store.dispose()).toBe(main)
        expect(store[Symbol.asyncDispose]()).toBe(symbolic)
        expect(main).not.toBe(symbolic)
        let closed = false
        void main.then(() => {
          closed = true
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(closed).toBe(false)
        const before = native.requests.length
        await expect(
          Promise.resolve().then(() => store.api.qdrantManagement.getCollections())
        ).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
        expect(native.requests).toHaveLength(before)
        native.release()
        expect(await pending).toMatchObject({ name: expect.any(String), size: expect.any(Number) })
        await Promise.all([main, symbolic])
        expect(
          native.requests.filter((request) =>
            new URL(request.path, native.origin).pathname.endsWith('/snapshots')
          )
        ).toHaveLength(1)
        expect((await native.client.getCollection(name)).config.params.vectors).toMatchObject({
          size: 2,
          distance: 'Dot'
        })
      } finally {
        native.release()
        await host.dispose()
        await native.close()
      }
    },
    30_000
  )

  it.skipIf(!url)(
    'retains an applied SDK modification after a lost response without replaying it',
    async () => {
      const native = await forwardedNative()
      const host = await createStorageHost({
        plugins: [
          qdrantBackendPlugin({
            url: native.origin,
            http: native.http,
            collectionPrefix: crypto.randomUUID()
          })
        ]
      })
      const collection = host
        .backend('qdrant')
        .use(vector)
        .collection('unknown', { dimensions: 2, metric: 'dot' })
      try {
        await collection.upsert([{ id: 'before', vector: [1, 0] }])
        native.control('/points', 'disconnect', 'PUT')
        await expect(
          collection.upsert([{ id: 'applied-without-ack', vector: [2, 0] }])
        ).rejects.toMatchObject({
          source: 'storage.backend.qdrant',
          code: 'QDRANT_UNAVAILABLE',
          cause: expect.any(Error)
        })
        const wire = await native.applied
        expect(wire.method).toBe('PUT')
        expect(
          native.requests.filter(
            (request) =>
              request.method === 'PUT' &&
              new URL(request.path, native.origin).pathname.endsWith('/points')
          )
        ).toHaveLength(2)
        expect(await collection.search([1, 0], { k: 2, exact: true })).toEqual([
          { id: 'applied-without-ack', score: 2 },
          { id: 'before', score: 1 }
        ])
        await host.dispose()
        const name = [...native.created][0]!
        expect((await native.client.count(name, { exact: true })).count).toBe(2)
      } finally {
        await host.dispose()
        await native.close()
      }
    },
    30_000
  )

  it.skipIf(!url)(
    'contains synchronous and rejected observers while one native read/write each enter the original stage once',
    async () => {
      const native = await forwardedNative()
      const counts = new Map<string, number>()
      const report = vi.fn()
      const stage = definePlugin('counting', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            counts.set(input.operation, (counts.get(input.operation) ?? 0) + 1)
            await next(input)
          })
          return {}
        }
      }))
      const host = await createStorageHost({
        plugins: [
          qdrantBackendPlugin({
            url: native.origin,
            http: native.http,
            collectionPrefix: crypto.randomUUID()
          }),
          stage
        ],
        report
      })
      const failures = [
        new RangeError('before operation sync'),
        new TypeError('before operation rejection'),
        new RangeError('before acquire sync'),
        new TypeError('before acquire rejection')
      ]
      host.hooks.on('beforeStorageOperation', () => {
        throw failures[0]
      })
      host.hooks.on('beforeStorageOperation', () => Promise.reject(failures[1]))
      host.hooks.on('beforeLockAcquire', () => {
        throw failures[2]
      })
      host.hooks.on('beforeLockAcquire', () => Promise.reject(failures[3]))
      const collection = host
        .backend('qdrant')
        .use(vector)
        .collection('observers', { dimensions: 2, metric: 'dot' })
      try {
        await collection.upsert([{ id: 'one', vector: [1, 0] }])
        expect(await collection.search([1, 0], { k: 1, exact: true })).toEqual([
          { id: 'one', score: 1 }
        ])
        expect([...counts]).toEqual([
          ['vector.upsert', 1],
          ['vector.search', 1]
        ])
        await new Promise<void>((resolve) => setImmediate(resolve))
        for (const failure of failures)
          expect(report.mock.calls.filter(([error]) => error === failure)).toHaveLength(2)
      } finally {
        await host.dispose()
        await native.close()
      }
    },
    30_000
  )
})
