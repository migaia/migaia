import { afterEach, describe, expect, it } from 'vitest'
import { QdrantClient } from '@qdrant/js-client-rest'
import { createStorageHost } from '@migaia/storage-host'
import { ttl, vector } from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { qdrantBackendPlugin, type IQdrantHttp } from '../src/index.js'
import { fetchHttp } from '../src/http.js'
import { qdrantClientHttp } from '../src/client.js'

/** Both actual adapters consume the same service address from the repository fixture launcher. */
const url = process.env.MIGAIA_QDRANT_URL
for (const transport of ['http', 'client'] as const)
  describe.skipIf(!url)(`standard conformance through ${transport}`, () => {
    /** Runner cleanup removes only collections created by this case after canonical disposal. */
    let cleanup: (() => Promise<void>) | undefined
    afterEach(async () => {
      await cleanup?.()
      cleanup = undefined
    })
    runConformance(
      { describe, expect, it },
      {
        name: 'isolated native vector and TTL',
        capabilities: [vector, ttl],
        features: {
          syncRead: false,
          binary: false,
          records: false,
          transactions: false,
          iteration: false,
          secondaryIndexes: false,
          changeFeed: false,
          maxValueBytes: undefined,
          opaqueEntries: false
        },
        async create() {
          const original =
              transport === 'http'
                ? fetchHttp(url!)
                : qdrantClientHttp(new QdrantClient({ url: url! })),
            created: string[] = [],
            http: IQdrantHttp = {
              ...original,
              async createCollection(...args) {
                const result = await original.createCollection(...args)
                created.push(args[0])
                return result
              }
            },
            host = await createStorageHost({
              plugins: [
                qdrantBackendPlugin({
                  url: url!,
                  http,
                  collectionPrefix: crypto.randomUUID()
                })
              ] as const
            })
          cleanup = async () => {
            try {
              await host.dispose()
            } finally {
              for (const collection of created) await original.deleteCollection(collection)
            }
          }
          return host.backend('qdrant')
        }
      }
    )
  })
