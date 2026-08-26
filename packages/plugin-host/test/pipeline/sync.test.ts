import { describe, expect, it } from 'vitest'
import { runSyncPipeline } from '../../src/pipeline'

describe('runSyncPipeline', () => {
  it('uses stage snapshot and completes value flow', () => {
    const values: number[] = []
    runSyncPipeline<number>(
      [(value, next) => next(value + 1), (value, next) => next(value * 2)],
      2,
      (value) => values.push(value),
      () => {
        throw new Error('unexpected violation')
      }
    )
    expect(values).toEqual([6])
  })
})
