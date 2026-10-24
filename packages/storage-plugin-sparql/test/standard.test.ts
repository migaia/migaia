import { describe, expect, it, onTestFinished } from 'vitest'
import { Store, quad as nativeQuad, namedNode, literal, defaultGraph } from 'oxigraph'
import {
  createStorageHost,
  memoryBackendPlugin,
  defineFeature,
  createOrgId
} from '@migaia/storage-host'
import { rdf, sparql, term, type IQuad, type IRdfApi } from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { sparqlBackendPlugin, sparqlBackendKind } from '../src/index.js'
import { oxigraphEndpoint } from '../src/oxigraph.js'

runConformance(
  { describe, expect, it },
  {
    name: 'fresh native Oxigraph RDF, SPARQL and transactions',
    capabilities: [rdf, sparql],
    features: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: true,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    async create() {
      const host = await createStorageHost({
        plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })] as const
      })
      onTestFinished(() => host.dispose())
      return host.backend('sparql')
    }
  }
)

/** The real RDF engine owns N-Quads escaping and canonical term serialization in both comparisons. */
function normalized(quads: readonly IQuad[]): string[] {
  const native = new Store(
    quads.map((quad) =>
      nativeQuad(
        namedNode(quad.subject.value),
        namedNode(quad.predicate.value),
        quad.object.termType === 'Literal'
          ? literal(quad.object.value, quad.object.language ?? namedNode(quad.object.datatype))
          : namedNode(quad.object.value),
        quad.graph.termType === 'DefaultGraph' ? defaultGraph() : namedNode(quad.graph.value)
      )
    )
  )
  return native.dump({ format: 'application/n-quads' }).trim().split('\n').sort()
}

/**
 * Ground membership, canonical duplicate identity and query writes share one portable business
 * path.
 */
async function groundApplication(api: IRdfApi, input: readonly IQuad[]) {
  await api.add([...input, ...input])
  const initial = normalized(await api.match({}).all()),
    selected = normalized(
      await api
        .match({})
        .where((quad) => quad.object.value.includes('o'))
        .all()
    ),
    replacement: IQuad = { ...input[0]!, object: term.literal('replacement') },
    replaced = await api.match({ graph: term.defaultGraph }).replace(input[0]!, replacement),
    deleted = await api.match({ graph: input[1]!.graph }).delete(),
    remaining = normalized(await api.match({}).all())
  await api.delete([replacement, replacement])
  return { initial, selected, replaced, deleted, remaining, empty: await api.match({}).all() }
}

/** Identical quads and organization markers share one portable membership and deletion workflow. */
async function groundOrganizationApplication(apis: readonly IRdfApi[], drop: () => Promise<void>) {
  /** Both graph kinds keep their logical identity while native storage prefixes the organization. */
  const shared: IQuad = {
      subject: term.iri('urn:organizations:s'),
      predicate: term.iri('urn:organizations:p'),
      object: term.literal('common'),
      graph: term.defaultGraph
    },
    graph = term.iri('urn:organizations:graph'),
    markers = ['default', 'one', 'two']
  for (const [index, api] of apis.entries())
    await api.add([
      shared,
      { ...shared, graph },
      { ...shared, graph, object: term.literal(markers[index]!) }
    ])
  /** Distinct marker rows detect leakage that de-duplication of the shared quad alone would hide. */
  const read = async () => {
    const values: string[][] = []
    for (const api of apis)
      values.push((await api.match({}).all()).map((q) => q.object.value).sort())
    return values
  }
  const before = await read()
  await drop()
  return { before, after: await read() }
}

describe('native ground RDF reference behavior', () => {
  it('runs unchanged ground organization membership and deletion on memory and Oxigraph', async () => {
    /** The configured default and both peers pass through the same original organization view. */
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        memoryBackendPlugin(),
        sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })
      ] as const
    })
    /** Resolve concrete capability signatures before combining the two native API values. */
    const sources = [
      (org: ReturnType<typeof createOrgId>) => host.org(org).backend('memory').use(rdf),
      (org: ReturnType<typeof createOrgId>) => host.org(org).backend('sparql').use(rdf)
    ]
    for (const source of sources) {
      /** Each backend receives the same ground triples under the default and two borrowed views. */
      const one = createOrgId(),
        two = createOrgId(),
        apis = [source(defaultOrg), source(one), source(two)]
      expect(await groundOrganizationApplication(apis, () => host.dropOrg(one))).toEqual({
        before: [
          ['common', 'common', 'default'],
          ['common', 'common', 'one'],
          ['common', 'common', 'two']
        ],
        after: [['common', 'common', 'default'], [], ['common', 'common', 'two']]
      })
    }
  })
  it('matches memory N-Quads and client filtering without changing language, datatype or safe literals', async () => {
    await using memory = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
    await using native = await createStorageHost({
      plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })] as const
    })
    const subject = term.iri('urn:reference:subject'),
      predicate = term.iri('urn:reference:predicate'),
      named = term.iri('urn:reference:named'),
      input: IQuad[] = [
        {
          subject,
          predicate,
          object: term.literal('"} ; DROP ALL ; {"'),
          graph: term.defaultGraph
        },
        { subject, predicate, object: term.literal('bonjour', { language: 'FR' }), graph: named },
        {
          subject,
          predicate,
          object: term.literal('42', { datatype: 'http://www.w3.org/2001/XMLSchema#integer' }),
          graph: named
        }
      ],
      expected = memory.backend('memory').use(rdf),
      actual = native.backend('sparql').use(rdf)
    const reference = await groundApplication(expected, input),
      result = await groundApplication(actual, input)
    expect(result).toEqual(reference)
    expect(result.initial).toEqual(normalized(input))
    expect(result.initial).toHaveLength(3)
    expect(result.replaced).toBe(1)
    expect(result.deleted).toBe(2)
    expect(result.remaining).toEqual(
      normalized([{ ...input[0]!, object: term.literal('replacement') }])
    )
    expect(result.empty).toEqual([])
  })

  it('lends the original endpoint to an exact-kind Feature for its native graph update', async () => {
    const native = new Store()
    native.update('INSERT DATA { GRAPH <urn:feature:owned> { <urn:s> <urn:p> "kept" } }')
    const clear = defineFeature(sparqlBackendKind, (core) => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          clearOwnedGraph: () =>
            core.featureExpose.getClient().update('CLEAR GRAPH <urn:feature:owned>')
        },
        transaction: {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(native) }, { clear })] as const
    })
    const store = host.backend('sparql')
    expect('endpoint' in store).toBe(false)
    await store.api.clearOwnedGraph()
    expect(native.query('ASK { GRAPH <urn:feature:owned> { ?s ?p ?o } }')).toBe(false)
  })
})
