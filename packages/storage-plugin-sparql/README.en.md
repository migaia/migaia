# SPARQL storage backend

Install `sparqlBackendPlugin({ endpoint }, features?)` in `createStorageHost`. The default id is `sparql`; an explicit `id` stays exact in `host.backend(id)`. `sparqlBackendKind` authenticates Features. The backend exposes the shared `rdf` and `sparql` capabilities, native optimistic transactions, and no KV, records, vector, SQL or key-lock API.

```ts
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf, sparql, term } from '@migaia/storage-contract'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
import { graphStoreFeature } from '@migaia/storage-plugin-sparql/features/graph-store'
import { ontologyFeature } from '@migaia/storage-plugin-sparql/features/ontology'

const native = new Store()
await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(native) },
      {
        graphs: graphStoreFeature(),
        ontology: ontologyFeature()
      }
    )
  ] as const
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('https://example/alice'),
  predicate: term.iri('https://example/name'),
  object: term.literal('Alice', { language: 'en' }),
  graph: term.defaultGraph
}
await store.use(rdf).add([quad])
console.log(await store.use(rdf).match({ subject: quad.subject }).count()) // 1
await store.transaction(async (scope) => {
  scope.use(rdf).expect([quad])
  await scope.use(rdf).delete([quad])
  await scope.use(rdf).add([{ ...quad, object: term.literal('Ada') }])
})
```

The caller creates and owns the endpoint and any Oxigraph Store. Disposal never closes them. `dispose()` returns one cached rejecting main Promise; `Symbol.asyncDispose` returns one cached reporting Promise and shares the cleanup. Closing rejects new calls, cancels active reads and drains already-sent commits.

Public entries are the package root, `/http` (`httpEndpoint`), `/oxigraph` (`oxigraphEndpoint`), `/features/graph-store` (`graphStoreFeature`) and `/features/ontology` (`ontologyFeature`). The root does not load the native Oxigraph runtime. Install the real peers `@migaia/storage-host`, `n3` and `oxigraph`; tested native peers are n3 1.26.0 and Oxigraph 0.4.11. RDF/JS declarations are real dependencies; no substitute Store type or optional-peer fallback is used.

Standard RDF accepts ground named subjects/predicates, named or literal objects, and default/named graphs. Language, datatype, escaping and canonical quad identity use the shared contract. Raw SELECT/CONSTRUCT and ontology documents also support blank nodes. Blank identifiers are local to one response/document; separate imports remain distinct. RDF-star, variables in documents, and blank standard quads reject. This is an intentional ground RDF boundary, not a full OWL reasoning engine.

`ERROR_SOURCE` is `storage.backend.sparql`. `SPARQL_REQUEST_FAILED` retains explicit native HTTP refusal status/body/cause. `SPARQL_UNAVAILABLE` reports read transport/5xx failures. `SPARQL_RESPONSE_INVALID` reports invalid results/documents. `SPARQL_COMMIT_UNKNOWN` means a sent write lacks confirmation: it is not replayed, and later writes on this installed backend reject. Inspect the native dataset, then create a new backend. Local invalid input and unsupported capabilities use the original shared error family. Native error types and original causes/stacks remain reachable; authentication headers/configuration are not copied into hooks or error data.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for HTTP deployment requirements, transactions, query writes, Graph Store, ontology, costs and marker cleanup.

Transaction callback, draft or finalizer business failures use `TRANSACTION_FAILED`, preserving the original native type and primary cause; they do not report endpoint unavailability. Existing contract and native protocol errors retain their identities.

Without `expect`, writes retain canonical quad set semantics. Concurrent read-modify-write transactions inserting different objects can retain both new quads; predicate values do not have a last-writer guarantee. Use `expect` to validate the quads read before changing them.
