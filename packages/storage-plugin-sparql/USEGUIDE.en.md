# SPARQL usage guide

## Find your scenario

| Need                               | Scenario                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| Filter, delete or replace RDF      | [Query and change quads](#query-and-change-quads)             |
| Check an old value before a change | [Detect competing updates](#detect-competing-updates)         |
| Use a remote SPARQL service        | [HTTP reads and writes](#http-reads-and-writes)               |
| Import or export one graph         | [Graph documents and ontology](#graph-documents-and-ontology) |

## Query and change quads

Write two names and delete only Alice.

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'

await using host = await createStorageHost({
  plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })]
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('urn:example:alice'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Alice'),
  graph: term.defaultGraph
}
await store
  .use(rdf)
  .add([quad, { ...quad, subject: term.iri('urn:example:bob'), object: term.literal('Bob') }])
const selected = store
  .use(rdf)
  .match({ predicate: quad.predicate })
  .where((value) => value.object.value === 'Alice')
console.log(await selected.count())
console.log(await selected.delete())
console.log(await store.use(rdf).match({}).count())
```

Expected output:

```text
1
1
1
```

A quad uses named subject/predicate nodes, a named or literal object, and a default/named graph. term.literal accepts language or datatype. Term binding handles escaping. Standard RDF rejects blank nodes and variables.

match(pattern) accepts a subset of quad fields. Its query chain supports where, follow/inverse traversal, orderBy, distinct, skip, limit, pages, aggregates and stream. explain() distinguishes native from client steps; requirePushdown() rejects unsupported client steps before I/O.

delete counts deduplicated canonical quads actually selected and accepted for change. replace(old, new) changes only a selected old quad, returning 0 otherwise. Root calls wait for commit confirmation; counts inside a transaction describe its draft.

## Detect competing updates

Require Alice to remain present before replacing it with Ada. If another transaction removed Alice, this commit conflicts.

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'

await using host = await createStorageHost({
  plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })]
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('urn:example:alice'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Alice'),
  graph: term.defaultGraph
}
await store.use(rdf).add([quad])
await store
  .tx()
  .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 }))
  .run(async (scope) => {
    scope.use(rdf).expect([quad])
    await scope.use(rdf).delete([quad])
    await scope.use(rdf).add([{ ...quad, object: term.literal('Ada') }])
  })
console.log((await store.use(rdf).match({}).all()).map((value) => value.object.value).join(','))
```

Expected output:

```text
Ada
```

expect conditions are conjunctions; expectAbsent requires each supplied quad to be absent. Draft changes deduplicate canonical quad identities with last-operation-wins for the same quad. Reads do not automatically form a read set. Concurrent insertions of different objects can both survive; predicates have no single-value guarantee.

ConcurrencyPolicy.optimistic({retries: 1}) retries one real conflict at most. The callback may run again, so perform external side effects after the transaction succeeds. backoffMs defaults to 20. Omitting the policy does not enable automatic optimistic retry. Only optimistic concurrency is supported, without key locks, wait/fail policies or interactive remote transactions.

One conditional DELETE/INSERT WHERE writes user quads and a commit marker, followed by ASK confirmation and marker cleanup. Only a successful Update followed by a successful ASK explicitly finding no marker is a retryable conflict. Unknown Update outcomes, failed ASK and cancellation during confirmation produce SPARQL_COMMIT_UNKNOWN. Later writes on that backend stop and are not replayed. Marker cleanup failures are reported after user data has committed.

A transaction may execute one raw update body only when its endpoint supplies atomicUpdate. It cannot mix RDF operations/preconditions or a second raw body. Oxigraph provides one native Store.update; httpEndpoint does not provide this capability and rejects before sending a write. Transaction raw templates expose update only, without select/ask/construct.

## HTTP reads and writes

Start a real service that supports SPARQL Query and Update. The defaults use the `storage` dataset on local port 3030. For other addresses, set `SPARQL_QUERY_URL`, `SPARQL_UPDATE_URL` and `SPARQL_GRAPH_STORE_URL` to the same dataset; the Graph Store URL is used for graph document operations. This inserts data and reads it with ASK; the data remains in the service.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sparql } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'

await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin({
      endpoint: httpEndpoint({
        queryUrl: process.env.SPARQL_QUERY_URL ?? 'http://127.0.0.1:3030/storage/sparql',
        updateUrl: process.env.SPARQL_UPDATE_URL ?? 'http://127.0.0.1:3030/storage/update',
        graphStoreUrl: process.env.SPARQL_GRAPH_STORE_URL ?? 'http://127.0.0.1:3030/storage/data'
      })
    })
  ]
})
const query = host.backend('sparql').use(sparql)
const subject = term.iri('urn:example:' + crypto.randomUUID())
const predicate = term.iri('urn:example:name')
const value = term.literal('Alice')
await query`INSERT DATA { ${subject} ${predicate} ${value} }`.update()
console.log(await query`ASK { ${subject} ${predicate} ${value} }`.ask())
```

Expected output:

```text
true
```

queryUrl/updateUrl are required; graphStoreUrl is needed only for graph-document features. URLs must be absolute HTTP(S) without embedded credentials. Optional auth is exactly `{basic: {user, password}}` or `{bearer}`. Mutations are sent once without redirect following. Reads retain fetch behavior. Graph Store HEAD404 returns false; GET404 rejects. Authentication headers are not diagnostic data.

The root raw tag supports select, ask, construct and update. A normal string is data, not syntax; bind RDF terms as template values. Raw SELECT/CONSTRUCT also support blank nodes scoped to one response.

Deployment must guarantee atomic execution of one conditional Modify and read-after-write visibility on the same dataset. Native paths cover Fuseki 6.2.0 and Oxigraph 0.4.11; other deployments must supply equivalent guarantees. An HTTP protocol is not itself a database transaction.

## Graph documents and ontology

Write a graph, export it and import with replace. Every Feature used here is installed in this example.

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
import { graphStoreFeature } from '@migaia/storage-plugin-sparql/features/graph-store'
import { ontologyFeature } from '@migaia/storage-plugin-sparql/features/ontology'

await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(new Store()) },
      {
        graphs: graphStoreFeature(),
        ontology: ontologyFeature()
      }
    )
  ]
})
const store = host.backend('sparql')
const target = { graph: term.iri('urn:example:people') }
const document = {
  format: 'text/turtle' as const,
  text: '<urn:example:alice> <urn:example:name> "Alice" .'
}
await store.api.graphStore.putGraph(target, document)
console.log(await store.api.graphStore.hasGraph(target))
console.log((await store.api.graphStore.getGraph(target)).text.includes('Alice'))
console.log(await store.api.ontology.importOntology(target, document, { mode: 'replace' }))
await store.api.graphStore.removeGraph(target)
console.log(await store.api.graphStore.hasGraph(target))
```

