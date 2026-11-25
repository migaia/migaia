import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { QdrantText } from '../src/constants.ts'
import { nativeId } from '../src/id.ts'
import { QdrantTestCollections } from './helpers/collections.ts'

/** Binds an ephemeral loopback HTTP server and returns its origin URL. */
async function listenStub(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  /** Bound loopback port assigned by the OS. */
  const address = server.address() as { port: number }
  return 'http://127.0.0.1:' + address.port
}

/** Closes an HTTP stub server cleanly. */
function closeStub(server: Server): Promise<void> {
  /** Deferred promise settled when the server finishes closing. */
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.close((error) => {
    if (error) reject(error)
    else resolve()
  })
  return promise
}

/** Serves collection listing and deletion on a mutable in-memory collection set. */
async function handleCollectionStub(
  request: IncomingMessage,
  response: ServerResponse,
  existing: Set<string>,
  deleted: string[],
  failOn?: string
): Promise<void> {
  for await (const _ of request) void _
  /** Request pathname without query string. */
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && path === '/collections') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        result: { collections: [...existing].map((name) => ({ name })) }
      })
    )
    return
  }
  if (request.method === 'DELETE' && path.startsWith('/collections/')) {
    /** Decoded target collection name from the request path. */
    const name = decodeURIComponent(path.slice('/collections/'.length))
    deleted.push(name)
    if (name === failOn) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: { error: 'injected delete failure' } }))
      return
    }
    existing.delete(name)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ result: true }))
    return
  }
  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ status: { error: 'not found' } }))
}

describe('Qdrant live test collection cleanup', () => {
  it('deletes managed prefix and direct collections on release without touching unrelated collections', async () => {
    /** Registry under test with a unique per-run prefix. */
    const registry = new QdrantTestCollections()
    /** Logical prefix allocated for a managed backend plugin. */
    const prefix = registry.prefix('suite')
    /** Direct collection allocated for a raw protocol test. */
    const direct = registry.collection('native')
    /** Expected physical collection name matching Qdrant backend hashing. */
    const managedPhysical =
      QdrantText.prefix + (await nativeId([prefix])) + '_' + (await nativeId([prefix, 'items']))
    /** Unrelated collection that must never be deleted. */
    const unrelated = 'user_owned_collection'
    /** Live collection names currently stored on the stub server. */
    const existing = new Set([managedPhysical, direct, unrelated])
    /** Ordered list of collection names requested for deletion. */
    const deleted: string[] = []
    /** Ephemeral stub Qdrant server. */
    const server = createServer((request, response) => {
      void handleCollectionStub(request, response, existing, deleted)
    })
    /** Bound origin URL of the stub server. */
    const origin = await listenStub(server)
    try {
      await registry.release(origin)
      expect(new Set(deleted)).toEqual(new Set([managedPhysical, direct]))
      expect([...existing]).toEqual([unrelated])
    } finally {
      await closeStub(server)
    }
  })

  it('continues deleting remaining owned collections when one deletion fails', async () => {
    /** Registry under test with a unique per-run prefix. */
    const registry = new QdrantTestCollections()
    /** First direct collection whose deletion is injected to fail. */
    const failing = registry.collection('first')
    /** Second direct collection that must still be deleted after the first fails. */
    const survivor = registry.collection('second')
    /** Live collection names currently stored on the stub server. */
    const existing = new Set([failing, survivor])
    /** Ordered list of collection names requested for deletion. */
    const deleted: string[] = []
    /** Ephemeral stub Qdrant server failing deletion of `failing`. */
    const server = createServer((request, response) => {
      void handleCollectionStub(request, response, existing, deleted, failing)
    })
    /** Bound origin URL of the stub server. */
    const origin = await listenStub(server)
    try {
      await expect(registry.release(origin)).rejects.toMatchObject({ code: 'QDRANT_UNAVAILABLE' })
      expect(deleted).toEqual([failing, survivor])
      expect(existing.has(survivor)).toBe(false)
    } finally {
      await closeStub(server)
    }
  })
})
