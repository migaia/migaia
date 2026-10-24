import { describe, expect, it } from 'vitest'
import * as contract from '../src/index.js'

/** Every native test uses the same declared two-component cosine collection. */
const configuration = { dimensions: 2, metric: 'cosine' } as const

describe('vector native input snapshots', () => {
  it('rejects invalid borrowed Proxy array bounds before treating input as empty', () => {
    /** A supported array Proxy can report a bound different from its physical target length. */
    const invalid = new Proxy([1, 2], {
      get(target, key, receiver) {
        return key === 'length' ? -1 : Reflect.get(target, key, receiver)
      }
    })
    for (const capture of [
      () => contract.snapshotStorageVector(invalid),
      () => contract.snapshotStorageVectorUpsert(invalid as never, configuration),
      () => contract.snapshotStorageVectorFilter({ all: invalid as never }),
      () => contract.snapshotStorageVectorFilter({ field: 'tag', in: invalid })
    ])
      expect(capture).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
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
    expect(contract.snapshotStorageVectorUpsert([])).toEqual([])
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

  it('captures a whole batch before native schema lookup without inferring dimensions or metric', () => {
    let reads = 0
    const input = [0]
    const points = contract.snapshotStorageVectorUpsert([
      {
        get id() {
          reads += 1
          return 'point'
        },
        get vector() {
          reads += 1
          return input
        },
        get payload() {
          reads += 1
          return { label: 'captured' }
        }
      }
    ])
    input[0] = 9
    expect(reads).toBe(3)
    expect(points).toEqual([{ id: 'point', vector: [0], payload: { label: 'captured' } }])
    expect(Object.isFrozen(points[0]!.vector)).toBe(true)
    expect(() =>
      contract.snapshotStorageVector(points[0]!.vector, { dimensions: 1, metric: 'cosine' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => contract.snapshotStorageVectorUpsert([{ id: 'bad', vector: [NaN] }])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(reads).toBe(3)
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
    let reads = 0
    const query = [0]
    const allowed = ['one']
    const captured = contract.snapshotStorageVectorSearch(query, {
      get k() {
        reads += 1
        return 1
      },
      get filter() {
        reads += 1
        return { field: 'category', in: allowed }
      },
      get withPayload() {
        reads += 1
        return true
      },
      get exact() {
        reads += 1
        return true
      }
    })
    query[0] = 9
    allowed.push('two')
    expect(reads).toBe(4)
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
    expect(reads).toBe(4)
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

it('captures dense ID batches and deletion modes without changing backend policies', () => {
  let reads = 0
  const ids = ['a', 'a', '\ud800']
  Object.defineProperty(ids, 0, {
    get: () => {
      reads++
      return 'a'
    }
  })
  const captured = contract.snapshotStorageVectorIds(ids)
  expect(reads).toBe(1)
  expect(captured).toEqual(['a', 'a', '\ud800'])
  expect(Object.isFrozen(captured)).toBe(true)
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
  const failure = new RangeError('ID getter failed'),
    broken = ['a']
  Object.defineProperty(broken, 0, {
    get: () => {
      throw failure
    }
  })
  expect(() => contract.snapshotStorageVectorIds(broken)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: failure })
  )
  expect(contract.snapshotStorageDeleteCountMode(undefined)).toBe(contract.DeleteCountMode.precount)
  for (const value of [contract.DeleteCountMode.precount, contract.DeleteCountMode.scroll])
    expect(contract.snapshotStorageDeleteCountMode(value)).toBe(value)
  for (const value of ['', 'count', null, 0])
    expect(() => contract.snapshotStorageDeleteCountMode(value as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
})
