import { describe, it, expect, onTestFinished } from 'vitest'
import { Store } from 'oxigraph'
import { walkErrorCauses } from '@migaia/utils/error'
import { createStorageHost, createOrgId, definePlugin, defineFeature } from '@migaia/storage-host'
import {
  rdf,
  sparql,
  term,
  ConcurrencyPolicy,
  prefixStorageOrgGraph,
  type IQuad
} from '@migaia/storage-contract'
import { sparqlBackendPlugin, sparqlBackendKind } from '../src/index.js'
import { oxigraphEndpoint } from '../src/oxigraph.js'
import { graphStoreFeature } from '../src/features/graph-store.js'
import { ontologyFeature } from '../src/features/ontology.js'
import type { ISparqlEndpoint } from '../src/endpoint.js'
/** All transaction cases execute the real native RDF engine; counters observe its existing protocol. */
async function installed(
  options: {
    readonly update?: (body: string, next: () => Promise<void>) => Promise<void>
    readonly query?: (body: string, next: () => Promise<string>) => Promise<string>
  } = {}
) {
  const native = new Store(),
    original = oxigraphEndpoint(native),
    updates: string[] = [],
    queries: string[] = [],
    reports: unknown[] = []
  const endpoint: ISparqlEndpoint = {
    query: (text, accept, signal) => {
      queries.push(text)
      const next = () => original.query(text, accept, signal)
      return options.query ? options.query(text, next) : next()
    },
    update: (text, signal) => {
      updates.push(text)
      const next = () => original.update(text, signal)
      return options.update ? options.update(text, next) : next()
    },
    atomicUpdate: original.atomicUpdate,
    graphStore: original.graphStore
  }
  const extension = defineFeature(sparqlBackendKind, () => ({
    capabilities: [],
    chain: {
      rdf: {
        nativeLabel() {
          return 'native' as const
        }
      }
    },
    api: { store: {}, transaction: {} }
  }))
  const host = await createStorageHost({
    report: (error) => {
      reports.push(error)
    },
    plugins: [
      sparqlBackendPlugin(
        { endpoint },
        { graphs: graphStoreFeature(), ontology: ontologyFeature(), extension }
      )
    ] as const
  })
  onTestFinished(() => host.dispose())
  updates.length = 0
  queries.length = 0
  return { host, store: host.backend('sparql'), native, endpoint, updates, queries, reports }
}
/** Canonical ground fixtures preserve language, datatype and graph identity through native storage. */
const subject = term.iri('https://example/alice'),
  predicate = term.iri('https://example/name')
function quad(value: string, graph: IQuad['graph'] = term.defaultGraph): IQuad {
  return { subject, predicate, object: term.literal(value), graph }
}

