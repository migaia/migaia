import assert from 'node:assert/strict'
import { Store } from 'oxigraph'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { rdf, sparql } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/sdk'
import { detectServerRuntime } from '@migaia/utils'
import { sparqlBackendPlugin } from '../../dist/index.js'
import { oxigraphEndpoint } from '../../dist/oxigraph.js'
import { graphStoreFeature } from '../../dist/features/graph-store.js'
import { ontologyFeature } from '../../dist/features/ontology.js'
/** Every runtime executes the real built package against the borrowed native RDF engine. */
const native = new Store()
const host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(native) },
      { graphs: graphStoreFeature(), ontology: ontologyFeature() }
    )
  ] as const
})
try {
  const store = host.backend('sparql'),
    quad = {
      subject: term.iri('https://example/alice'),
      predicate: term.iri('https://example/name'),
      object: term.literal('Alice', { language: 'en' }),
      graph: term.defaultGraph
    }
  await store.use(rdf).add([quad])
  assert.deepEqual(await store.use(rdf).match({}).all(), [quad])
  await store.transaction(async (scope) => {
    scope.use(rdf).expect([quad])
    await scope.use(rdf).delete([quad])
    await scope.use(rdf).add([{ ...quad, object: term.literal('Ada') }])
    assert.equal(await scope.use(rdf).match({}).count(), 1)
  })
  const target = { graph: term.iri('https://example/schema') },
    document = { format: 'text/turtle' as const, text: '_:a <https://example/p> "hello"@en .' }
  assert.equal(await store.api.ontology!.importOntology(target, document), 1)
  assert.equal(await store.api.ontology!.importOntology(target, document), 1)
  const graph = await store.api.ontology!.exportOntology(target, 'application/n-triples')
  assert.equal(graph.text.split('hello').length - 1, 2)
  assert.equal(await store.api.graphStore!.hasGraph(target), true)
  const orgId = createOrgId(),
    other = host.org(orgId).backend('sparql')
  await other.use(rdf).add([quad])
  assert.equal(await other.use(rdf).match({}).delete(), 1)
  assert.equal(await store.use(rdf).match({}).count(), 1)
  await host.dropOrg(orgId)
  assert.equal(
    (
      await store.use(
        sparql
      )`SELECT ?o WHERE {GRAPH ?g {${quad.subject} ${quad.predicate} ?o}}`.select()
    ).length,
    1
  )
  await host.dispose()
  assert.equal(native.query('ASK {}'), true)
  console.log(JSON.stringify({ runtime: detectServerRuntime(), cases: 3, result: 'PASS' }))
} finally {
  await host.dispose()
}
