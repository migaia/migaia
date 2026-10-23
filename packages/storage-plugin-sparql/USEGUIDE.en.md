# SPARQL usage guide

Use the installation example in [README.en.md](./README.en.md). All configuration factories are synchronous and perform no I/O; the host owns installation, detection, pipelines and disposal. With `autoDetect: false`, call `await host.detect()` explicitly before any endpoint operation. An undetected endpoint rejects before business I/O without running detection implicitly.

## HTTP and native endpoints

```ts
import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'
const endpoint = httpEndpoint({
  queryUrl: 'http://localhost:3030/storage/sparql',
  updateUrl: 'http://localhost:3030/storage/update',
  graphStoreUrl: 'http://localhost:3030/storage/data',
  auth: { bearer: 'deployment-token' }
})
```

Use absolute HTTP(S) URLs without embedded credentials. `auth` is exactly Basic `{ basic: { user, password } }` or Bearer `{ bearer }`, and is optional. `graphStoreUrl` is optional unless Graph Store or ontology is selected. URL API encodes each graph query value once. Mutation redirects are not followed; requests are sent once. HEAD404 returns false; GET404 rejects. Reads may follow native fetch redirects. Do not put credentials or raw query text in telemetry.

A supported deployment must atomically execute one conditional SPARQL 1.1 Modify and provide read-after-write visibility on the same dataset. The protocol alone cannot certify that guarantee. Actual validation covers Apache Jena Fuseki 6.2.0 and Oxigraph 0.4.11; other deployments require the same native checks. `httpEndpoint` supplies no `atomicUpdate`; `oxigraphEndpoint(new Store())` supplies one genuine native Store.update. Never infer interactive transactions from multiple HTTP requests.

## Ground RDF and shared query chains

```ts
const rdfApi = store.use(rdf)
await rdfApi.add([quad])
const selected = rdfApi
  .match({ predicate: quad.predicate })
  .where((q) => q.object.value === 'Alice')
console.log(selected.explain())
const count = await selected.delete()
const replaced = await rdfApi.match({}).replace(quad, { ...quad, object: term.literal('Ada') })
```

`match` uses the original shared immutable query chain: where, traversal `follow`/`inverse`, orderBy, distinct, skip, limit, pages, scalar terminals and streaming. Native SELECT supplies ground matches; remaining operators use the shared executor. `requirePushdown()` rejects unsupported client operators before native I/O. `delete()` counts canonical selected quads accepted by the draft; `replace(old,new)` changes only a selected old quad and returns 0 if it was not selected. Root counts settle only after native commit confirmation; transaction counts describe the current draft. No query mutation bypasses its filters or creates another executor.

Each organization maps logical default/named graphs into its own named graph prefix `urn:migaia:org:<orgId>:`. Root and borrowed organization views use the same mapping. Raw SPARQL is available only in the configured default organization. `host.dropOrg(id)` removes all its physical graphs, including blank-node documents and empty named graphs; it does not drop other organizations.

## Native optimistic transactions

```ts
await store
  .tx()
  .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 }))
  .run(async (scope) => {
    scope.use(rdf).expect([quad])
    scope.use(rdf).expectAbsent([{ ...quad, object: term.literal('new') }])
    await scope.use(rdf).delete([quad])
    await scope.use(rdf).add([{ ...quad, object: term.literal('new') }])
    console.log(await scope.use(rdf).match({}).count())
  })
```

Import `ConcurrencyPolicy` from `@migaia/storage-contract`. The scope retains only native RDF with `expect`/`expectAbsent` and an update-only raw tag; no KV or lock methods exist. The original transaction owner handles accepted work, first failure, iterators, finalizers and expired scopes. The draft deduplicates canonical quads with last-operation-wins. Preconditions are conjunctions; each absent quad gets an independent NOT EXISTS.

One conditional DELETE/INSERT WHERE writes user data and a random commit marker in `urn:migaia:commit`. One ASK confirms it, then a separate cleanup removes the marker. Only a successful Update plus a successful false ASK is a confirmed conflict eligible for the original optimistic retry policy. An ASK failure or unknown sent Update seals further writes with `SPARQL_COMMIT_UNKNOWN`, without replay. Cleanup failure only reports because user data already committed. Without preconditions, add/delete use canonical quad set identity: the final membership operation for the same quad wins, but concurrent transactions inserting different objects can retain both quads. Predicate values have no last-writer guarantee and the read set is not checked automatically; use `expect` for that protection.

On an actual `atomicUpdate` endpoint, a transaction may instead contain exactly one `scope.use(sparql)\`INSERT DATA { ... }\`.update()`body. It cannot mix any RDF operations/preconditions or a second raw body; generic HTTP rejects this authority before writing. Root raw`select/ask/construct/update` tags use shared value binding and do not expose endpoint fields. Never interpolate SPARQL grammar as an ordinary value; use the original trusted fragment helpers where grammar is intentional.

The marker graph is reserved in standard RDF, Graph Store and ontology. A crashed process may leave markers. After inspecting active operations, an administrator may run `CLEAR SILENT GRAPH <urn:migaia:commit>` directly against the native database. Raw administrative access or direct native mutation of the reserved graph is outside standard conditional-commit guarantees.

## Graph Store and ontology

```ts
const target = { graph: term.iri('https://example/schema') }
const document = {
  format: 'text/turtle' as const,
  text: '<https://example/a> <https://example/p> "value" .'
}
await store.api.graphStore.putGraph(target, document)
await store.api.graphStore.mergeGraph(target, document)
console.log(await store.api.graphStore.hasGraph(target))
console.log(await store.api.graphStore.getGraph(target, 'application/n-triples'))
await store.api.graphStore.removeGraph(target)
const parsed = await store.api.ontology.importOntology(target, document, { mode: 'replace' })
console.log(await store.api.ontology.exportOntology(target, 'text/turtle'))
```

Select `graphStoreFeature()` and/or `ontologyFeature()` during installation. Both expose root-only `store.api` methods and empty transaction projections. Targets are exactly `{ default: true }` or `{ graph: namedNode }`. Every method accepts the original operation context as its last argument. Get/export default to Turtle; documents require explicit Turtle or N-Triples format. Missing native graph ports reject in host detection; there is no Feature prepare or transaction client.

Ontology import defaults to merge; replace uses one native per-graph replace. Its count is parsed quads, including duplicates, not newly inserted rows. N3 parser/writer preserve RDF 1.1 literals and blank sharing within a document, assign a fresh prefix per import, and reject RDF-star. Inference and supplier-specific rule configuration stay with the native database.

## Observability and cost

Operations and Feature leaves enter the original async pipeline. Storage hooks and `beforeSparqlUpdate`, `onPreconditionFailed`, `onHttpRequest` only observe; throwing/rejecting observers report and cannot cancel or rewrite operations. The update hook exposes operation/precondition counts; HTTP events expose sanitized route, method, optional status and elapsed time, never authentication or bodies. Use pipeline stages for intervention.

Point work is proportional to actual quad bytes. Draft accumulation and deduplication are expected O(q); conditional text is O(q + p) plus RDF bytes. Match fetches its native result and shared client operators follow their original query budgets; documents cost O(bytes + parsed quads) and transfer the whole document. These costs exclude database planning, network latency and inference. No second retry, clock, resource or query platform is installed.

A business failure in the original transaction callback, accepted draft task or finalizer uses `TRANSACTION_FAILED`. The original failure remains primary and its native type/stack survives. Native read failures are classified at the native read boundary, so a transport failure inside a transaction still uses `SPARQL_UNAVAILABLE`; existing contract/protocol failures are not relabelled.
