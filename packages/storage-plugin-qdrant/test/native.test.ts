import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { describe, it, expect } from 'vitest'
import { QdrantClient } from '@qdrant/js-client-rest'
import { createStorageHost } from '@migaia/storage-host'
import { qdrantBackendPlugin } from '../src/index.ts'
import { fetchHttp } from '../src/http.ts'
import { qdrantClientHttp } from '../src/client.ts'
import { qdrantRecommendFeature } from '../src/features/recommend.ts'
import { qdrantGroupByFeature } from '../src/features/group-by.ts'
/** The original shared launcher supplies the actual native-service address. */
const url = process.env.MIGAIA_QDRANT_URL

/** Binds an HTTP stub server to an ephemeral loopback port and returns its origin URL. */
async function listenStubServer(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  /** Ephemeral bound loopback address. */
  const address = server.address() as { port: number }
  return 'http://127.0.0.1:' + address.port
}

/** Closes an HTTP stub server and resolves once all sockets drain. */
function closeStubServer(server: Server): Promise<void> {
  /** Deferred promise settled when the server close callback fires. */
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.close((error) => {
    if (error) reject(error)
    else resolve()
  })
  return promise
}

/** Handles one native feature stub request for version, points/query, and points/query/groups. */
async function handleNativeFeatureStubRequest(
  request: IncomingMessage,
  response: ServerResponse,
  received: { path: string; body: unknown }[]
): Promise<void> {
  /** Collected request body byte chunks. */
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  /** Decoded UTF-8 JSON body text. */
  const raw = Buffer.concat(chunks).toString('utf8')
  /** Request URL path. */
  const path = request.url ?? ''
  response.writeHead(200, { 'Content-Type': 'application/json' })
  if (path === '/') {
    response.end(JSON.stringify({ title: 'qdrant', version: '1.15.5' }))
    return
  }
  received.push({ path, body: raw ? JSON.parse(raw) : undefined })
  if (path.endsWith('/points/query/groups')) {
    response.end(
      JSON.stringify({
        result: {
          groups: [{ id: 'a', hits: [{ id: 1, version: 1, score: 0.9 }] }]
        }
      })
    )
    return
  }
  response.end(
    JSON.stringify({
      result: {
        points: [{ id: 2, version: 1, score: 0.8 }]
      }
    })
  )
}

