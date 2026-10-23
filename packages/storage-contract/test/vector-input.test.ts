import { describe, expect, it } from 'vitest'
import * as contract from '../src/index.js'

/** Every native test uses the same declared two-component cosine collection. */
const configuration = { dimensions: 2, metric: 'cosine' } as const

describe('vector native input snapshots', () => {
  it('captures optional collection configuration without inventing a native default', () => {
    expect(contract.snapshotStorageVectorCollection('existing')).toEqual({
      name: 'existing',
      options: undefined
    })
    let dimensionsReads = 0
    let metricReads = 0
    const captured = contract.snapshotStorageVectorCollection('docs', {
      get dimensions() {
        dimensionsReads++
        return 2
      },
      get metric(): 'cosine' {
        metricReads++
        return 'cosine'
      }
    })
    expect(captured).toEqual({ name: 'docs', options: configuration })
    expect([dimensionsReads, metricReads]).toEqual([1, 1])
    expect(Object.isFrozen(captured.options)).toBe(true)
    for (const dimensions of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        contract.snapshotStorageVectorCollection('docs', { ...configuration, dimensions })
      ).toThrowError(
        expect.objectContaining({
          source: contract.STORAGE_CONTRACT_SOURCE,
          code: 'INVALID_ARGUMENT'
        })
      )
    expect(() =>
      contract.snapshotStorageVectorCollection('docs', {
        dimensions: 2,
        metric: { toString: () => 'dot' } as never
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('detaches finite dense vectors and rejects the undefined cosine direction', () => {
    const input = [1, 2]
    const captured = contract.snapshotStorageVector(input, configuration)
    input[0] = 9
    expect(captured).toEqual([1, 2])
    expect(Object.isFrozen(captured)).toBe(true)
    expect(
      contract.snapshotStorageVector([Number.MAX_VALUE, Number.MAX_VALUE], configuration)
    ).toEqual([Number.MAX_VALUE, Number.MAX_VALUE])
    expect(contract.snapshotStorageVector([0, 0], { metric: 'dot' })).toEqual([0, 0])
    /** An explicit hole tests dense admission without conflating undefined with absence. */
    const sparse: number[] = []
    sparse.length = 2
    for (const input of [[], [1], [0, -0], [1, NaN], [Infinity, 1], sparse])
      expect(() => contract.snapshotStorageVector(input, configuration)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })

  it('prevalidates a complete batch and preserves last duplicate input with codec payload snapshots', () => {
    class Payload {
      label = 'original'
      nested = { count: 1 }
    }
    const payload = new Payload()
    const vector = [1, 2]
    const points = contract.snapshotStorageVectorUpsert(
      [
        { id: 'a', vector, payload },
        { id: 'a', vector: [2, 1], payload: { label: 'last', nested: { count: 2 } } },
        { id: 'b', vector, payload }
      ],
      configuration
    )
    payload.nested.count = 9
    vector[0] = 9
    expect(points).toEqual([
      { id: 'a', vector: [2, 1], payload: { label: 'last', nested: { count: 2 } } },
      { id: 'b', vector: [1, 2], payload: { label: 'original', nested: { count: 1 } } }
    ])
    expect(Object.getPrototypeOf(points[1]!.payload)).toBe(Object.prototype)
    expect(() =>
      contract.snapshotStorageVectorUpsert(
        [
          { id: 'a', vector: [1, 2] },
          { id: 'a', vector: [0, 0] }
        ],
        configuration
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => contract.snapshotStorageVectorUpsert([], undefined as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const cause = new Error('payload getter')
    expect(() =>
      contract.snapshotStorageVectorUpsert(
        [
          {
            id: 'bad',
            vector: [1, 2],
            payload: {
              get broken() {
                throw cause
              }
            }
          }
        ],
        configuration
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
  })

  it('detaches the closed filter AST and rejects mixed operators, invalid ranges and cycles', () => {
    const values = ['first', 2]
    const filter = {
      all: [{ field: 'metadata.kind', in: values }, { not: { field: 'flag', eq: false } }]
    } as const
    const captured = contract.snapshotStorageVectorFilter(filter)
    values[0] = 'later'
    expect(captured).toEqual({
      all: [{ field: 'metadata.kind', in: ['first', 2] }, { not: { field: 'flag', eq: false } }]
    })
    expect(contract.snapshotStorageVectorFilter({ all: [] })).toEqual({ all: [] })
    expect(contract.snapshotStorageVectorFilter({ any: [] })).toEqual({ any: [] })
    const cycle: { not?: unknown } = {}
    cycle.not = cycle
    for (const invalid of [
      { all: [], any: [] },
      { field: 'a', eq: 1, in: [1] },
      { field: 'a' },
      { field: 'a', gte: 2, lte: 1 },
      { field: 'a', gte: Infinity },
      { field: 'a', in: [true] },
      { field: 'a', eq: NaN },
      { field: '__proto__.a', eq: 1 },
      cycle
    ])
      expect(() => contract.snapshotStorageVectorFilter(invalid as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })

  it('snapshots search once and validates k=0 without suppressing invalid input', () => {
    let queryReads = 0
    let filterReads = 0
    const query = [1, 2]
    const options = {
      k: 0,
      get filter() {
        filterReads++
        return { field: 'a', gte: 0 }
      }
    }
    const input = new Proxy(query, {
      get(target, key, receiver) {
        if (key === '0' || key === '1') queryReads++
        return Reflect.get(target, key, receiver)
      }
    })
    expect(contract.snapshotStorageVectorSearch(input, options, configuration)).toEqual({
      query: [1, 2],
      options: { k: 0, filter: { field: 'a', gte: 0 }, withPayload: false, exact: false }
    })
    expect([queryReads, filterReads]).toEqual([2, 1])
    expect(() =>
      contract.snapshotStorageVectorSearch([0, 0], { k: 0 }, configuration)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const k of [-1, 0.5, Infinity])
      expect(() => contract.snapshotStorageVectorSearch(query, { k }, configuration)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() =>
      contract.snapshotStorageVectorSearch(query, { k: 1, exact: 1 as never }, configuration)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
})
