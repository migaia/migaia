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
    const captured = contract.snapshotStorageVectorCollection('docs', configuration)
    expect(captured).toEqual({ name: 'docs', options: configuration })
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
    expect(contract.snapshotStorageVectorUpsert([])).toEqual([])
  })

  it('captures a whole batch before native schema lookup without inferring dimensions or metric', () => {
    const input = [0]
    const points = contract.snapshotStorageVectorUpsert([
      { id: 'point', vector: input, payload: { label: 'captured' } }
    ])
    input[0] = 9
    expect(points).toEqual([{ id: 'point', vector: [0], payload: { label: 'captured' } }])
    expect(() =>
      contract.snapshotStorageVector(points[0]!.vector, { dimensions: 1, metric: 'cosine' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => contract.snapshotStorageVectorUpsert([{ id: 'bad', vector: [NaN] }])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
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

  it('captures search query, options and filter before native schema lookup', () => {
    const query = [0]
    const allowed = ['one']
    const captured = contract.snapshotStorageVectorSearch(query, {
      k: 1,
      filter: { field: 'category', in: allowed },
      withPayload: true,
      exact: true
    })
    query[0] = 9
    allowed.push('two')
    expect(captured).toEqual({
      query: [0],
      options: { k: 1, filter: { field: 'category', in: ['one'] }, withPayload: true, exact: true }
    })
    expect(() =>
      contract.snapshotStorageVector(captured.query, { dimensions: 1, metric: 'cosine' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => contract.snapshotStorageVectorSearch([NaN], { k: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('validates k=0 without suppressing invalid input', () => {
    const query = [1, 2]
    const options = { k: 0, filter: { field: 'a', gte: 0 } }
    expect(contract.snapshotStorageVectorSearch(query, options, configuration)).toEqual({
      query: [1, 2],
      options: { k: 0, filter: { field: 'a', gte: 0 }, withPayload: false, exact: false }
    })
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

it('captures dense ID batches and deletion modes without changing backend policies', () => {
  const ids = ['a', 'a', '\ud800']
  const captured = contract.snapshotStorageVectorIds(ids)
  expect(captured).toEqual(['a', 'a', '\ud800'])
  expect(contract.snapshotStorageVectorIds(['a', 'b'], undefined, true)).toEqual(['a', 'b'])
  const sparse: string[] = []
  sparse.length = 1
  for (const input of [sparse, ['a', 1], {}])
    expect(() => contract.snapshotStorageVectorIds(input as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  expect(() => contract.snapshotStorageVectorIds(['a', 'a'], undefined, true)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' })
  )
  expect(contract.snapshotStorageDeleteCountMode(undefined)).toBe(contract.DeleteCountMode.precount)
  for (const value of [contract.DeleteCountMode.precount, contract.DeleteCountMode.scroll])
    expect(contract.snapshotStorageDeleteCountMode(value)).toBe(value)
  for (const value of ['', 'count', null, 0])
    expect(() => contract.snapshotStorageDeleteCountMode(value as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
})
