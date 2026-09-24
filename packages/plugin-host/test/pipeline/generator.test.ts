import { describe, expect, it } from 'vitest'
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from '../../src/typing'

describe('runGeneratorPipeline', () => {
  it('uses final return value and last yield fallback', () => {
    const values: number[] = []
    createPipeline<number>({ mode: MiddlewarePipelineMode.generator }).run(
      [
        function* (value) {
          yield value + 1
          return value + 2
        },
        function* (value) {
          yield value * 2
          return GENERATOR_CONTINUE
        }
      ],
      1,
      (value) => values.push(value)
    )
    expect(values).toEqual([6])
  })

  it('supports an explicit undefined final value', () => {
    const values: unknown[] = []
    createPipeline<unknown>({ mode: MiddlewarePipelineMode.generator }).run(
      [
        function* () {
          return GENERATOR_UNDEFINED
        }
      ],
      'input',
      (value) => values.push(value)
    )
    expect(values).toEqual([undefined])
  })

  it('supports explicit halt after yielding', () => {
    const values: number[] = []
    createPipeline<number>({ mode: MiddlewarePipelineMode.generator }).run(
      [
        function* () {
          yield 2
          return GENERATOR_HALT
        }
      ],
      1,
      (value) => values.push(value)
    )
    expect(values).toEqual([])
  })
})
