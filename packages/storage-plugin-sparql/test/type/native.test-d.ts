import { Store } from 'oxigraph'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import { rdf, sparql, kv } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { sparqlBackendPlugin, sparqlBackendKind } from '../../src/index.js'
import { oxigraphEndpoint } from '../../src/oxigraph.js'
import { graphStoreFeature } from '../../src/features/graph-store.js'
import { ontologyFeature } from '../../src/features/ontology.js'
/** A real nonempty RDF extension must preserve the complete native scope and unlocked builder. */
const extension = defineFeature(sparqlBackendKind, () => ({
  capabilities: [],
  chain: {
    rdf: {
      label() {
        return 'native' as const
      }
    }
  },
  api: { store: {}, transaction: {} }
}))
const host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(new Store()) },
      { extension, graphs: graphStoreFeature(), ontology: ontologyFeature() }
    )
  ] as const
})
const store = host.backend('sparql')
const label: 'native' = store.use(rdf).match({}).label()
void label
await store
  .tx()
  .concurrency(ConcurrencyPolicy.optimistic())
  .run(async (scope) => {
    scope.use(rdf).expect([])
    scope.use(rdf).expectAbsent([])
    const name: 'native' = scope.use(rdf).match({}).label()
    void name
    await scope.use(sparql)`INSERT DATA {}`.update()
    // @ts-expect-error native RDF transaction scopes have no KV authority.
    scope.get('key')
    // @ts-expect-error raw native transaction tags are update-only.
    scope.use(sparql)`SELECT * WHERE {?s ?p ?o}`.select()
    // @ts-expect-error original scope owns transaction operation context.
    scope.use(sparql)`INSERT DATA {}`.update({ timeoutMs: 1 })
    // @ts-expect-error root-only Features grant no transaction graph endpoint.
    scope.api.graphStore.hasGraph({ default: true })
  })
// @ts-expect-error RDF-only store cannot expose KV capability methods.
store.use(kv)
// @ts-expect-error optimistic native builder has no key lock authority.
store.tx().lock()
// @ts-expect-error pessimistic admission is not supported by native conditional updates.
store.tx().concurrency(ConcurrencyPolicy.wait())
store.use(rdf).add([
  {
    // @ts-expect-error standard RDF subjects must be ground named terms.
    subject: term.blank('a'),
    predicate: term.iri('urn:p'),
    object: term.literal('x'),
    graph: term.defaultGraph
  }
])