/** Creates an HTTP stub server answering version, points/query, and points/query/groups. */
function createNativeFeatureStubServer(received: { path: string; body: unknown }[]): Server {
  return createServer((request, response) => {
    void handleNativeFeatureStubRequest(request, response, received)
  })
}
describe('native Qdrant protocol adapters', () => {
  it.skipIf(!url).each(['fetch', 'sdk'] as const)(
    '%s encodes two-row integer multivectors for native upsert, update and query',
    async (transport) => {
      /** Each adapter keeps its original client and transport configuration. */
      const http =
        transport === 'fetch' ? fetchHttp(url!) : qdrantClientHttp(new QdrantClient({ url: url! }))
      /** Only this fixture owns and removes this fresh native collection. */
      const name = 'multivector_' + crypto.randomUUID().replaceAll('-', '')
      await http.createCollection(name, {
        vectors: {
          multi: { size: 2, distance: 'Dot', multivector_config: { comparator: 'max_sim' } }
        },
        sparse_vectors: { sparse: {} }
      })
      try {
        await http.upsert(name, {
          points: [
            {
              id: 1,
              vector: {
                multi: [
                  [0, 0],
                  [0, 1]
                ]
              },
              payload: {
                matrix: [
                  [1, 2],
                  [3, 4]
                ]
              }
            },
            {
              id: 2,
              vector: {
                multi: [
                  [1, 2],
                  [3, 4]
                ]
              }
            }
          ],
          wait: true
        })
        expect(
          await http.retrieve(name, { ids: [1, 2], with_vector: true, with_payload: true })
        ).toMatchObject([
          {
            id: 1,
            vector: {
              multi: [
                [0, 0],
                [0, 1]
              ]
            },
            payload: {
              matrix: [
                [1, 2],
                [3, 4]
              ]
            }
          },
          {
            id: 2,
            vector: {
              multi: [
                [1, 2],
                [3, 4]
              ]
            }
          }
        ])
        await http.updateVectors(name, {
          points: [
            {
              id: 1,
              vector: {
                multi: [
                  [1, 0],
                  [0, 1]
                ],
                sparse: { indices: [1], values: [1] }
              }
            },
            {
              id: 2,
              vector: {
                multi: [
                  [2, 0],
                  [0, 2]
                ]
              }
            }
          ],
          wait: true
        })
        expect(
          (await http.retrieve(name, { ids: [1], with_vector: true }))[0]!.vector
        ).toMatchObject({
          multi: [
            [1, 0],
            [0, 1]
          ],
          sparse: { indices: [1], values: [1] }
        })
        expect(
          (
            await http.query(name, {
              query: [
                [1, 0],
                [0, 1]
              ],
              using: 'multi',
              params: { exact: true },
              limit: 2
            })
          ).points
        ).toMatchObject([
          { id: 2, score: 4 },
          { id: 1, score: 2 }
        ])
      } finally {
        await http.deleteCollection(name)
      }
    }
  )
  it.skipIf(!url)(
    'executes the complete finite port against the real engine and preserves native source vectors',
    async () => {
      const adapters = [fetchHttp(url!), qdrantClientHttp(new QdrantClient({ url: url! }))]
      for (const http of adapters) {
        const name = 'native_' + crypto.randomUUID().replaceAll('-', ''),
          alias = name + '_alias'
        expect(await http.getVersion()).toMatch(/^1\./)
        await http.createCollection(name, {
          vectors: {
            dense: { size: 2, distance: 'Cosine' },
            source: { size: 2, distance: 'Dot', hnsw_config: { m: 0, payload_m: 0 } }
          },
          sparse_vectors: { sparse: {} }
        })
        try {
          expect(
            (await http.getCollections()).collections.some((collection) => collection.name === name)
          ).toBe(true)
          expect((await http.getCollection(name)).config.params.vectors).toMatchObject({
            dense: { size: 2, distance: 'Cosine' }
          })
          await http.createPayloadIndex(name, {
            field_name: '"$org"',
            field_schema: { type: 'keyword', is_tenant: true },
            wait: true
          })
          await http.createPayloadIndex(name, {
            field_name: '"$expiresAt"',
            field_schema: 'datetime',
            wait: true
          })
          await http.upsert(name, {
            points: [
              {
                id: 1,
                vector: { dense: [100, 0], source: [100, 0] },
                payload: { $org: 'fixture', category: 'a' }
              },
              {
                id: 2,
                vector: { dense: [0, 1], source: [0, 1] },
                payload: { $org: 'fixture', category: 'b' }
              }
            ],
            wait: true
          })
          expect(
            (await http.retrieve(name, { ids: [1], with_vector: true }))[0]!.vector
          ).toMatchObject({ dense: [1, 0], source: [100, 0] })
          expect(
            (
              await http.query(name, {
                query: [1, 0],
                using: 'dense',
                params: { exact: true },
                limit: 1
              })
            ).points[0]!.id
          ).toBe(1)
          expect(
            (
              await http.count(name, {
                filter: { must: [{ key: '"$org"', match: { value: 'fixture' } }] },
                exact: true
              })
            ).count
          ).toBe(2)
          expect((await http.scroll(name, { limit: 1, with_payload: true })).points).toHaveLength(1)
          await http.setPayload(name, {
            points: [1],
            payload: { $expiresAt: '2030-01-01T00:00:00.000Z' },
            wait: true
          })
          expect(
            (await http.retrieve(name, { ids: [1], with_payload: true }))[0]!.payload
          ).toHaveProperty('$expiresAt')
          await http.deletePayload(name, { points: [1], keys: ['"$expiresAt"'], wait: true })
          expect(
            (await http.retrieve(name, { ids: [1], with_payload: true }))[0]!.payload
          ).not.toHaveProperty('$expiresAt')
          await http.updateVectors(name, {
            points: [{ id: 1, vector: { sparse: { indices: [1], values: [0.5] } } }],
            wait: true
          })
          expect(
            (await http.retrieve(name, { ids: [1], with_vector: true }))[0]!.vector
          ).toMatchObject({
            dense: [1, 0],
            source: [100, 0],
            sparse: { indices: [1], values: [0.5] }
          })
          expect(
            (
              await http.query(name, {
                query: { recommend: { positive: [1], strategy: 'best_score' } },
                using: 'dense',
                limit: 1
              })
            ).points
          ).toHaveLength(1)
          expect(
            (
              await http.queryGroups(name, {
                query: [1, 0],
                using: 'dense',
                group_by: 'category',
                group_size: 1,
                limit: 2
              })
            ).groups
          ).toHaveLength(2)
          expect(
            await http.updateCollectionAliases({
              actions: [{ create_alias: { collection_name: name, alias_name: alias } }]
            })
          ).toBe(true)
          expect((await http.getCollection(alias)).points_count).toBe(2)
          await http.updateCollectionAliases({ actions: [{ delete_alias: { alias_name: alias } }] })
          const snapshot = await http.createSnapshot(name, { wait: true })
          expect(snapshot === null || typeof snapshot === 'object').toBe(true)
          if (http === adapters[0])
            expect(await http.createSnapshot(name, { wait: false })).toBe(null)
          else
            await expect(http.createSnapshot(name, { wait: false })).rejects.toMatchObject({
              code: 'QDRANT_RESPONSE_INVALID',
              name: 'QdrantClientUnexpectedResponseError',
              message: expect.stringContaining('202')
            })
          await http.delete(name, { points: [1, 2], wait: true })
          expect((await http.count(name, { exact: true })).count).toBe(0)
        } finally {
          await http.deleteCollection(name)
        }
      }
    },
    30_000
  )
  it('does not replay native SDK or fetch modifications across redirects and retains full native failures', async () => {
    const destinations: string[] = [],
      requests: string[] = []
    const server = createServer(async (request, response) => {
      for await (const _ of request) void _
      requests.push(request.url!)
      if (request.url?.startsWith('/destination')) {
        destinations.push(request.url)
        response.end(JSON.stringify({ result: { operation_id: 1, status: 'completed' } }))
        return
      }
      const status = request.url?.includes('308')
        ? 308
        : request.url?.includes('307')
          ? 307
          : request.url?.includes('404')
            ? 404
            : request.url?.includes('503')
              ? 503
              : 200
      response.writeHead(status, {
        'Content-Type': 'application/json',
        ...(status === 307 || status === 308 ? { Location: '/destination' } : {})
      })
      response.end(
        status === 200
          ? 'broken json'
          : JSON.stringify({ error: 'native complete response ' + status })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number },
      origin = 'http://127.0.0.1:' + address.port
    try {
      for (const http of [fetchHttp(origin), qdrantClientHttp(new QdrantClient({ url: origin }))]) {
        for (const status of [307, 308])
          await expect(http.upsert('c' + status, { points: [], wait: true })).rejects.toMatchObject(
            { code: 'QDRANT_RESPONSE_INVALID', cause: { status } }
          )
        await expect(http.query('c404', { query: [1, 0] })).rejects.toMatchObject({
          code: 'QDRANT_REQUEST_FAILED',
          cause: { status: 404 }
        })
        await expect(http.query('c503', { query: [1, 0] })).rejects.toMatchObject({
          code: 'QDRANT_UNAVAILABLE',
          cause: { status: 503 }
        })
        await expect(http.query('bad', { query: [1, 0] })).rejects.toMatchObject({
          code: 'QDRANT_RESPONSE_INVALID'
        })
      }
      expect(destinations).toHaveLength(0)
      expect(requests.filter((path) => path.includes('c307'))).toHaveLength(2)
      expect(requests.filter((path) => path.includes('c308'))).toHaveLength(2)
    } finally {
      await closeStubServer(server)
    }
  })
  it('routes qdrantRecommend to points/query and qdrantGroupBy to points/query/groups for both fetch and SDK', async () => {
    /** Recorded request path and parsed JSON body for each native feature dispatch. */
    const received: { path: string; body: unknown }[] = []
    /** Local HTTP stub answering version, points/query, and points/query/groups. */
    const server = createNativeFeatureStubServer(received)
    /** Bound origin URL of the native feature stub server. */
    const origin = await listenStubServer(server)
    try {
      for (const http of [fetchHttp(origin), qdrantClientHttp(new QdrantClient({ url: origin }))]) {
        /** Storage host configured with recommend and group-by native features. */
        const host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin({
              url: origin,
              http,
              features: {
                recommend: qdrantRecommendFeature(),
                groups: qdrantGroupByFeature()
              }
            })
          ] as const
        })
        try {
          /** Bound Qdrant backend store handle. */
          const store = host.backend('qdrant')
          /** Recommend query result from the native points/query endpoint. */
          const rec = await store.api.qdrantRecommend.recommend('items', {
            query: { recommend: { positive: [1], negative: [3], strategy: 'best_score' } },
            using: 'dense',
            limit: 1
          })
          expect(rec.points).toHaveLength(1)
          /** Group-by query result from the native points/query/groups endpoint. */
          const grp = await store.api.qdrantGroupBy.search('items', {
            query: [1, 0],
            using: 'dense',
            group_by: 'category',
            group_size: 2,
            limit: 2
          })
          expect(grp.groups).toHaveLength(1)
        } finally {
          await host.dispose()
        }
      }
      expect(received).toEqual([
        {
          path: '/collections/items/points/query',
          body: {
            query: { recommend: { positive: [1], negative: [3], strategy: 'best_score' } },
            using: 'dense',
            limit: 1
          }
        },
        {
          path: '/collections/items/points/query/groups',
          body: {
            query: [1, 0],
            using: 'dense',
            group_by: 'category',
            group_size: 2,
            limit: 2
          }
        },
        {
          path: '/collections/items/points/query',
          body: {
            query: { recommend: { positive: [1], negative: [3], strategy: 'best_score' } },
            using: 'dense',
            limit: 1
          }
        },
        {
          path: '/collections/items/points/query/groups',
          body: {
            query: [1, 0],
            using: 'dense',
            group_by: 'category',
            group_size: 2,
            limit: 2
          }
        }
      ])
    } finally {
      await closeStubServer(server)
    }
  })
})
