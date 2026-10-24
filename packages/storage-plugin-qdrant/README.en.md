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

Deletion and standard recommendation capture dense string ID arrays through the shared vector input owner. Native requests retain first-occurrence ID deduplication. Deletion count options use the same shared admission without changing precount or scroll behavior.

Cancellation after SDK dispatch does not undo a native modification; the request can still return success. Backend disposal waits for that actual result. A lost response leaves the outcome unknown and is never replayed automatically. Synchronous observer errors and rejected observer Promises are only reported; intervention uses the host's original pipeline.

## Native named-vector rescoring

`qdrantRescoreFeature` from `@migaia/storage-plugin-qdrant/features/rescore` declares one extra vector slot per logical collection at installation. `dimensions` is required, `metric` defaults to `cosine`, and `multivector: 'max_sim'` selects multivectors instead of dense vectors. Only collections declared in the `collections` map are eligible.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'
await using host = await createStorageHost({
  plugins: [
    qdrantBackendPlugin(
      { url: 'http://localhost:6333' },
      {
        rescore: qdrantRescoreFeature({
          collections: { articles: { dimensions: 2, metric: 'dot' } }
        })
      }
    )
  ]
})
const store = host.backend('qdrant')
const articles = store.use(vector).collection('articles', { dimensions: 2, metric: 'dot' })
await articles.upsert([
  { id: 'a', vector: [2, 0] },
  { id: 'b', vector: [1, 0] }
])
await store.api.qdrantRescore.updateVectors('articles', [
  { id: 'a', vector: [0, 1] },
  { id: 'b', vector: [3, 0] }
])
const hits = await articles
  .near([1, 0])
  .topK(10)
  .rescore({ query: [1, 0], topN: 2 })
  .all()
console.log(hits.map((hit) => ({ id: hit.id, score: hit.score })))
```

`updateVectors(collection,points,ctx?)` changes only the extra slot of existing points in the current organization, uses `wait:true`, and returns the original native `operation_id/status` record. It leaves search/source, payload and TTL intact. Duplicate IDs, sparse arrays and invalid vectors reject before I/O. Multivector writes and queries use nonempty matrices with consistent inner dimensions. Native missing-point failures and unknown write results retain their original error chain and are never replayed automatically.

`rescore` is available only after `topK(k)`. `topN` defaults to k and must be a positive safe integer no greater than k. Each terminal sends one Query API call: prefetch retains the original search slot, k, pushed where, organization, expiry and original minScore; the outer query uses the extra slot and retains topN. `score` is the outer engine score; the protocol does not return prefetch scores. Function where predicates run through the shared reader after outer hits, without refilling, so fewer than topN hits may remain. `withVector()` still returns the original standard vector. Portable `rerank` may follow, preserving the current engine score and adding rerankScore.

Qdrant 1.15.5 needs the extra slot at initial collection creation; existing collections cannot acquire it online. New operations on a missing or incompatible slot reject with `UNSUPPORTED_CAPABILITY`, while standard reads and writes remain usable. No collection is recreated and no data is migrated. Standard upsert still replaces the whole point and can clear the extra slot; applications must rewrite extra vectors afterward. Removing the Feature preserves that same standard replacement behavior. Qdrant owns rescoring and its score; JavaScript does not score candidates.

Qdrant 1.15.5 has a native JSON ambiguity for two-row multivectors whose first row consists of nonnegative integers: it may decode the matrix as a sparse vector and reject it. The original QDRANT_REQUEST_FAILED evidence is preserved; the adapter does not reshape vectors or retry. Three-row matrices and dense vectors are verified against this version.
