import { describe, expect, expectTypeOf, it } from 'vitest'
import { recommendStorageVector } from '../src/authoring/vector.js'
import { snapshotStorageVector } from '@migaia/storage-contract'

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
    expect(Object.isFrozen(result)).toBe(true)
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
