import * as contractAuthoringVector from '../src/authoring/vector.ts'
import { describe, expect, it } from 'vitest'
import * as contract from '@migaia/storage-contract'

/** Every native test uses the same declared two-component cosine collection. */
const configuration = { dimensions: 2, metric: 'cosine' } as const

describe('vector native input snapshots', () => {
  it('captures optional collection configuration without inventing a native default', () => {
    expect(contractAuthoringVector.snapshotStorageVectorCollection('existing')).toEqual({
      name: 'existing',
      options: undefined
    })
    const captured = contractAuthoringVector.snapshotStorageVectorCollection('docs', configuration)
    expect(captured).toEqual({ name: 'docs', options: configuration })
    for (const dimensions of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        contractAuthoringVector.snapshotStorageVectorCollection('docs', {
          ...configuration,
          dimensions
        })
      ).toThrowError(
        expect.objectContaining({
          source: contract.STORAGE_CONTRACT_SOURCE,
          code: 'INVALID_ARGUMENT'
        })
      )
    expect(() =>
      contractAuthoringVector.snapshotStorageVectorCollection('docs', {
        dimensions: 2,
        metric: { toString: () => 'dot' } as never
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('detaches finite dense vectors and rejects the undefined cosine direction', () => {
    const input = [1, 2]
    const captured = contractAuthoringVector.snapshotStorageVector(input, configuration)
    input[0] = 9
    expect(captured).toEqual([1, 2])
    expect(
      contractAuthoringVector.snapshotStorageVector(
        [Number.MAX_VALUE, Number.MAX_VALUE],
        configuration
      )
    ).toEqual([Number.MAX_VALUE, Number.MAX_VALUE])
    expect(contractAuthoringVector.snapshotStorageVector([0, 0], { metric: 'dot' })).toEqual([0, 0])
    /** An explicit hole tests dense admission without conflating undefined with absence. */
    const sparse: number[] = []
    sparse.length = 2
    for (const input of [[], [1], [0, -0], [1, NaN], [Infinity, 1], sparse])
      expect(() =>
        contractAuthoringVector.snapshotStorageVector(input, configuration)
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('prevalidates a complete batch and preserves last duplicate input with codec payload snapshots', () => {
    class Payload {
      label = 'original'
      nested = { count: 1 }
    }
    const payload = new Payload()
    const vector = [1, 2]
    const points = contractAuthoringVector.snapshotStorageVectorUpsert(
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
      contractAuthoringVector.snapshotStorageVectorUpsert(
        [
          { id: 'a', vector: [1, 2] },
          { id: 'a', vector: [0, 0] }
        ],
        configuration
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(contractAuthoringVector.snapshotStorageVectorUpsert([])).toEqual([])
  })

  it('captures a whole batch before native schema lookup without inferring dimensions or metric', () => {
    const input = [0]
    const points = contractAuthoringVector.snapshotStorageVectorUpsert([
      { id: 'point', vector: input, payload: { label: 'captured' } }
    ])
    input[0] = 9
    expect(points).toEqual([{ id: 'point', vector: [0], payload: { label: 'captured' } }])
    expect(() =>
      contractAuthoringVector.snapshotStorageVector(points[0]!.vector, {
        dimensions: 1,
        metric: 'cosine'
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      contractAuthoringVector.snapshotStorageVectorUpsert([{ id: 'bad', vector: [NaN] }])
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('detaches the closed filter AST and rejects mixed operators, invalid ranges and cycles', () => {
    const values = ['first', 2]
    const filter = {
      all: [{ field: 'metadata.kind', in: values }, { not: { field: 'flag', eq: false } }]
    } as const
    const captured = contractAuthoringVector.snapshotStorageVectorFilter(filter)
    values[0] = 'later'
    expect(captured).toEqual({
      all: [{ field: 'metadata.kind', in: ['first', 2] }, { not: { field: 'flag', eq: false } }]
    })
    expect(contractAuthoringVector.snapshotStorageVectorFilter({ all: [] })).toEqual({ all: [] })
    expect(contractAuthoringVector.snapshotStorageVectorFilter({ any: [] })).toEqual({ any: [] })
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
      expect(() =>
        contractAuthoringVector.snapshotStorageVectorFilter(invalid as never)
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('captures search query, options and filter before native schema lookup', () => {
    const query = [0]
    const allowed = ['one']
    const captured = contractAuthoringVector.snapshotStorageVectorSearch(query, {
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
      contractAuthoringVector.snapshotStorageVector(captured.query, {
        dimensions: 1,
        metric: 'cosine'
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => contractAuthoringVector.snapshotStorageVectorSearch([NaN], { k: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('validates k=0 without suppressing invalid input', () => {
    const query = [1, 2]
    const options = { k: 0, filter: { field: 'a', gte: 0 } }
    expect(
      contractAuthoringVector.snapshotStorageVectorSearch(query, options, configuration)
    ).toEqual({
      query: [1, 2],
      options: { k: 0, filter: { field: 'a', gte: 0 }, withPayload: false, exact: false }
    })
    expect(() =>
      contractAuthoringVector.snapshotStorageVectorSearch([0, 0], { k: 0 }, configuration)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const k of [-1, 0.5, Infinity])
      expect(() =>
        contractAuthoringVector.snapshotStorageVectorSearch(query, { k }, configuration)
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      contractAuthoringVector.snapshotStorageVectorSearch(
        query,
        { k: 1, exact: 1 as never },
        configuration
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
})

it('captures dense ID batches and deletion modes without changing backend policies', () => {
  const ids = ['a', 'a', '\ud800']
  const captured = contractAuthoringVector.snapshotStorageVectorIds(ids)
  expect(captured).toEqual(['a', 'a', '\ud800'])
  expect(contractAuthoringVector.snapshotStorageVectorIds(['a', 'b'], undefined, true)).toEqual([
    'a',
    'b'
  ])
  const sparse: string[] = []
  sparse.length = 1
  for (const input of [sparse, ['a', 1], {}])
    expect(() => contractAuthoringVector.snapshotStorageVectorIds(input as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  expect(() =>
    contractAuthoringVector.snapshotStorageVectorIds(['a', 'a'], undefined, true)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  expect(contractAuthoringVector.snapshotStorageDeleteCountMode(undefined)).toBe(
    contract.DeleteCountMode.precount
  )
  for (const value of [contract.DeleteCountMode.precount, contract.DeleteCountMode.scroll])
    expect(contractAuthoringVector.snapshotStorageDeleteCountMode(value)).toBe(value)
  for (const value of ['', 'count', null, 0])
    expect(() =>
      contractAuthoringVector.snapshotStorageDeleteCountMode(value as never)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
})