describe('native RDF storage and atomic transactions', () => {
  it('round-trips default/named graphs, safe values and native queries through the host', async () => {
    const { store, native } = await installed(),
      named = term.iri('https://example/g?x=é')
    const input = [
      quad('"} ; DROP ALL ; {"'),
      { ...quad('bonjour', named), object: term.literal('bonjour', { language: 'FR' }) },
      {
        ...quad('42', named),
        object: term.literal('42', { datatype: 'http://www.w3.org/2001/XMLSchema#integer' })
      }
    ]
    await store.use(rdf).add(input)
    expect(await store.use(rdf).match({}).count()).toBe(3)
    expect(await store.use(rdf).match({ graph: term.defaultGraph }).all()).toEqual([input[0]])
    expect(await store.use(rdf).match({ graph: named }).count()).toBe(2)
    const rows = await store.use(
      sparql
    )`SELECT ?o WHERE {GRAPH ?g {${subject} ${predicate} ?o}}`.select()
    expect(rows).toHaveLength(3)
    expect('endpoint' in store).toBe(false)
    expect(native.size).toBe(3)
    expect(store.use(rdf).match({}).nativeLabel()).toBe('native')
    await store.tx().run(async (scope) => {
      scope.use(rdf).expect(input)
      expect(scope.use(rdf).match({}).nativeLabel()).toBe('native')
    })
  })
  it('rolls back callback/captured/unawaited failures before any native write and reads its own draft', async () => {
    const { store, updates } = await installed(),
      original = quad('original'),
      business = new RangeError('caller callback failed'),
      originalStack = business.stack
    await store.use(rdf).add([original])
    updates.length = 0
    const failure = await store
      .transaction(async (scope) => {
        await scope.use(rdf).add([quad('a'), quad('b'), quad('c')])
        await scope.use(rdf).delete([original])
        expect(await scope.use(rdf).match({}).count()).toBe(3)
        throw business
      })
      .catch((error: unknown) => error)
    expect(failure).toBe(business)
    expect(failure).toMatchObject({ source: 'storage.backend.sparql', code: 'TRANSACTION_FAILED' })
    expect(business.stack).toBe(originalStack)
    for (const cause of [
      new Error('ordinary callback failed'),
      Object.freeze(new RangeError('frozen callback failed'))
    ]) {
      const failed = await store
        .transaction(() => {
          throw cause
        })
        .catch((error: unknown) => error)
      expect(failed).toMatchObject({ source: 'storage.backend.sparql', code: 'TRANSACTION_FAILED' })
      expect([...walkErrorCauses(failed)]).toContain(cause)
      expect(cause.stack).not.toBe('')
      if (cause instanceof RangeError) expect(failed).toBeInstanceOf(RangeError)
    }
    const transport = new TypeError('native read connection failed'),
      network = await installed({
        query: (body, next) => (body.startsWith('SELECT') ? Promise.reject(transport) : next())
      })
    await expect(
      network.store.transaction((scope) => scope.use(rdf).match({}).all())
    ).rejects.toMatchObject({ source: 'storage.backend.sparql', code: 'SPARQL_UNAVAILABLE' })
    expect(network.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(await store.use(rdf).match({}).all()).toEqual([original])
    await expect(
      store.transaction(async (scope) => {
        void scope.use(rdf).add([{ ...original, subject: term.blank('raw') } as unknown as IQuad])
        await scope.use(rdf).add([quad('must not commit')])
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(updates).toHaveLength(0)
    let saved!: Parameters<Parameters<typeof store.transaction>[0]>[0]
    await store.transaction(async (scope) => {
      saved = scope
      await scope.use(rdf).match({}).all()
    })
    expect(() => saved.use(rdf)).toThrow()
  })
  it('sends one conditional Modify, one ASK and one marker cleanup with independent absent conditions', async () => {
    const { store, updates, queries, native } = await installed()
    await store.transaction(async (scope) => {
      scope.use(rdf).expectAbsent([quad('absent-a'), quad('absent-b')])
      await scope.use(rdf).add([quad('committed')])
    })
    expect(updates).toHaveLength(2)
    expect(queries).toHaveLength(1)
    expect(updates[0]!.match(/FILTER NOT EXISTS/g)).toHaveLength(2)
    expect(updates[0]).toContain('DELETE {')
    expect(updates[0]).toContain('INSERT {')
    expect(native.query('ASK {GRAPH <urn:migaia:commit> {?s ?p ?o}}')).toBe(false)
    await expect(
      store.transaction(
        async (scope) => {
          scope.use(rdf).expectAbsent([quad('missing'), quad('committed')])
          await scope.use(rdf).add([quad('must not commit')])
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
      )
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await store.use(rdf).match({}).all()).toEqual([quad('committed')])
  })
  it('retries only a confirmed precondition conflict through the original optimistic owner', async () => {
    const { store } = await installed(),
      old = quad('old')
    await store.use(rdf).add([old])
    const firstRead = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>()
    let attempts = 0
    const competing = store
      .tx()
      .concurrency(ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }))
      .run(async (scope) => {
        const values = await scope.use(rdf).match({}).all()
        attempts++
        if (attempts === 1) {
          firstRead.resolve()
          await release.promise
        }
        scope.use(rdf).expect(values)
        await scope.use(rdf).delete(values)
        await scope.use(rdf).add([quad('second')])
      })
    await firstRead.promise
    await store.transaction(async (scope) => {
      scope.use(rdf).expect([old])
      await scope.use(rdf).delete([old])
      await scope.use(rdf).add([quad('first')])
    })
    release.resolve()
    await competing
    expect(attempts).toBe(2)
    expect(await store.use(rdf).match({}).all()).toEqual([quad('second')])
  })
  it('uses one real raw body, rejects mixed domains and has no lock builder', async () => {
    const { store, native, updates } = await installed()
    expect('lock' in store.tx()).toBe(false)
    expect(() => store.tx().concurrency(ConcurrencyPolicy.wait() as never)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    await store.transaction((scope) =>
      scope.use(sparql)`INSERT DATA {<https://raw/a> <https://raw/p> "value"}`.update()
    )
    expect(native.query('ASK {<https://raw/a> <https://raw/p> "value"}')).toBe(true)
    updates.length = 0
    for (const mode of ['raw-first', 'rdf-first'])
      await expect(
        store.transaction(async (scope) => {
          if (mode === 'rdf-first') scope.use(rdf).expectAbsent([quad('a')])
          await scope.use(sparql)`INSERT DATA {<https://raw/b> <https://raw/p> "value"}`.update()
          if (mode === 'raw-first') scope.use(rdf).expectAbsent([quad('a')])
        })
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(native.query('ASK {<https://raw/b> ?p ?o}')).toBe(false)
    expect(updates).toHaveLength(0)
    await expect(
      store.transaction(async (scope) => {
        await scope.use(sparql)`INSERT DATA {<https://raw/b> <https://raw/p> "v"}`.update()
        await scope.use(sparql)`INSERT DATA {<https://raw/c> <https://raw/p> "v"}`.update()
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
  it('keeps confirmed user commits when marker cleanup fails and seals an unknown writer without replay', async () => {
    const cause = new Error('cleanup transport failed')
    const good = await installed({
      update: (body, next) => (body.startsWith('DELETE DATA') ? Promise.reject(cause) : next())
    })
    await good.store.use(rdf).add([quad('saved')])
    expect(await good.store.use(rdf).match({}).all()).toEqual([quad('saved')])
    expect(good.reports).toHaveLength(1)
    const uncertain = new Error('acknowledgment lost'),
      bad = await installed({
        update: async (_body, next) => {
          await next()
          throw uncertain
        }
      })
    await expect(bad.store.use(rdf).add([quad('maybe committed')])).rejects.toMatchObject({
      code: 'SPARQL_COMMIT_UNKNOWN',
      cause: uncertain
    })
    expect(bad.updates).toHaveLength(1)
    expect(() => bad.store.use(rdf).add([quad('blocked')])).toThrow(
      expect.objectContaining({ code: 'SPARQL_COMMIT_UNKNOWN' })
    )
    expect(bad.updates).toHaveLength(1)
    expect(await bad.store.use(rdf).match({}).count()).toBe(1)
  })
  it('commits only selected query writes and keeps traversal inside the current native draft', async () => {
    const { store, updates } = await installed(),
      a = quad('a'),
      b = quad('b'),
      c = quad('c'),
      replacement = quad('replacement')
    await store.use(rdf).add([a, b, c])
    updates.length = 0
    expect(
      await store
        .use(rdf)
        .match({})
        .where((value) => value.object.value === 'b')
        .replace(a, replacement)
    ).toBe(0)
    expect(updates).toHaveLength(0)
    expect(
      await store
        .use(rdf)
        .match({})
        .where((value) => value.object.value === 'b')
        .replace(b, replacement)
    ).toBe(1)
    expect(updates).toHaveLength(2)
    expect(
      await store
        .use(rdf)
        .match({})
        .where((value) => value.object.value !== 'a')
        .limit(1)
        .delete()
    ).toBe(1)
    await store.transaction(async (scope) => {
      await scope.use(rdf).add([b])
      expect(
        await scope
          .use(rdf)
          .match({})
          .where((value) => value.object.value === 'b')
          .delete()
      ).toBe(1)
      expect(
        await scope
          .use(rdf)
          .match({})
          .where((value) => value.object.value === 'b')
          .count()
      ).toBe(0)
    })
    const relation = term.iri('https://example/knows'),
      alice = term.iri('https://example/alice'),
      bob = term.iri('https://example/bob'),
      carol = term.iri('https://example/carol'),
      ab = { subject: alice, predicate: relation, object: bob, graph: term.defaultGraph },
      bc = { subject: bob, predicate: relation, object: carol, graph: term.defaultGraph }
    await store.transaction(async (scope) => {
      await scope.use(rdf).add([ab, bc])
      expect(
        await scope
          .use(rdf)
          .match({ subject: alice, predicate: relation })
          .follow(relation)
          .delete()
      ).toBe(1)
      expect(await scope.use(rdf).match({ subject: bob }).count()).toBe(0)
    })
    expect(await store.use(rdf).match({ subject: alice, predicate: relation }).count()).toBe(1)
    expect(await store.use(rdf).match({ subject: bob }).count()).toBe(0)
  })
  it('uses one pipeline per root operation and reports observing hooks without changing the commit', async () => {
    const counts = new Map<string, number>(),
      reports: unknown[] = [],
      intervention = definePlugin('count', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            counts.set(input.operation, (counts.get(input.operation) ?? 0) + 1)
            await next(input)
          })
          return {}
        }
      })),
      host = await createStorageHost({
        report: (error) => {
          reports.push(error)
        },
        plugins: [
          sparqlBackendPlugin(
            { endpoint: oxigraphEndpoint(new Store()) },
            { graphs: graphStoreFeature() }
          ),
          intervention
        ] as const
      })
    onTestFinished(() => host.dispose())
    host.hooks.on('beforeSparqlUpdate', () => {
      throw new TypeError('observer failed')
    })
    host.hooks.on('beforeStorageOperation', async () => {
      throw new RangeError('observer rejected')
    })
    const store = host.backend('sparql')
    await store.use(rdf).add([quad('one'), quad('two')])
    expect(counts.get('rdf.add')).toBe(1)
    expect(await store.use(rdf).match({}).count()).toBe(2)
    expect(counts.get('rdf.match')).toBe(1)
    await store.api.graphStore!.hasGraph({ default: true })
    expect(counts.get('graphStore.hasGraph')).toBe(1)
    counts.clear()
    expect(await store.use(rdf).match({}).delete()).toBe(2)
    expect([...counts]).toEqual([['rdf.query.delete', 1]])
    await store.use(rdf).add([quad('old'), quad('retained')])
    counts.clear()
    await store.transaction(async (scope) => {
      expect(await scope.use(rdf).match({}).replace(quad('old'), quad('new'))).toBe(1)
    })
    expect([...counts]).toEqual([
      ['transaction', 1],
      ['rdf.query.replace', 1]
    ])
    const large = quad('x'.repeat(1024 * 1024 + 1))
    await store.use(rdf).add([large])
    expect(await store.use(rdf).match({ object: large.object }).all()).toEqual([large])
    await Promise.resolve()
    expect(reports.length).toBeGreaterThanOrEqual(3)
  })
  it('cancels active reads on close while draining a sent write and its marker confirmation', async () => {
    const started = Promise.withResolvers<void>()
    const readHost = await createStorageHost({
      plugins: [
        sparqlBackendPlugin({
          endpoint: {
            query: (body, _accept, signal) =>
              body === 'ASK {}'
                ? Promise.resolve('{"boolean":true}')
                : new Promise((_resolve, reject) => {
                    started.resolve()
                    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
                  }),
            update: async () => undefined
          }
        })
      ] as const
    })
    const pendingRead = readHost.backend('sparql').use(rdf).match({}).all(),
      readFailure = pendingRead.catch((error) => error)
    await started.promise
    await readHost.dispose()
    expect(await readFailure).toMatchObject({ code: expect.any(String) })
    const sent = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>()
    const write = await installed({
      update: async (body, next) => {
        await next()
        if (!body.startsWith('DELETE DATA')) {
          sent.resolve()
          await release.promise
        }
      }
    })
    const pendingWrite = write.store.use(rdf).add([quad('drained')])
    await sent.promise
    let closed = false
    const dispose = write.store.dispose().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve()
    await pendingWrite
    await dispose
    expect(write.native.size).toBe(1)
  })
  it('isolates organization graphs and denies raw native terminals outside the default organization', async () => {
    const { store, host, native } = await installed(),
      id = createOrgId(),
      other = host.org(id).backend('sparql')
    await store.use(rdf).add([quad('root')])
    await other.use(rdf).add([quad('other')])
    expect(await other.use(rdf).match({}).all()).toEqual([quad('other')])
    expect(() => other.use(sparql)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(
      native.query(`ASK {GRAPH <${prefixStorageOrgGraph(id, term.defaultGraph).value}> {?s ?p ?o}}`)
    ).toBe(true)
    await host.dropOrg(id)
    expect(await other.use(rdf).match({}).count()).toBe(0)
    expect(await store.use(rdf).match({}).all()).toEqual([quad('root')])
  })
})
