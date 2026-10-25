# Qdrant usage guide

Start a real Qdrant service first. Examples default to `http://127.0.0.1:6333`; set `QDRANT_URL` for another service address. Each uses a fresh collection name and writes data. Host disposal does not delete collections.

## Find your scenario

| Need                                   | Scenario                                          |
| -------------------------------------- | ------------------------------------------------- |
| Search payloads and retrieve vectors   | [Search and filters](#search-and-filters)         |
| Set expiry or delete by condition      | [Expiry and deletion](#expiry-and-deletion)       |
| Rank using extra multivectors          | [Multivector reranking](#multivector-reranking)   |
| Share collections across organizations | [Organization isolation](#organization-isolation) |

## Search and filters

A category condition should run before ranking when possible. Client conditions can only remove hits already returned by the engine.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([
  { id: 'a', vector: [2, 0], payload: { category: 'guide' } },
  { id: 'b', vector: [1, 0], payload: { category: 'news' } }
])
const query = documents.near([1, 0], { exact: true }).where({ category: 'guide' }).topK(2)
const hits = await query.withVector().all()
console.log(hits.map((hit) => hit.id).join(','))
console.log(hits[0]?.vector?.join(','))
```

Expected output:

```text
a
2,0
```

`dimensions` sets vector size. `metric` is cosine, dot or euclid. Omitting the whole options object reads an existing schema; a mismatch rejects. Constructing a collection performs no I/O. `exact` defaults to false; true requests native exact search. `topK(k)` requires a positive safe integer. Low-level `search(query, {k: 0})` returns no hits without sending a search.

`near` uses the supplied vector, `similarTo(id)` reads an original sample, and standard `recommend` uses the positive-sample mean minus the negative-sample mean. Cosine keeps search and original-sample slots so `withVector()` retains input magnitude within native float32 precision. Euclid distance is negated to produce score. Standard `groupBy` handles only the selected top-k hits.

Exactly expressible scalar equality, membership, existence and numeric ranges run in the engine. String ranges, substring/prefix conditions and function predicates run after ranking, without refill; fewer than k hits can remain. `explain()` identifies client work. `requirePushdown()` rejects it with QUERY_NOT_PUSHABLE before search I/O. Payloads cannot overwrite reserved root paths `$org` and `$expiresAt`. Portable payloads and arbitrary UTF-16 string IDs round-trip through the shared codec. Upsert validates the whole batch before I/O and keeps the last validated point for a repeated ID. Deletion and standard recommendation deduplicate IDs by first occurrence.

## Expiry and deletion

Persist a temporary point, then delete it through an explicit scan without relying on a timer firing at a particular instant.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, DeleteCountMode } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([{ id: 'a', vector: [1, 0], payload: { category: 'guide' } }], {
  ttlMs: 60_000
})
const ttlApi = host.backend('qdrant').use(ttl)
const target = lockKey.vector(name, 'a')
console.log(await ttlApi.persist(target))
console.log(await ttlApi.remaining(target))
console.log(await documents.deleteWhere({ category: 'guide' }, { count: DeleteCountMode.scroll }))
```

Expected output:

```text
true
undefined
1
```

`ttlMs` is nonnegative milliseconds; 0 makes a point immediately invisible. Omission retains an active point's expiry; new or already-expired points become persistent. `expire` and `persist` return false for missing/expired points. `remaining` returns undefined for missing/persistent points. Only `lockKey.vector(collection, id)` targets are supported. Expiry uses the client wall clock, so skew matters. There is no background physical-deletion task.

Deletion includes expired points that physically remain. Default precount issues an exact count and a wait:true deletion with the same filter. Concurrent changes may make the count differ from the final deletion. scroll collects matching IDs before deleting them in batches and returns successfully committed IDs. Scanning is not a snapshot: new points may be seen or left behind, and collected IDs are deleted even if they later stop matching.

If a condition cannot be represented exactly, precount and management deleteByFilter reject with source `@migaia/storage-contract`, code UNSUPPORTED_CAPABILITY. Explicit `count: 'scroll'` supports common predicates by scanning this organization's candidates.

## Multivector reranking

Recall candidates with standard vectors, then select final hits with an extra multivector slot.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'

const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
await using host = await createStorageHost({
  plugins: [
    qdrantBackendPlugin(
      { url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' },
      {
        rescore: qdrantRescoreFeature({
          collections: { [name]: { dimensions: 2, metric: 'dot', multivector: 'max_sim' } }
        })
      }
    )
  ]
})
const store = host.backend('qdrant')
const documents = store.use(vector).collection(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([
  { id: 'a', vector: [2, 0] },
  { id: 'b', vector: [1, 0] }
])
await store.api.qdrantRescore.updateVectors(name, [
  {
    id: 'a',
    vector: [
      [0, 1],
      [0, 1]
    ]
  },
  {
    id: 'b',
    vector: [
      [3, 0],
      [3, 0]
    ]
  }
])
const hits = await documents
  .near([1, 0])
  .topK(2)
  .rescore({
    query: [
      [1, 0],
      [1, 0]
    ],
    topN: 1
  })
  .all()
console.log(hits.map((hit) => hit.id).join(','))
```

Expected output:

```text
b
```

At installation, collections maps logical names to extra slots. dimensions is required; metric defaults to cosine. `multivector: 'max_sim'` selects a nonempty matrix; omission selects dense vectors. Only declared collections are accepted. Updates and queries support two-row all-integer matrices. Both fetch and SDK adapters encode multivector numbers as float JSON literals such as `1.0`, preserving values, payloads and sparse indices.

updateVectors changes only the extra slot of existing points in the current organization, with wait:true. It returns a native operation result without changing standard vectors, payload or expiry. Duplicate IDs, empty/ragged matrices and invalid numbers reject before the request. Put rescore after topK(k). topN defaults to k and must be a safe integer from 1 through k. Each terminal uses one Query API request: prefetch uses the original search slot, organization, expiry, pushable conditions and minScore to recall k, then the outer query selects topN. Score is the final engine score. Function predicates filter outer hits without refill. withVector() still returns standard vectors; common rerank adds rerankScore separately.

Qdrant 1.15.5 requires the extra slot when a collection is first created. Missing/mismatched slots in older collections reject the new feature with UNSUPPORTED_CAPABILITY. No collection is recreated and no data migrated; standard reads/writes remain available. Standard upsert replaces the whole point and may clear its extra slot, so update extra vectors afterwards.

## Organization isolation

The same logical ID can hold different vectors in two organizations. Organization filtering happens before ranking.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
const tenant = host
  .org('11111111-1111-4111-8111-111111111111')
  .backend('qdrant')
  .use(vector)
  .collection(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([{ id: 'a', vector: [1, 0] }])
await tenant.upsert([{ id: 'a', vector: [2, 0] }])
console.log((await documents.near([1, 0]).topK(1).all())[0]?.score)
console.log((await tenant.near([1, 0]).topK(1).all())[0]?.score)
```

Expected output:

```text
1
2
```

Organization views share physical collections without creating collections/indexes per organization. dropOrg(id) discovers managed collections within collectionPrefix and removes only that organization's points, including expired ones. Shared collections and other organizations remain.

## Choose native features

Pass Features as the factory's second argument to add methods under store.api. None has a transaction projection.

| Entry and factory                                     | API and limits                                                                                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/features/hybrid` · `qdrantHybridFeature()`          | qdrantHybrid.query requires exactly two named dense/sparse prefetch branches with rrf fusion. updateSparseVectors changes configured sparse slots only; indices are unique nonnegative integers with equally sized finite values. |
| `/features/recommend` · `qdrantRecommendFeature()`    | qdrantRecommend.recommend preserves best_score, lookup and native sample strategies.                                                                                                                                              |
| `/features/group-by` · `qdrantGroupByFeature()`       | qdrantGroupBy.search preserves multivalue groups; SDK 1.11's unforwarded with_lookup option is absent.                                                                                                                            |
| `/features/management` · `qdrantManagementFeature()`  | Collections, aliases, snapshots and explicit deletion.                                                                                                                                                                            |
| `/features/rescore` · `qdrantRescoreFeature(options)` | Extra-slot writes and query reranking.                                                                                                                                                                                            |

Self-managed native methods use physical collection names and are available only in the default organization. Management deleteByFilter(logicalCollection, where, options?, ctx?) and purgeExpired(logicalCollection, options?, ctx?) also work in organization views. The former does not add an active-point condition; the latter samples the wall clock once. Neither counts nor scrolls. Both return `{operationId, status}`; wait defaults to true. Filter deletion accepts weak, medium or strong ordering. An operationId is not a deletion count. Other methods retain native boolean/nullable snapshot results.

## Connections and failures

The root uses fetch by default. `/http` exports fetchHttp(url, apiKey?); `/client` exports qdrantClientHttp(client) for a real SDK client. Configuration and lifetime remain with the caller. SDK 1.11 has no per-call signal, so a dispatched request must settle. Fetch receives the operation signal. Closing rejects new calls and waits for actual requests and iterators. Detection checks methods needed for standard vector, TTL and organization cleanup. Optional native Feature methods are checked when called; a missing method rejects with UNSUPPORTED_CAPABILITY before mutation.

Mutations are sent once without automatic retry or redirect following. Explicit 4xx errors use QDRANT_REQUEST_FAILED, network/5xx errors use QDRANT_UNAVAILABLE, and invalid responses use QDRANT_RESPONSE_INVALID, all with source storage.backend.qdrant. HTTP retains available status/body evidence. For a nonwaiting snapshot with HTTP 202, SDK 1.11 may discard status and truncate the message. response-invalid then does not establish rejection; fetch returns native null. Inspect native state before deciding to retry.

Hooks observe only; their throws/rejections are reported without cancelling the operation. Use the host pipeline to change behavior. Telemetry contains neither authentication headers nor request bodies. Only reserved organization/expiry paths are guaranteed indexes. Dynamic payload paths may be unindexed; cost depends on the engine plan, candidate count and transferred bytes.
