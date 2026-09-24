import { describe, expect, it } from 'vitest'
import { MiddlewarePipelineMode, type IMiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { PluginHost } from '../../src/host-runtime.js'

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
})
