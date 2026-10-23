import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createSparqlTag,
  sparqlFragment,
  sparql,
  term,
  implement,
  provideCapabilities,
  type IStorageBase,
  type ISparqlInput,
  type ISparqlFragment,
  type ISparqlQuery,
  type IRdfNamedNode,
  type IRdfLiteral,
  type IOperationContext
} from '../src/index.js'

/** Native callback fixture retains only actual prepared text; no endpoint or parser is fabricated. */
function setup() {
  /** Observations prove preparation occurs only inside a selected native endpoint. */
  const prepared: string[] = []
  /** All four callbacks consume the same immutable fragment owner. */
  const select = vi.fn(async (prepare: () => string) => {
    prepared.push(prepare())
    return []
  })
  /** The actual native callback supplies ASK result identity. */
  const ask = vi.fn(async (prepare: () => string) => {
    prepared.push(prepare())
    return true
  })
  /** CONSTRUCT retains the declared raw result domain rather than inventing ground filtering. */
  const construct = vi.fn(async (prepare: () => string) => {
    prepared.push(prepare())
    return []
  })
  /** Update is one original native body invocation. */
  const update = vi.fn(async (prepare: () => string) => {
    prepared.push(prepare())
  })
  return {
    tag: createSparqlTag({ select, ask, construct, update }),
    prepared,
    select,
    ask,
    construct,
    update
  }
}

describe('canonical SPARQL fragments and native binding', () => {
  it('captures RDF values and escapes syntax while preserving every original native callback', async () => {
    const fixture = setup()
    const literal = { ...term.literal('a"\\\n\r\t\u0000\u0085', { language: 'EN' }) }
    const fragment = sparqlFragment`${term.iri('urn:subject')} ${term.iri('urn:predicate')} ${literal} .`
    const query = fixture.tag`SELECT * WHERE { ${fragment} ${sparqlFragment.var('变量_1')} ?p ?o }`
    literal.value = 'changed'
    expect(fixture.prepared).toEqual([])
    expect(Object.isFrozen(fragment)).toBe(true)
    expect(Object.isFrozen(query)).toBe(true)
    expect('select' in fragment).toBe(false)
    expect('update' in fragment).toBe(false)
    await query.select()
    await query.ask()
    await query.construct()
    await query.update()
    expect(fixture.prepared).toHaveLength(4)
    expect(new Set(fixture.prepared).size).toBe(1)
    expect(fixture.prepared[0]).toBe(
      'SELECT * WHERE { <urn:subject> <urn:predicate> "a\\"\\\\\\n\\r\\t\\u0000\\u0085"@en . ?变量_1 ?p ?o }'
    )
    expect(fixture.select).toHaveBeenCalledOnce()
    expect(fixture.ask).toHaveBeenCalledOnce()
    expect(fixture.construct).toHaveBeenCalledOnce()
    expect(fixture.update).toHaveBeenCalledOnce()
  })

  it('preserves native receiver, context and Promise identity without reading callback getters twice', () => {
    const promise = Promise.resolve([{ value: term.iri('urn:value') }])
    const context: IOperationContext = { pageSize: 3 }
    const reads = { select: 0, ask: 0, construct: 0, update: 0 }
    const selected = function (this: object, prepare: () => string, ctx?: IOperationContext) {
      expect(this).toBe(options)
      expect(ctx).toBe(context)
      expect(prepare()).toBe('SELECT ?value WHERE {}')
      return promise
    }
    const options = {
      get select() {
        reads.select++
        return selected
      },
      get ask() {
        reads.ask++
        return async () => true
      },
      get construct() {
        reads.construct++
        return async () => []
      },
      get update() {
        reads.update++
        return async () => undefined
      }
    }
    const tag = createSparqlTag(options)
    const query = tag`SELECT ?value WHERE {}`
    expect(query.select(context)).toBe(promise)
    expect(reads).toEqual({ select: 1, ask: 1, construct: 1, update: 1 })
  })

  it('retains immutable deep branches and expands repeated fragments at their real positions', async () => {
    const fixture = setup()
    let chain = sparqlFragment`${term.literal('start')}`
    for (let index = 0; index < 2000; index++)
      chain = sparqlFragment`${chain}, ${term.literal(String(index))}`
    const left = fixture.tag`${chain} LEFT`
    const right = fixture.tag`${chain} RIGHT`
    await left.update()
    await right.update()
    expect(fixture.prepared[0]!.endsWith(' LEFT')).toBe(true)
    expect(fixture.prepared[1]!.endsWith(' RIGHT')).toBe(true)
    expect(fixture.prepared[0]!.slice(0, -5)).toBe(fixture.prepared[1]!.slice(0, -6))
    const repeated = fixture.tag`${sparqlFragment.join([sparqlFragment.var('a'), sparqlFragment.var('a')])}${sparqlFragment.empty}`
    await repeated.ask()
    expect(fixture.prepared[2]).toBe('?a ?a')
    expect(sparqlFragment.join([])).toBe(sparqlFragment.empty)
    expect(sparqlFragment``).toBe(sparqlFragment.empty)
  })

  it('uses full VARNAME grammar and rejects malformed values or forged frozen-template shapes before I/O', async () => {
    const fixture = setup()
    for (const name of ['1', '_value', '变量', '😀', 'a\u0300', 'a\u203f']) {
      await fixture.tag`${sparqlFragment.var(name)}`.ask()
      expect(fixture.prepared.at(-1)).toBe('?' + name)
    }
    for (const name of ['', '?x', '$x', 'a-b', 'a:b', 'a b', '\u0300', '\uD800'])
      expect(() => sparqlFragment.var(name)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    for (const value of ['raw', 1, undefined, {}, term.blank('local'), term.defaultGraph])
      expect(() => fixture.tag`SELECT * WHERE { ${value as ISparqlInput} }`).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() => fixture.tag(['SELECT 1'] as unknown as TemplateStringsArray)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      fixture.tag(Object.freeze(['SELECT 1']) as unknown as TemplateStringsArray)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => sparqlFragment.join([{} as ISparqlFragment])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const cause = new Error('RDF input getter failed')
    expect(
      () =>
        fixture.tag`${
          {
            get termType(): never {
              throw cause
            },
            value: 'urn:ignored'
          } as ISparqlInput
        }`
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
    expect(fixture.select).not.toHaveBeenCalled()
    expect(fixture.update).not.toHaveBeenCalled()
  })

  it('preserves optional declared row fields and publishes a callable API without flat KV or generic transactions', () => {
    type IRow = { readonly value: IRdfNamedNode; readonly optional?: IRdfLiteral }
    const fixture = setup()
    const query = fixture.tag<IRow>`SELECT * WHERE {}`
    expectTypeOf(query).toEqualTypeOf<ISparqlQuery<IRow>>()
    expectTypeOf<ReturnType<typeof query.select>>().toEqualTypeOf<Promise<readonly IRow[]>>()
    // @ts-expect-error DefaultGraph is not a SELECT binding value.
    const invalidRow = fixture.tag<{ graph: typeof term.defaultGraph }>`SELECT * WHERE {}`
    expect(Object.isFrozen(invalidRow)).toBe(true)
    const base: IStorageBase = {
      backend: 'sparql-contract',
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      },
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined
    }
    const store = provideCapabilities(base, [implement(sparql, fixture.tag)])
    expect(store.use(sparql)).toBe(fixture.tag)
    expect('get' in store).toBe(false)
    expect(() =>
      implement(sparql, fixture.tag, { forTransaction: (() => ({})) as never })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => createSparqlTag({} as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })
})
