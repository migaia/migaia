import { describe, expect, it } from 'vitest'
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

describe('runSyncPipeline', () => {
  it('uses stage snapshot and completes value flow', () => {
    const values: number[] = []
    createPipeline<number>({ mode: MiddlewarePipelineMode.sync }).run(
      [(value, next) => next(value + 1), (value, next) => next(value * 2)],
      2,
      (value) => values.push(value)
    )
    expect(values).toEqual([6])
  })
})
