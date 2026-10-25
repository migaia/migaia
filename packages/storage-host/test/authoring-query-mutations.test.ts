import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createRecordQuery,
  createRdfQuery,
  createVectorQuery,
  compileStorageQueryCondition
} from '../src/authoring/query.js'
import { createStorageIteratorLifetime } from '../src/authoring/resource.js'
import { ConcurrencyPolicy } from '../src/authoring/concurrency.js'
import { term } from '../src/authoring/rdf.js'
import {
  type IStorageIterator,
  type IStorageKey,
  type IQuad,
  type IRecordQueryMutation,
  type IQueryWriteContext,
  type IOperationContext,
  type IVectorHit,
  type IRdfQueryMutation
} from '@migaia/storage-contract'

/** Test native cursors use the original resource owner rather than inventing cleanup behavior. */
function rows<T>(
  entries: readonly (readonly [IStorageKey, T])[],
  close: () => Promise<void> = async () => undefined
): IStorageIterator<readonly [IStorageKey, T]> {
  /** Only this actual native cursor advances. */
  let position = 0
  /** The original lifetime supplies accepted drain and both cached cleanup paths. */
  const lifetime = createStorageIteratorLifetime<readonly [IStorageKey, T]>({
    close,
    report: console.error
  })
  return {
    next: () =>
      lifetime.advance(async () =>
        position === entries.length
          ? { done: true, value: undefined }
          : { done: false, value: entries[position++]! }
      ),
    dispose: lifetime.dispose,
    return: lifetime.returned,
    [Symbol.asyncDispose]: lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
}
/** Stable ground fixtures intentionally share semantic identity across different source keys. */
function quad(subject: string, object: string): IQuad {
  return {
    subject: term.iri('urn:' + subject),
    predicate: term.iri('urn:knows'),
    object: term.iri('urn:' + object),
    graph: term.defaultGraph
  }
}

describe('original query mutation callbacks', () => {
  it('detaches generic record patches without imposing a different codec value profile', async () => {
    /** These supported generic record fields are encoded by the original backend codec. */
    const patch = { updated: new Date(5), labels: new Map([['role', 'reader']]) }
    /** The actual draft observes detached values while retaining their original native domains. */
    const query = createRecordQuery<{ updated: Date; labels: Map<string, string> }>({
      pushdown: { source: 'original-codec-patch', operators: [], operations: [] },
      execute: () => {
        throw new Error('root source must not open')
      },
      mutate: (request, run) => {
        expect(request.operation).toBe('update')
        if (request.operation !== 'update') throw new Error('expected update')
        expect(request.patch.updated).toBeInstanceOf(Date)
        expect(request.patch.updated).not.toBe(patch.updated)
        expect(request.patch.labels).toBeInstanceOf(Map)
        expect(request.patch.labels).not.toBe(patch.labels)
        return run({ execute: () => rows([['a', patch]]), accept: () => true })
      }
    })
    expect(await query.update(patch)).toBe(1)
  })

  it('streams selected unique record keys inside the original write owner and awaits commit', async () => {
    const entries: readonly (readonly [IStorageKey, { total: number }])[] = [
      ['a', { total: 1 }],
      ['b', { total: 2 }],
      ['b', { total: 2 }],
      ['c', { total: 3 }]
    ]
    const closed = vi.fn(async () => undefined)
    const accepted: IStorageKey[] = []
    const requests: IRecordQueryMutation[] = []
    let committed!: () => void
    let selected!: () => void
    const commit = new Promise<void>((resolve) => {
      committed = resolve
    })
    const selection = new Promise<void>((resolve) => {
      selected = resolve
    })
    const rootExecute = vi.fn(() => rows(entries))
    const query = createRecordQuery<{ total: number }>({
      pushdown: { source: 'write-draft', operators: [], operations: [] },
      execute: rootExecute,
      async mutate(request, run) {
        requests.push(request)
        const count = await run({
          execute: (input) => {
            expect(input.ctx).toBe(request.ctx)
            return rows(entries, closed)
          },
          accept(key, value) {
            expect(value).toHaveProperty('total')
            accepted.push(key)
            return key !== 'c'
          }
        })
        selected()
        await commit
        return count
      }
    }).where((row) => row.total >= 2)
    /** The accepted patch is detached before the original write owner awaits selection and commit. */
    const patch = { total: 9 }
    const policy = ConcurrencyPolicy.optimistic({ retries: 1 })
    const pending = query.update(patch, { concurrency: policy })
    patch.total = 10
    await selection
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(accepted).toEqual(['b', 'c'])
    expect(closed).toHaveBeenCalledTimes(1)
    expect(rootExecute).not.toHaveBeenCalled()
    expect(requests[0]).toMatchObject({
      operation: 'update',
      patch: { total: 9 },
      concurrency: policy
    })
    committed()
    expect(await pending).toBe(1)
    expectTypeOf<IQueryWriteContext<undefined>>().toEqualTypeOf<undefined>()
    expectTypeOf<IQueryWriteContext<IOperationContext>>().toMatchTypeOf<IOperationContext>()
    expectTypeOf(query.select('total')).not.toHaveProperty('delete')
  })

  it('deletes only actual native topK hits after payload predicates without searching again', async () => {
    const hits: readonly IVectorHit<{ total: number }>[] = [
      { id: 'a', score: 1, payload: { total: 3 } },
      { id: 'b', score: 0.5, payload: { total: 2 } }
    ]
    const accepted: string[] = []
    const engine = vi.fn(
      (input: {
        topK: number
        conditions: readonly Parameters<typeof compileStorageQueryCondition>[0][]
      }) => {
        expect(input.topK).toBe(2)
        expect(input.conditions).toHaveLength(1)
        return rows(hits.map((hit) => [hit.id, hit] as const))
      }
    )
    const builder = createVectorQuery<{ total: number }>({
      pushdown: {
        source: 'native-ranked-write',
        operators: ['gte'],
        operations: ['where', 'topK']
      },
      execute: () => {
        throw new Error('root read must not run')
      },
      mutate: (request, run) => {
        expect(request.operation).toBe('delete')
        return run({
          execute: engine,
          accept(_key, hit) {
            accepted.push(hit.id)
            return true
          }
        })
      }
    })
    expectTypeOf(builder).not.toHaveProperty('delete')
    expect(builder).not.toHaveProperty('delete')
    expect(
      await builder
        .where((payload) => payload.total > 2)
        .where({ total: { gte: 2 } })
        .topK(2)
        .delete()
    ).toBe(1)
    expect(accepted).toEqual(['a'])
    expect(engine).toHaveBeenCalledTimes(1)
  })

  it('deduplicates selected ground quads by canonical identity and replaces only the selected old quad', async () => {
    const old = quad('a', 'b')
    const other = quad('c', 'd')
    const replacement = quad('a', 'z')
    const accepted: IQuad[] = []
    const requests: IRdfQueryMutation[] = []
    const query = createRdfQuery(
      {
        pushdown: { source: 'rdf-draft', operators: [], operations: [] },
        execute: () => {
          throw new Error('root read must not run')
        },
        mutate: async (request, run) => {
          requests.push(request)
          return run({
            execute: () =>
              rows([
                ['x', old],
                ['y', quad('a', 'b')],
                ['z', other]
              ]),
            accept(_key, value) {
              accepted.push(value)
              return true
            }
          })
        }
      },
      {}
    )
    expect(await query.delete()).toBe(2)
    expect(accepted).toEqual([old, other])
    accepted.length = 0
    const pending = query.replace(old, replacement)
    expect(await pending).toBe(1)
    expect(accepted).toEqual([old])
    expect(requests[1]).toEqual({
      operation: 'replace',
      oldQuad: old,
      newQuad: replacement,
      ctx: undefined
    })
    expect(requests[1]).not.toHaveProperty('patch')
  })

  it('keeps traversal inside the scoped draft source and deduplicates converging paths', async () => {
    const a = quad('a', 'b')
    const b = quad('b', 'c')
    const inputs: string[] = []
    const query = createRdfQuery(
      {
        pushdown: { source: 'rdf-traversal-write', operators: [], operations: [] },
        execute: () => {
          throw new Error('root read must not run')
        },
        mutate: (_request, run) =>
          run({
            execute(input) {
              inputs.push(input.pattern.subject?.value ?? '*')
              return rows(
                input.pattern.subject === undefined
                  ? [
                      ['1', a],
                      ['2', a]
                    ]
                  : [['3', b]]
              )
            },
            accept(_key, value) {
              expect(value).toEqual(b)
              return true
            }
          })
      },
      {}
    ).follow(term.iri('urn:knows'))
    expect(await query.delete()).toBe(1)
    expect(inputs).toEqual(['*', 'urn:b', 'urn:b'])
  })

  it('rejects unsupported or strict writes before native I/O and preserves primary plus cleanup errors', async () => {
    const execute = vi.fn(() => rows([['a', { total: 1 }]]))
    const mutate = vi.fn(async (_request, run) => run({ execute, accept: () => true }))
    const source = {
      pushdown: { source: 'write-errors', operators: [], operations: [] },
      execute,
      mutate
    }
    await expect(
      createRecordQuery<{ total: number }>({ ...source, mutate: undefined }).delete()
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    await expect(
      createRecordQuery<{ total: number }>(source)
        .where((row) => row.total > 0)
        .requirePushdown()
        .delete()
    ).rejects.toMatchObject({ code: 'QUERY_NOT_PUSHABLE' })
    expect(mutate).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    const primary = new Error('draft rejects write')
    const cleanup = new Error('native cursor rejects close')
    const rejected = createRecordQuery<{ total: number }>({
      ...source,
      mutate: (_request, run) =>
        run({
          execute: () =>
            rows([['a', { total: 1 }]], async () => {
              throw cleanup
            }),
          accept: () => {
            throw primary
          }
        })
    }).delete()
    await expect(rejected).rejects.toBe(primary)
    expect(primary).toHaveProperty('source', '@migaia/storage-contract')
    expect(primary).toMatchObject({ errors: [cleanup] })
  })
})
