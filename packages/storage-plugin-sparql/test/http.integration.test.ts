import { describe, it, expect } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { rdf, sparql } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { sparqlBackendPlugin } from '../src/index.js'
import { httpEndpoint } from '../src/http.js'
import { graphStoreFeature } from '../src/features/graph-store.js'
import { ontologyFeature } from '../src/features/ontology.js'
import { parseRdfDocument } from '../src/ntriples.js'
/** The shared service launcher is the only source of real endpoint addresses. */
const queryUrl = process.env.MIGAIA_SPARQL_QUERY_URL,
  updateUrl = process.env.MIGAIA_SPARQL_UPDATE_URL,
  graphStoreUrl = process.env.MIGAIA_SPARQL_GRAPH_STORE_URL
describe('real configured SPARQL service', () => {
  it.skipIf(!queryUrl || !updateUrl || !graphStoreUrl)(
    'proves native atomic conditions, read-after-write, documents and HTTP protocol behavior',
    async () => {
      const org = createOrgId(),
        host = await createStorageHost({
          org,
          plugins: [
            sparqlBackendPlugin(
              {
                endpoint: httpEndpoint({
                  queryUrl: queryUrl!,
                  updateUrl: updateUrl!,
                  graphStoreUrl: graphStoreUrl!
                })
              },
              { graphs: graphStoreFeature(), ontology: ontologyFeature() }
            )
          ] as const
        }),
        store = host.backend('sparql')
      const subject = term.iri('https://example/fuseki/alice'),
        predicate = term.iri('https://example/name'),
        old = { subject, predicate, object: term.literal('Alice'), graph: term.defaultGraph },
        next = { ...old, object: term.literal('"} ; DROP ALL ; {"') }
      try {
        await store.use(rdf).add([old])
        expect(await store.use(rdf).match({}).all()).toEqual([old])
        await store.transaction(async (scope) => {
          scope.use(rdf).expect([old])
          scope.use(rdf).expectAbsent([next])
          await scope.use(rdf).delete([old])
          await scope.use(rdf).add([next])
        })
        expect(await store.use(rdf).match({}).all()).toEqual([next])
        await expect(
          store.transaction(
            async (scope) => {
              scope.use(rdf).expectAbsent([old, next])
              await scope.use(rdf).add([old])
            },
            { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
          )
        ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        await expect(
          store.transaction((scope) =>
            scope.use(sparql)`INSERT DATA {<https://raw/a> <https://raw/p> "blocked"}`.update()
          )
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        const target = { graph: term.iri('https://example/ontology?x=é&y=1') },
          document = {
            format: 'text/turtle' as const,
            text: '@prefix ex:<https://example/> . _:a ex:p "bonjour"@fr . _:a ex:q _:b .'
          }
        expect(await store.api.ontology!.importOntology(target, document)).toBe(2)
        expect(await store.api.ontology!.importOntology(target, document)).toBe(2)
        expect(
          parseRdfDocument(
            await store.api.ontology!.exportOntology(target, 'application/n-triples')
          )
        ).toHaveLength(4)
        await store.api.graphStore!.putGraph(target, {
          format: 'application/n-triples',
          text: '<https://example/new> <https://example/p> "replacement" .'
        })
        expect(parseRdfDocument(await store.api.graphStore!.getGraph(target))).toHaveLength(1)
        await store.api.graphStore!.removeGraph(target)
        expect(await store.api.graphStore!.hasGraph(target)).toBe(false)
        await expect(store.api.graphStore!.getGraph(target)).rejects.toMatchObject({
          code: 'SPARQL_REQUEST_FAILED'
        })
        const missing = { graph: term.iri('https://example/missing/' + crypto.randomUUID()) }
        expect(await store.api.graphStore!.hasGraph(missing)).toBe(false)
      } finally {
        try {
          await host.dropOrg(org)
        } finally {
          await host.dispose()
        }
      }
    },
    30_000
  )
})
