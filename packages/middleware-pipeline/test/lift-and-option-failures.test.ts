import { expect, it } from 'vitest'
import { createPipeline, MiddlewarePipelineMode } from '../src/index.ts'
import { generatorMode } from '../src/modes/generator.ts'
import { asyncGeneratorMode } from '../src/modes/async-generator.ts'

it('rejects lifting an async stage into generator modes', () => {
  const stage = async (value: number, next: (value: number) => Promise<void>) => next(value)
  for (const mode of [generatorMode, asyncGeneratorMode]) {
    const pipeline = createPipeline<number>({ mode: mode as typeof generatorMode })
    expect(() => pipeline.lift(stage as never, MiddlewarePipelineMode.async as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  }
})

it('codes a revoked options Proxy and unreadable generator signals as INVALID_OPTION', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  expect(() => createPipeline<number>(proxy as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION' })
  )
  expect(() => createPipeline<number>({ mode: generatorMode, signals: 1 } as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_OPTION' })
  )
  const readFailure = new Error('signal getter failed')
  expect(() =>
    createPipeline<number>({
      mode: generatorMode,
      signals: {
        get halt(): never {
          throw readFailure
        }
      }
    } as never)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: readFailure }))
})
