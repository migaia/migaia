# Qdrant storage backend

Native Qdrant vectors and vector TTL for `@migaia/storage-host`. Install a real Qdrant server and `@qdrant/js-client-rest` 1.11 or later. The SDK is a required peer; only the explicit `/client` adapter accesses it at runtime.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: 'http://127.0.0.1:6333' })] as const
})
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>('documents', { dimensions: 2, metric: 'cosine' })
await documents.upsert([{ id: 'a', vector: [100, 0], payload: { category: 'guide' } }])
console.log(await documents.near([1, 0], { exact: true }).topK(5).withVector().all())
```

Collections are pure descriptors until execution. Cosine uses native search and source vector slots so `withVector`, `similarTo` and the standard centroid recommendation retain the original amplitude at native float32 precision. Dot and Euclid use one native slot; Euclid distances become negative scores. This backend does not score candidates in JavaScript.

| Entry                  | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| Root                   | `qdrantBackendPlugin`, `qdrantBackendKind`, error identity and types              |
| `/http`                | `fetchHttp(url, apiKey?)` using runtime fetch                                     |
| `/client`              | `qdrantClientHttp(client)` borrowing an actual SDK client                         |
| `/features/hybrid`     | Two native dense/sparse RRF branches and sparse-only updates                      |
| `/features/recommend`  | Native `best_score`, lookup and sample semantics                                  |
| `/features/group-by`   | Native multivalue grouping; no `with_lookup`                                      |
| `/features/management` | Collections, aliases, snapshots, filter deletion and explicit expired-point purge |

Only `vector` and vector-target `ttl` are provided. KV, records, RDF, transactions, secondary indexes, change feeds and native live queries are absent. Use the existing host reactive Feature when polling is needed. Explicit lock/concurrency combinations are rejected before native modification.

Read [USEGUIDE.en.md](./USEGUIDE.en.md) for deletion counts, TTL, organization isolation, detection and failure boundaries.
