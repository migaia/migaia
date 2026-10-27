import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { Store } from 'oxigraph'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { rdf, sparql, type IOperationContext } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/sdk'
import { sparqlBackendPlugin } from '../src/index.js'
import { oxigraphEndpoint } from '../src/oxigraph.js'
import { graphStoreFeature } from '../src/features/graph-store.js'
import { ontologyFeature } from '../src/features/ontology.js'
import { parseRdfDocument } from '../src/ntriples.js'

describe('native Graph Store and ontology Features', () => {
  it('executes all graph operations on physical default/named targets and leaves the borrowed engine open', async () => {
    const native = new Store(),
      endpoint = oxigraphEndpoint(native),
      put = vi.spyOn(endpoint.graphStore!, 'put'),
      get = vi.spyOn(endpoint.graphStore!, 'get'),
      post = vi.spyOn(endpoint.graphStore!, 'post'),
      has = vi.spyOn(endpoint.graphStore!, 'has'),
      remove = vi.spyOn(endpoint.graphStore!, 'remove'),
      host = await createStorageHost({
        plugins: [
          sparqlBackendPlugin(
            { endpoint },
            { graphs: graphStoreFeature(), ontology: ontologyFeature() }
          )
        ] as const
      })
    onTestFinished(() => host.dispose())
    const store = host.backend('sparql'),
      graphs = store.api.graphStore!
    for (const target of [
      { default: true } as const,
      { graph: term.iri('https://example/g?x=é&y=1') }
    ]) {
      const ctx: IOperationContext = { signal: new AbortController().signal },
        document = {
          format: 'text/turtle' as const,
          text: '<https://example/a> <https://example/p> "hello"@en .'
        }
      await graphs.putGraph(target, document, ctx)
      expect(await graphs.hasGraph(target, ctx)).toBe(true)
      expect((await graphs.getGraph(target, undefined, ctx)).text).toContain('hello')
      await graphs.mergeGraph(
        target,
        {
          format: 'application/n-triples',
          text: '<https://example/b> <https://example/p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .'
        },
        ctx
      )
      expect(
        parseRdfDocument(await graphs.getGraph(target, 'application/n-triples', ctx))
      ).toHaveLength(2)
      await graphs.putGraph(target, {
        format: 'application/n-triples',
        text: '<https://example/c> <https://example/p> "replaced" .'
      })
      expect(parseRdfDocument(await graphs.getGraph(target))).toHaveLength(1)
      await graphs.removeGraph(target, ctx)
      expect(await graphs.hasGraph(target)).toBe(false)
      await expect(graphs.getGraph(target)).rejects.toMatchObject({ code: 'SPARQL_REQUEST_FAILED' })
    }
    expect(put).toHaveBeenCalledTimes(4)
    expect(get).toHaveBeenCalledTimes(8)
    expect(post).toHaveBeenCalledTimes(2)
    expect(has).toHaveBeenCalledTimes(4)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]![1].text).toContain('https://example/b')
    const savedQuery = store.use(rdf).match({})
    const primary = store.dispose(),
      symbolic = store[Symbol.asyncDispose]()
    expect(store.dispose()).toBe(primary)
    expect(store[Symbol.asyncDispose]()).toBe(symbolic)
    await primary
    await symbolic
    expect(native.query('ASK {}')).toBe(true)
    await expect(savedQuery.all()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(
      (async () => {
        const stream = savedQuery.stream()
        try {
          await stream.next()
        } finally {
          await stream.dispose()
        }
      })()
    ).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    expect(() => store.use(rdf).add([])).toThrow(
      expect.objectContaining({ code: 'STORE_DISPOSED' })
    )
  })
  it('preserves full RDF/OWL blanks within one document, separates documents and keeps standard RDF ground', async () => {
    /** Ontology import/export must use the selected endpoint's actual graph document ports. */
    const endpoint = oxigraphEndpoint(new Store())
    const post = vi.spyOn(endpoint.graphStore!, 'post')
    const put = vi.spyOn(endpoint.graphStore!, 'put')
    const get = vi.spyOn(endpoint.graphStore!, 'get')
    const host = await createStorageHost({
      plugins: [
        sparqlBackendPlugin(
          { endpoint },
          { graphs: graphStoreFeature(), ontology: ontologyFeature() }
        )
      ] as const
    })
    onTestFinished(() => host.dispose())
    const store = host.backend('sparql'),
      ontology = store.api.ontology!,
      target = { default: true } as const,
      document = {
        format: 'text/turtle' as const,
        text: '@prefix owl:<http://www.w3.org/2002/07/owl#> . _:a owl:someValuesFrom <https://example/Class> . _:a owl:onProperty <https://example/property> .'
      }
    expect(await ontology.importOntology(target, document)).toBe(2)
    expect(await ontology.importOntology(target, document)).toBe(2)
    const all = parseRdfDocument(await ontology.exportOntology(target, 'application/n-triples'))
    expect(all).toHaveLength(4)
    expect(new Set(all.map((quad) => JSON.stringify(quad.subject))).size).toBe(2)
    expect(await store.use(rdf).match({}).count()).toBe(0)
    expect(
      await store.use(sparql)`CONSTRUCT {?s ?p ?o} WHERE {GRAPH ?g {?s ?p ?o}}`.construct()
    ).toHaveLength(4)
    expect(await ontology.importOntology(target, document, { mode: 'replace' })).toBe(2)
    expect(parseRdfDocument(await ontology.exportOntology(target))).toHaveLength(2)
    expect(post).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]![1].text).toContain('http://www.w3.org/2002/07/owl#someValuesFrom')
    await expect(
      ontology.importOntology({ graph: term.iri('urn:migaia:commit') }, document)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      ontology.importOntology(target, {
        format: 'text/turtle',
        text: '<< <https://s> <https://p> <https://o> >> <https://q> <https://v> .'
      })
    ).rejects.toMatchObject({ code: 'SPARQL_RESPONSE_INVALID' })
  })
  it('does not issue implicit detection requests when detection is explicitly deferred', async () => {
    const original = oxigraphEndpoint(new Store())
    let requests = 0
    const endpoint = {
      query: (...args: Parameters<typeof original.query>) => {
        requests++
        return original.query(...args)
      },
      update: original.update
    }
    const host = await createStorageHost({
      autoDetect: false,
      plugins: [sparqlBackendPlugin({ endpoint }, { graphs: graphStoreFeature() })] as const
    })
    onTestFinished(() => host.dispose())
    await expect(
      host.backend('sparql').api.graphStore!.hasGraph({ default: true })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(requests).toBe(0)
    await expect(host.detect()).rejects.toBeInstanceOf(Error)
    const ready = await createStorageHost({
      autoDetect: false,
      plugins: [
        sparqlBackendPlugin({ endpoint: original }, { ontology: ontologyFeature() })
      ] as const
    })
    onTestFinished(() => ready.dispose())
    await expect(ready.backend('sparql').use(sparql)`ASK {}`.ask()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
    await ready.detect()
    expect(await ready.backend('sparql').use(sparql)`ASK {}`.ask()).toBe(true)
  })
  it('isolates graph documents by organization and removes all organization-owned graph data', async () => {
    const host = await createStorageHost({
      plugins: [
        sparqlBackendPlugin(
          { endpoint: oxigraphEndpoint(new Store()) },
          { graphs: graphStoreFeature(), ontology: ontologyFeature() }
        )
      ] as const
    })
    onTestFinished(() => host.dispose())
    const id = createOrgId(),
      root = host.backend('sparql'),
      other = host.org(id).backend('sparql'),
      document = {
        format: 'application/n-triples' as const,
        text: '_:a <https://example/p> "value" .'
      }
    await root.api.ontology!.importOntology({ default: true }, document)
    await other.api.ontology!.importOntology({ default: true }, document)
    expect(
      parseRdfDocument(await other.api.ontology!.exportOntology({ default: true }))
    ).toHaveLength(1)
    await host.dropOrg(id)
    expect(await other.api.graphStore!.hasGraph({ default: true })).toBe(false)
    expect(
      parseRdfDocument(await root.api.ontology!.exportOntology({ default: true }))
    ).toHaveLength(1)
  })
})
