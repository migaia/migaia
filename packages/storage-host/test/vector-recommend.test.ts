import { describe, expect, expectTypeOf, it } from 'vitest'
import { recommendStorageVector } from '../src/authoring/vector.ts'
import { snapshotStorageVector } from '../src/authoring/vector.ts'
import { mmr } from '../src/vector/mmr.ts'

describe('pure vector MMR reranker', () => {
  it('encodes deterministic greedy selection order for lambda zero, one and one half', () => {
    const input = {
      origin: { kind: 'near' as const, vector: [1, 0] },
      hits: [
        { id: 'a', score: 3, vector: [1, 0] },
        { id: 'b', score: 2, vector: [1, 0] },
        { id: 'c', score: 1.5, vector: [0.6, 0.8] },
        { id: 'd', score: 1, vector: [0, 1] }
      ]
    }
    const ctx = { signal: new AbortController().signal }
    expect(mmr({ lambda: 0 })(input, ctx)).toEqual([4, 1, 2, 3])
    expect(mmr({ lambda: 1 })(input, ctx)).toEqual([4, 3, 2, 1])
    expect(mmr({ lambda: 0.5 })(input, ctx)).toEqual([4, 3, 1, 2])
    expect(mmr({ lambda: 0.5, topN: 2 })(input, ctx)).toEqual([4, 3, 2, 1])
    expect(mmr({ lambda: 0.5, topN: 10 })(input, ctx)).toEqual([4, 3, 1, 2])
    expect(mmr({ lambda: 0.5 })({ ...input, hits: [] }, ctx)).toEqual([])
    expect(
      mmr({ lambda: 0.5 })(
        {
          ...input,
          hits: [
            { id: 'a', score: 1, vector: [0, 0] },
            { id: 'b', score: 1, vector: [0, 0] },
            { id: 'c', score: 1, vector: [0, 0] }
          ]
        },
        ctx
      )
    ).toEqual([3, 2, 1])
    expect(() => mmr({ lambda: -1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => mmr({ lambda: NaN })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    for (const topN of [0, -1, 1.5, NaN, Infinity])
      expect(() => mmr({ lambda: 0.5, topN })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    function invalidTypes() {
      // @ts-expect-error Diversity requires explicitly retrieved vectors.
      mmr({ lambda: 0.5 })({ origin: input.origin, hits: [{ id: 'x', score: 1 }] }, ctx)
    }
    void invalidTypes
  })
})

describe('native vector recommendation synthesis', () => {
  it('uses positive mean minus negative mean, with no negative samples contributing zero', () => {
    expect(
      recommendStorageVector(
        [
          [2, 0],
          [0, 2]
        ],
        [[1, 0]]
      )
    ).toEqual([0, 1])
    expect(recommendStorageVector([[2, 4]], [])).toEqual([2, 4])
    expect(recommendStorageVector([[2, 4]])).toEqual([2, 4])
    expect(recommendStorageVector([[Number.MAX_VALUE], [Number.MAX_VALUE]])).toEqual([
      Number.MAX_VALUE
    ])
    expect(
      recommendStorageVector([[Number.MAX_VALUE]], [[-Number.MAX_VALUE], [Number.MAX_VALUE]])
    ).toEqual([Number.MAX_VALUE])
  })
  it('detaches readonly samples and keeps cosine zero rejection in the collection query owner', () => {
    /** Compile-time readonly samples use the actual public authoring signature. */
    const samples = [[1, 0]] as const
    const result = recommendStorageVector(samples, samples)
    expectTypeOf(result).toEqualTypeOf<readonly number[]>()
    expect(result).toEqual([0, 0])
    expect(() => snapshotStorageVector(result, { dimensions: 2, metric: 'cosine' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const input = [1, 2]
    const independent = recommendStorageVector([input])
    input[0] = 9
    expect(independent).toEqual([1, 2])
  })
  it('rejects empty, sparse, mismatched, nonfinite or inaccessible samples with the original cause', () => {
    /** A sparse sample set must not silently change the arithmetic denominator. */
    const sparse: number[][] = []
    sparse.length = 2
    sparse[0] = [1, 0]
    for (const positive of [[], sparse, [[1, 2], [1]], [[1, NaN]], [[1, Infinity]]])
      expect(() => recommendStorageVector(positive as [number[], ...number[][]])).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() => recommendStorageVector([[1]], [[2, 3]])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Failed component access crosses the same contract boundary and retains exact identity. */
    const cause = new Error('sample getter')
    const input = [1, 2]
    Object.defineProperty(input, 0, {
      get() {
        throw cause
      }
    })
    expect(() => recommendStorageVector([input])).toThrowError(expect.objectContaining({ cause }))
  })
})
