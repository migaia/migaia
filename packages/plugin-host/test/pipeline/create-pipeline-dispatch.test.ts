import { describe, expect, it } from 'vitest'
import {
  GENERATOR_CONTINUE,
  MiddlewarePipelineMode,
  type IMiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import { PluginHostError } from '../../src/error-text.js'
import { PluginHost } from '../../src/host-runtime.js'

/** A8 exercises Host dispatch, canonical lifting, mismatch causality and lane atomicity. */
/** Host exposing pipeline execution for each canonical runner mode. */
class PipelineHost extends PluginHost<Record<string, never>, number> {
  constructor(mode: IMiddlewarePipelineMode) {
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode }
    })
  }

  run(value: number): number | Promise<number> {
    let result = value
    const running = this.runPipeline(value, (next) => {
      result = next
    })
    return running instanceof Promise ? running.then(() => result) : result
  }
}

describe('createPipeline host dispatch', () => {
  it.each(Object.values(MiddlewarePipelineMode))('lifts sync stages into %s mode', async (mode) => {
    const host = new PipelineHost(mode)
    host.usePipeline((value, next) => next(value + 1))
    host.usePipeline((value, next) => next(value * 2))
    await expect(Promise.resolve(host.run(2))).resolves.toBe(6)
    await host.dispose()
  })

  it('stops sync dispatch when a stage begins host disposal', async () => {
    const host = new PipelineHost(MiddlewarePipelineMode.sync)
    let secondRan = false
    host.usePipeline((value, next) => {
      void host.dispose()
      next(value + 1)
    })
    host.usePipeline((value, next) => {
      secondRan = true
      next(value + 1)
    })
    expect(() => host.run(0)).toThrow(expect.objectContaining({ code: 'HOST_DISPOSING' }))
    expect(secondRan).toBe(false)
    await host.dispose()
  })

  it('lifts generator stages into an async-generator host', async () => {
    const host = new PipelineHost(MiddlewarePipelineMode.asyncGenerator)
    host.useGeneratorPipeline(function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    })
    host.useAsyncGeneratorPipeline(async function* (value) {
      return value * 2
    })
    await expect(Promise.resolve(host.run(1))).resolves.toBe(4)
    await host.dispose()
  })

  it('wraps unsupported lifts without adding a sync-host lane', async () => {
    const host = new PipelineHost(MiddlewarePipelineMode.sync)
    host.usePipeline((value, next) => next(value + 1))
    let failure: unknown
    try {
      host.useAsyncPipeline(async (value, next) => next(value * 10))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(PluginHostError)
    expect(failure).toMatchObject({
      code: 'PIPELINE_MODE_MISMATCH',
      detail: { host: expect.any(Object) },
      cause: expect.objectContaining({
        name: 'TypeError',
        code: 'INVALID_OPTION',
        source: '@migaia/middleware-pipeline'
      })
    })
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
    expect(host.run(1)).toBe(2)
    await host.dispose()
  })

  it('wraps unsupported generator lifts without adding an async-host lane', async () => {
    const host = new PipelineHost(MiddlewarePipelineMode.async)
    host.usePipeline((value, next) => next(value + 1))
    let failure: unknown
    try {
      host.useGeneratorPipeline(function* (value) {
        return value * 10
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(PluginHostError)
    expect(failure).toMatchObject({
      code: 'PIPELINE_MODE_MISMATCH',
      detail: { host: expect.any(Object) },
      cause: expect.objectContaining({
        name: 'TypeError',
        code: 'INVALID_OPTION',
        source: '@migaia/middleware-pipeline'
      })
    })
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
    await expect(Promise.resolve(host.run(1))).resolves.toBe(2)
    await host.dispose()
  })
})
