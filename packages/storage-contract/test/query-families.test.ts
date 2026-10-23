import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createRdfQuery,
  createVectorQuery,
  QueryOperation,
  QueryOperator,
  term,
  type IQuad,
  type IRdfQueryInput,
  type IRdfQuerySource,
  type IStorageIterator,
  type IStorageKey,
  type IVectorHit,
  type IVectorQuerySource,
  type IVectorQueryInput
} from '../src/index.js'
import { createStorageIteratorLifetime } from '../src/resource.js'

/** Original cursor ownership is shared by every family test, including early-exit cleanup. */
function rows<T>(
  values: readonly T[],
  close: () => void = () => undefined,
  report: (error: unknown) => void = () => undefined
): IStorageIterator<readonly [IStorageKey, T]> {
  /** Only the original native cursor's position advances. */
  let position = 0
  /** The production resource owner supplies cached cleanup and accepted-advance draining. */
  const lifetime = createStorageIteratorLifetime<readonly [IStorageKey, T]>({
    close: async () => close(),
    report: async (error) => report(error)
  })
  return {
    next: () =>
      lifetime.advance(async () =>
        position === values.length
          ? { done: true, value: undefined }
          : { done: false, value: [String(position), values[position++]!] as const }
      ),
    dispose: lifetime.dispose,
    return: lifetime.returned,
    [Symbol.asyncDispose]: lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

describe('shared vector query family', () => {
  it('reduces each native family through its original typed input and scalar cursor', async () => {
    const execute = vi.fn(() => rows([]))
    const close = vi.fn()
    const vector: IVectorQuerySource<{ enabled: boolean }> = {
      pushdown: { source: 'vector-native-count', operators: [], operations: ['topK', 'count'] },
      execute,
      reduce(input) {
        expect(input.topK).toBe(2)
        expect(input.reduction).toEqual({ operation: 'count' })
        return rows([2], close)
      }
    }
    expect(await createVectorQuery(vector).topK(2).requirePushdown().count()).toBe(2)
    const rdf: IRdfQuerySource = {
      pushdown: { source: 'rdf-native-exists', operators: [], operations: ['exists'] },
      execute,
      reduce(input) {
        expect(input.pattern).toEqual({ subject: term.iri('urn:a') })
        expect(input.reduction).toEqual({ operation: 'exists' })
        return rows([true], close)
      }
    }
    expect(
      await createRdfQuery(rdf, { subject: term.iri('urn:a') })
        .requirePushdown()
        .exists()
    ).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('pushes declarative filters across callbacks before native ranking and never refills topK', async () => {
    /** Fixture scores are already ordered by the native engine's score/id contract. */
    const points = [
      { id: 'a', score: 10, payload: { enabled: false, group: 'one' }, vector: [1] },
      { id: 'b', score: 9, payload: { enabled: true, group: 'one' }, vector: [2] },
      { id: 'c', score: 8, payload: { enabled: true, group: 'two' }, vector: [3] },
      { id: 'd', score: 7, payload: { enabled: true, group: 'two' }, vector: [4] }
    ]
    /** The native callback exposes what the planner sends before returning its bounded hits. */
    const execute = vi.fn((input: IVectorQueryInput) =>
      rows(
        points
          .filter((point) =>
            input.conditions
              .flatMap((condition) =>
                condition.kind === 'and' ? condition.conditions : [condition]
              )
              .every(
                (condition) =>
                  condition.kind === 'field' &&
                  condition.path[0] === 'enabled' &&
                  condition.value === point.payload.enabled
              )
          )
          .filter((point) => input.minScore === undefined || point.score >= input.minScore)
          .slice(0, input.topK)
          .map((point) =>
            input.withVector ? point : { id: point.id, score: point.score, payload: point.payload }
          )
      )
    )
    /** Native support facts are consumed by the original shared planner. */
    const builder = createVectorQuery({
      pushdown: {
        source: 'native-vector',
        index: 'ann',
        operators: [QueryOperator.eq],
        operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore]
      },
      execute
    })
    /** This callback rejects one engine hit; a later matching point must not replace it. */
    const predicate = vi.fn(
      (payload: { enabled: boolean; group: string }) => payload.group === 'two'
    )
    /** Immutable forks retain separate thresholds and vector-return intent without opening I/O. */
    const query = builder.where(predicate).where({ enabled: true }).topK(2).minScore(8)
    expect(execute).not.toHaveBeenCalled()
    expect('all' in builder).toBe(false)
    expect(query.explain().client).toEqual([{ operation: 'predicate', reason: expect.any(String) }])
    expect(query.explain().pushed.map((step) => step.operation)).toEqual([
      'where',
      'topK',
      'minScore'
    ])
    expect(query.explain().fullScan).toBe(false)
    expect(await query.all()).toEqual([
      { id: 'c', score: 8, payload: { enabled: true, group: 'two' } }
    ])
    expect(predicate).toHaveBeenCalledTimes(2)
    expect((await query.withVector().first())?.vector).toEqual([3])
    /** Type assertions do not execute another native query. */
    const typedFirst = () => query.withVector().first()
    expectTypeOf(typedFirst).returns.toEqualTypeOf<
      Promise<IVectorHit<{ enabled: boolean; group: string }, true> | undefined>
    >()
    await expect(query.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(execute).toHaveBeenCalledTimes(2)
    function invalidTypes() {
      // @ts-expect-error A vector builder cannot read without topK.
      builder.all()
      // @ts-expect-error Vector ordering is the native score order.
      query.orderBy(() => 'a')
      // @ts-expect-error Vector results do not expose record numeric statistics.
      query.sum('score')
      // @ts-expect-error This source did not declare grouping.
      query.groupBy('group', { perGroup: 1 })
    }
    void invalidTypes
  })

  it('groups only the filtered original hits with typed scalar keys and bounded group prefixes', async () => {
    /** Mixed scalar types and absent fields exercise the standard grouping identity. */
    const hits = [
      { id: 'a', score: 9, payload: { group: 1 } },
      { id: 'b', score: 8, payload: { group: '1' } },
      { id: 'c', score: 7, payload: { group: 1 } },
      { id: 'd', score: 6, payload: { group: false } },
      { id: 'e', score: 5, payload: {} }
    ]
    const execute = vi.fn(() => rows(hits))
    const query = createVectorQuery<{ group?: number | string | boolean }, true>({
      pushdown: { source: 'native-vector', operators: [], operations: ['topK'] },
      groupBy: true,
      exact: true,
      execute
    }).topK(5)
    expect(query.explain().fullScan).toBe(true)
    expect(await query.groupBy('group', { perGroup: 1 }).all()).toEqual([
      { group: 1, hits: [hits[0]] },
      { group: '1', hits: [hits[1]] },
      { group: false, hits: [hits[3]] }
    ])
    expect(() => query.topK(0)).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => query.minScore(NaN)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => query.groupBy('group', { perGroup: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect('sum' in query.select('score')).toBe(false)
  })
})

describe('shared RDF query family', () => {
  it('traverses client predicates through original same-graph ground matches and closes child sources first', async () => {
    const knows = term.iri('urn:knows')
    const graph = term.iri('urn:graph')
    const quad = (subject: string, object: string, selectedGraph = graph): IQuad => ({
      subject: term.iri('urn:' + subject),
      predicate: knows,
      object: term.iri('urn:' + object),
      graph: selectedGraph
    })
    const data = [
      quad('a', 'b'),
      quad('b', 'c'),
      quad('b', 'd'),
      quad('b', 'c', term.iri('urn:other'))
    ]
    const closed: string[] = []
    const execute = vi.fn((input: IRdfQueryInput) => {
      expect(input.steps).toEqual([])
      const pattern = input.pattern
      const matching = data.filter((quad) =>
        (Object.keys(pattern) as (keyof IQuad)[]).every(
          (field) =>
            quad[field].termType === pattern[field]!.termType &&
            Reflect.get(quad[field], 'value') === Reflect.get(pattern[field]!, 'value')
        )
      )
      return rows(matching, () =>
        closed.push(pattern.subject?.value ?? 'object:' + pattern.object!.value)
      )
    })
    const query = createRdfQuery(
      { pushdown: { source: 'rdf-ground-match', operators: [], operations: [] }, execute },
      { subject: term.iri('urn:a'), graph }
    )
      .where(() => true)
      .follow(knows, term.iri('urn:c'))
      .inverse(knows)
      .limit(1)
    expect(query.explain().client.map((step) => step.operation)).toEqual([
      'predicate',
      'follow',
      'inverse',
      'limit'
    ])
    expect(await query.select('subject').all()).toEqual([{ subject: term.iri('urn:a') }])
    expect(closed).toEqual(['object:urn:b', 'urn:b', 'urn:a'])
    expect(execute).toHaveBeenCalledTimes(3)
    await expect(query.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('retains child and root cleanup failures and reports each original symbolic resource once', async () => {
    const knows = term.iri('urn:knows')
    const a: IQuad = {
      subject: term.iri('urn:a'),
      predicate: knows,
      object: term.iri('urn:b'),
      graph: term.defaultGraph
    }
    const b: IQuad = {
      subject: term.iri('urn:b'),
      predicate: knows,
      object: term.iri('urn:c'),
      graph: term.defaultGraph
    }
    const childFailure = new Error('child RDF cleanup failed')
    const rootFailure = new Error('root RDF cleanup failed')
    const childReport = vi.fn()
    const rootReport = vi.fn()
    const close = vi.fn((child: boolean) => {
      throw child ? childFailure : rootFailure
    })
    const query = createRdfQuery(
      {
        pushdown: { source: 'rdf-cleanup', operators: [], operations: [] },
        execute: (input) => {
          const child = input.pattern.subject?.value === 'urn:b'
          return rows([child ? b : a], () => close(child), child ? childReport : rootReport)
        }
      },
      { subject: a.subject }
    )
      .follow(knows)
      .limit(1)
    const stream = query.stream()
    expect(await stream.next()).toEqual({ done: false, value: b })
    const main = stream.dispose()
    expect(stream.dispose()).toBe(main)
    await expect(main).rejects.toBe(childFailure)
    expect(childFailure).toMatchObject({ errors: [rootFailure] })
    const symbolic = stream[Symbol.asyncDispose]()
    expect(stream[Symbol.asyncDispose]()).toBe(symbolic)
    await symbolic
    expect(childReport).toHaveBeenCalledWith(childFailure)
    expect(rootReport).toHaveBeenCalledWith(rootFailure)
    expect(childReport).toHaveBeenCalledTimes(1)
    expect(rootReport).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('pages the same RDF reader and rejects a different captured ground pattern before I/O', async () => {
    const predicate = term.iri('urn:predicate')
    const values: IQuad[] = ['a', 'b', 'c'].map((id) => ({
      subject: term.iri('urn:' + id),
      predicate,
      object: term.iri('urn:object'),
      graph: term.defaultGraph
    }))
    const execute = vi.fn(() => rows(values))
    const identity = Object.freeze({})
    const source: IRdfQuerySource = {
      pushdown: { source: 'rdf-pages', operators: [], operations: [] },
      cursorSource: identity,
      execute
    }
    const query = createRdfQuery(source, { predicate })
    const first = await query.select('subject').page(2)
    expect(first.items).toEqual(values.slice(0, 2).map(({ subject }) => ({ subject })))
    expect((await query.after(first.next!).page(2)).items).toEqual([values[2]])
    expect(execute).toHaveBeenCalledTimes(2)
    await expect(
      createRdfQuery(source, { subject: term.iri('urn:different') })
        .after(first.next!)
        .page(2)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('shares selector ordering and offset controls with records without exposing key metadata', async () => {
    /** Each quad retains its original native key while only real quad fields leave the reader. */
    const quads = ['c', 'a', 'b'].map((id): IQuad => ({
      subject: term.iri('urn:' + id),
      predicate: term.iri('urn:p'),
      object: term.literal(id),
      graph: term.defaultGraph
    }))
    const query = createRdfQuery(
      {
        pushdown: { source: 'rdf', operators: [], operations: [] },
        execute: () => rows(quads)
      },
      {}
    )
      .orderBy((quad) => quad.subject.value)
      .skip(1)
      .limit(1)
    expect(await query.select('subject').all()).toEqual([{ subject: term.iri('urn:b') }])
    const stream = query.stream()
    expect(Object.keys(await stream.next())).toEqual(['done', 'value'])
    await stream.dispose()
  })

  it('admits native field projection without claiming projected rows are complete quads', async () => {
    /** The engine returns its actual selected shape, rather than an unsafe complete-quad cast. */
    const source: IRdfQuerySource = {
      pushdown: { source: 'rdf', operators: [], operations: ['select'] },
      execute: (input) => {
        expect(input.steps).toEqual([{ operation: 'select', fields: ['subject'] }])
        return rows([{ subject: term.iri('urn:selected') }])
      }
    }
    expect(await createRdfQuery(source, {}).select('subject').requirePushdown().all()).toEqual([
      { subject: term.iri('urn:selected') }
    ])
  })

  it('snapshots ground patterns and passes ordered native traversal/projection without opening I/O', async () => {
    /** The fixture's native traversal returns the next ground quad in the same graph. */
    const quad: IQuad = {
      subject: term.iri('urn:b'),
      predicate: term.iri('urn:knows'),
      object: term.iri('urn:c'),
      graph: term.defaultGraph
    }
    const close = vi.fn()
    const execute = vi.fn((_input: IRdfQueryInput) => rows([quad], close))
    const pattern = { subject: term.iri('urn:a') }
    const query = createRdfQuery(
      {
        pushdown: {
          source: 'rdf',
          index: 'spog',
          operators: ['eq'],
          operations: ['where', 'follow', 'inverse', 'select']
        },
        execute
      },
      pattern
    )
      .follow(term.iri('urn:knows'), term.iri('urn:c'))
      .inverse(term.iri('urn:parent'))
    pattern.subject = term.iri('urn:changed')
    expect(execute).not.toHaveBeenCalled()
    expect(query.explain().pushed.map((step) => step.operation)).toEqual(['follow', 'inverse'])
    expect(query.explain().fullScan).toBe(false)
    expect(await query.first()).toBe(quad)
    expect(execute.mock.calls[0]![0]).toMatchObject({
      pattern: { subject: term.iri('urn:a') },
      steps: [
        { operation: 'follow', predicate: term.iri('urn:knows'), target: term.iri('urn:c') },
        { operation: 'inverse', predicate: term.iri('urn:parent') }
      ]
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(() => query.follow(term.blank('raw') as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => query.follow(undefined as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    function invalidTypes() {
      // @ts-expect-error Ground traversal cannot use request-local blank node identity.
      query.follow(term.blank('raw'))
      // @ts-expect-error RDF has no vector ranking method.
      query.topK(1)
      // @ts-expect-error RDF has no record patch method.
      query.update({})
    }
    void invalidTypes
  })
})
