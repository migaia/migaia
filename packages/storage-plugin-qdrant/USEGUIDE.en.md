# Using Qdrant storage

## Queries and payloads

Declare real dimensions and one metric (`cosine`, `dot`, `euclid`) when creating a new logical collection. A descriptor without options resolves an existing native schema on execution. Incompatible schemas reject instead of creating placeholder vectors. `collectionPrefix` defaults to `migaia_` and selects the managed namespace.

`near`, `similarTo` and standard `recommend` return the shared immutable vector chain. `topK` requires a positive safe integer; low-level `search(query, { k })` also accepts zero and performs no search. `exact` defaults to false and uses the engine's native index. `exact: true` requests native exact retrieval. Standard `groupBy` processes only the selected top-k hits. Standard recommendation reads requested source samples and uses the shared positive mean minus negative mean; it does not invoke native `best_score`.

Faithful scalar equality, membership, existence and numeric ranges execute before native ranking. String ranges, substring/prefix predicates and JavaScript functions process only actual bounded native hits. Results can contain fewer than k rows; no refill search occurs. `explain()` reports this distinction, and `requirePushdown()` rejects before native reads when a condition needs client evaluation. Only the reserved organization and expiration paths have mandatory native indexes; arbitrary dynamic scalar paths may be unindexed. Native query cost depends on the actual engine plan, input and returned bytes.

Portable payloads and arbitrary UTF-16 IDs round-trip through the original codec. User payloads cannot replace root `$org` or `$expiresAt`. Complete batches are detached and checked before I/O; repeated IDs retain the last validated point.

## Expiration and numeric deletion

```ts
import { ttl, lockKey, DeleteCountMode } from '@migaia/storage-contract'

await documents.upsert([{ id: 'temporary', vector: [1, 0], payload: { category: 'guide' } }], {
  ttlMs: 5000
})
const target = lockKey.vector('documents', 'temporary')
await host.backend('qdrant').use(ttl).expire(target, 10000)
console.log(await host.backend('qdrant').use(ttl).remaining(target))
await host.backend('qdrant').use(ttl).persist(target)
const deleted = await documents.deleteWhere(
  { category: 'guide' },
  { count: DeleteCountMode.scroll }
)
```

TTL uses one client wall-clock sample and a native datetime payload field. Clock skew between clients affects expiration. Omitted `ttlMs` preserves a live point's deadline; a new or expired point becomes unlimited. Zero means immediately invisible. Missing/unlimited `remaining` returns undefined; `expire` and `persist` return false for missing or expired points. Text, bytes and record TTL targets are unsupported. No background timer removes data.

Deletion includes physically present expired points. Default `precount` sends one exact count followed by one deletion with the same filter and `wait: true`; concurrent writes can make that count differ from the later actual deletion. Explicit `scroll` collects IDs observed on native pages before sending any ID deletion and returns the number of successfully submitted IDs. Writes during scanning may or may not be observed; uncollected IDs added after collection remain. Once collected, an ID is deleted even if its payload changes.

Native precount and management filter deletion reject conditions that Qdrant cannot represent faithfully, including general `contains` and `startsWith`. Use explicit `scroll` for those declarative conditions; it evaluates the shared predicate on actual organization-page candidates. Its cost includes all scanned candidates and collected IDs.

## Native Features

```ts
import { qdrantManagementFeature } from '@migaia/storage-plugin-qdrant/features/management'
import { qdrantHybridFeature } from '@migaia/storage-plugin-qdrant/features/hybrid'
import { qdrantRecommendFeature } from '@migaia/storage-plugin-qdrant/features/recommend'
import { qdrantGroupByFeature } from '@migaia/storage-plugin-qdrant/features/group-by'
```

Pass selected Features as the factory's second argument. They add `store.api.qdrantManagement`, `qdrantHybrid`, `qdrantRecommend` and `qdrantGroupBy`, without transaction APIs. Native methods operate on caller-managed physical collection names and preserve genuine SDK parameter/result types.

Hybrid accepts exactly two named dense/sparse prefetch branches and `{ fusion: 'rrf' }`. Sparse updates require configured sparse names, unique nonnegative integer indices, matching lengths and finite values; dense vectors remain untouched. Native recommendation preserves lookup and strategy differences. Native group search preserves multivalue membership and omits the SDK 1.11 `with_lookup` option because that method does not forward it.

`qdrantManagement.deleteByFilter(logicalCollection, where, { wait?, ordering? }, ctx)` adds the current organization without expiration filtering. `purgeExpired(logicalCollection, { wait? }, ctx)` sends one organization-scoped deletion for deadlines strictly before one client clock sample. Neither counts or scrolls. Both return `{ operationId, status }`, with wait defaulting to true; operation IDs are never counts. Other management methods preserve native booleans and nullable snapshots.

## Organizations, lifetime and failures

`host.org(orgId).backend('qdrant')` shares physical collections and adds native tenant filtering before ranking. Point identities include organization identity. Creating an organization does not create collections or indexes. Native self-managed Feature methods are unavailable in organization views; `deleteByFilter` and `purgeExpired` remain organization-scoped. `host.dropOrg` discovers all managed collections in this configuration's namespace and deletes only the requested organization's points, including expired data, while retaining shared collections and other namespaces.

Detection normally runs during host creation. With `autoDetect: false`, call `host.detect()` explicitly; business terminals reject before detection without sending implicit detection requests. Server and SDK require version 1.11 or later.

Detection checks the standard vector, TTL and organization cleanup methods. Optional native Feature methods are checked when called; an absent method rejects with `UNSUPPORTED_CAPABILITY` before sending a modification.

`dispose()` seals new calls and waits for accepted native requests and iterators. Its primary and symbolic cleanup Promises are separately cached. The backend never closes a borrowed HTTP or SDK client. Native fetch receives the operation cancellation signal. SDK 1.11 lacks per-call signals, so its request must actually settle before admission is released. No write is automatically retried or redirected; sent failures may have an unknown result.

Errors use `storage.backend.qdrant`: native 4xx is `QDRANT_REQUEST_FAILED`, network/5xx is `QDRANT_UNAVAILABLE`, and malformed or unexpected responses are `QDRANT_RESPONSE_INVALID`. Original errors and all evidence available from the adapter stay reachable. HTTP retains full status/body; SDK 1.11 itself discards status and truncates the message of `QdrantClientUnexpectedResponseError` for a non-waiting snapshot returning 202. That path reports response-invalid even though the snapshot may be accepted. The HTTP port returns native null for that accepted response. There is no automatic fallback or replay. Hooks contain sanitized route, elapsed time and available status, without authentication headers or payloads.

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
