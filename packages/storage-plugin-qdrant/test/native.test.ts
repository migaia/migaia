import { createServer } from 'node:http'
import { describe, it, expect } from 'vitest'
import { QdrantClient } from '@qdrant/js-client-rest'
import { fetchHttp } from '../src/http.js'
import { qdrantClientHttp } from '../src/client.js'
/** The original shared launcher supplies the actual native-service address. */
const url = process.env.MIGAIA_QDRANT_URL
describe('native Qdrant protocol adapters', () => {
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
            await http.recommend(name, {
              positive: [1],
              using: 'dense',
              strategy: 'best_score',
              limit: 1
            })
          ).toHaveLength(1)
          expect(
            (
              await http.searchPointGroups(name, {
                vector: { name: 'dense', vector: [1, 0] },
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
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