Expected output:

```text
true
true
1
false
```

target selects exactly `{default: true}` or `{graph: namedNode}`. A document has format text/turtle or application/n-triples and complete document text. get/export default to Turtle. Graph Store offers getGraph, putGraph, mergeGraph, removeGraph and hasGraph. Ontology offers importOntology/exportOntology. Import mode defaults to merge; replace uses a real per-graph replacement. Its count is parsed statements including duplicates, not newly inserted statements.

n3 handles RDF1.1 syntax. Blank nodes share identity within a document and receive fresh identities across imports. RDF-star and document variables reject. No reasoning is performed. The endpoint must actually provide graphStore. Feature methods are on store.api; organization views retain their graph mapping. Transaction scopes have no graph-document API.

## Organizations and the reserved graph

host.org(id).backend('sparql') maps logical default/named graphs into physical named graphs under `urn:migaia:org:<orgId>:`. Organizations remain separate. dropOrg removes all the target organization's graphs, including empty named graphs and blank-node documents. Raw SPARQL is available only in the configured default organization.

Standard RDF, graph documents and ontology reject the reserved `urn:migaia:commit` graph. A crash can leave markers. Only after confirming that no commits are active should an administrator run `CLEAR SILENT GRAPH <urn:migaia:commit>` directly in the database. Bypassing the standard API to change that graph breaks confirmation guarantees.

## Failures and disposal

Error source is storage.backend.sparql. SPARQL_REQUEST_FAILED means explicit native rejection and retains status/body/cause. SPARQL_UNAVAILABLE means read transport/5xx failure. SPARQL_RESPONSE_INVALID means invalid results/documents. SPARQL_COMMIT_UNKNOWN requires checking the dataset before constructing a new backend. Callback, draft-task and finalizer business failures use TRANSACTION_FAILED while retaining native type, primary failure and cause chain. Existing contract/protocol errors keep their identities.

Hosts detect by default; with autoDetect:false, call await host.detect() first. Closing rejects new calls, cancels active reads and waits for dispatched commits. dispose() retains cleanup failures in its main Promise. Symbol.asyncDispose shares cleanup and reports failures. Endpoints, Oxigraph Stores and supplied clients remain with the caller, and the plugin never closes them. Oxigraph 0.4.11 has no public close/dispose method.

Hooks observe only and report failures; use the host pipeline for intervention. HTTP observations contain neither authentication nor bodies. Query cost includes actual result bytes and remaining client work. Graph documents are parsed/transferred as a whole; transaction condition text grows with quads/preconditions. No database-plan or inference performance claim is made.
