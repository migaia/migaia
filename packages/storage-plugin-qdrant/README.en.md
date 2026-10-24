# @migaia/storage-plugin-qdrant

Store vectors and their payloads in a real Qdrant service, then use query chains for nearest-neighbor search, filtering and supported reranking instead of repeating native requests and organization filters throughout the application. Configure the service URL, install the plugin in a host, and select the vector capability and a collection. Standard queries apply organization and expiry filters before ranking; physically removing expired points is an explicit application operation.

## Sound familiar?

- Another tenant's points appear because one native request forgot its tenant condition.
- Search returns too few hits because filtering happened after candidate selection.
- Expired vectors still occupy disk because query visibility was mistaken for physical deletion.
- Reranking fails on an older collection that has no extra named vector slot.

## Why choose it?

- Standard queries apply organization and expiry filters before native ranking. See [Organization isolation](./USEGUIDE.en.md#organization-isolation).
- `explain()` identifies client filtering; `requirePushdown()` can reject it. See [Search and filters](./USEGUIDE.en.md#search-and-filters).
- Native reranking supports two-row all-integer multivectors. Float JSON tokens avoid ambiguous sparse-tuple decoding. See [Multivector reranking](./USEGUIDE.en.md#multivector-reranking).
- Deletion makes preliminary counting and paged ID collection explicit choices. See [Expiry and deletion](./USEGUIDE.en.md#expiry-and-deletion).

## Start here

Start Qdrant first. The default URL is `http://127.0.0.1:6333`; set `QDRANT_URL` for another service address. This writes one vector and reads its nearest-neighbor ID.

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
await documents.upsert([{ id: 'a', vector: [2, 0], payload: { category: 'guide' } }])
console.log((await documents.near([1, 0], { exact: true }).topK(1).all())[0]?.id)
```

Expected output:

```text
a
```

For payload conditions, read [Search and filters](./USEGUIDE.en.md#search-and-filters). For a second ranking stage, read [Multivector reranking](./USEGUIDE.en.md#multivector-reranking).

## What hand-written code gets wrong

A direct native request leaves these boundaries to the application. This example is shown without execution.

```ts doc-test=check
export async function writePoint(url: string) {
  const response = await fetch(url + '/collections/articles/points?wait=true', {
    method: 'PUT',
    body: JSON.stringify({ points: [{ id: 1, vector: [1, 0] }] })
  })
  // Pitfall: IDs share one physical collection without organization mapping.
  // Pitfall: an HTTP rejection can be mistaken for a successful write.
  return response.json()
}
```

The backend handles managed identities, organization filters and native errors. The application still decides what to do when a dispatched mutation has an unknown outcome.

## The model in three minutes

| Tool                        | Use it for                                                                    |
| --------------------------- | ----------------------------------------------------------------------------- |
| `qdrantBackendPlugin`       | Add a real connection to a storage host.                                      |
| `collection(name, options)` | Describe a logical collection; execution checks or creates its native schema. |
| `near(...).topK(k)`         | Ask the engine for k candidates.                                              |
| `where` / `explain`         | Add conditions and inspect client work.                                       |
| `store.use(ttl)`            | Manage a vector's visible lifetime.                                           |
| Feature                     | Select backend-specific native operations.                                    |

A logical collection is the application's name. Its physical Qdrant collection includes `collectionPrefix`. Host disposal waits for requests; it does not delete persistent data.

## Typical scenarios

| Scenario                               | Building blocks                    | Details                                                           |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Search classified documents            | `near` + `where` + `topK`          | [Search and filters](./USEGUIDE.en.md#search-and-filters)         |
| Expiring recommendations and deletion  | `ttl` + `deleteWhere`              | [Expiry and deletion](./USEGUIDE.en.md#expiry-and-deletion)       |
| Rank with extra vectors                | `qdrantRescoreFeature` + `rescore` | [Multivector reranking](./USEGUIDE.en.md#multivector-reranking)   |
| Share collections across organizations | `host.org(id)`                     | [Organization isolation](./USEGUIDE.en.md#organization-isolation) |

## Install

This package is currently `private: true` for use in this repository's workspace. Do not assume a registry release. From an application directory in the same workspace, install the neighboring packages and the real SDK peer:

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-qdrant
pnpm add @qdrant/js-client-rest@^1.11.0
```

Use Node.js 24 or later and Qdrant protocol 1.11 or later. The default fetch entry does not load the SDK at runtime; `/client` borrows a real `QdrantClient`. The multivector example uses capabilities supported by Qdrant 1.15.5.

## Essential API

| API                                       | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `qdrantBackendPlugin(options, features?)` | Connection, namespace and optional features.    |
| `collection.upsert(points, options?)`     | Write vectors and payloads.                     |
| `collection.near(query).topK(k)`          | Build a nearest-neighbor query.                 |
| `similarTo(id)` / `recommend(...)`        | Build standard queries from stored samples.     |
| `deleteWhere(where, options?)`            | Delete by condition and return a numeric count. |
| `store.use(ttl)`                          | `expire`, `persist` and `remaining`.            |

## Contract details

The backend supplies `vector` and vector-target `ttl`. It has no KV, records, RDF, transactions, secondary indexes, change feed or native live query. Explicit locks and unsupported concurrency policies reject before mutation.

`url` is required. `id` defaults to `qdrant`, and `collectionPrefix` to `migaia_`. `apiKey` and a supplied `http` port are optional. Supplied HTTP/SDK clients remain with the caller and are never closed by the host. Hosts detect by default; if disabled, call `await host.detect()` first.

Error source is `storage.backend.qdrant`. Native 4xx, network/5xx failures and invalid responses use `QDRANT_REQUEST_FAILED`, `QDRANT_UNAVAILABLE` and `QDRANT_RESPONSE_INVALID`. Original errors remain on cause chains. Cancellation cannot undo a dispatched mutation; it is never replayed automatically, and disposal waits for its actual result. See the [usage guide](./USEGUIDE.en.md).
