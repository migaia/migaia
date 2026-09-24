import { describe, expect, it } from 'vitest'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { PluginHost } from '../../src/host-runtime.js'

/** Test host exposing the protected pipeline entry. */
class AsyncHost extends PluginHost<Record<string, never>, number> {
  constructor() {
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode: MiddlewarePipelineMode.async }
    })
  }

  run(value: number): Promise<number> {
    let result = value
    return Promise.resolve(
      this.runPipeline(value, (next) => {
        result = next
      })
    ).then(() => result)
  }
}

describe('async host pipeline', () => {
  it('lifts sync stages and preserves their order', async () => {
    const host = new AsyncHost()
    host.usePipeline((value, next) => next(value + 1))
    host.usePipeline((value, next) => next(value * 2))
    await expect(host.run(2)).resolves.toBe(6)
  })

  it('reports duplicate next through the host error contract', async () => {
    const host = new AsyncHost()
    host.usePipeline((value, next) => {
      next(value + 1)
      next(value + 2)
    })
    await expect(host.run(1)).rejects.toMatchObject({
      source: '@migaia/plugin-host',
      code: 'PIPELINE_NEXT_DUPLICATE'
    })
  })

  it('reports late next without starting downstream work', async () => {
    const diagnostics: string[] = []
    const host = new AsyncHostWithDiagnostic((_, code) => {
      if (code) diagnostics.push(code)
    })
    let storedNext!: (value: number) => void
    host.usePipeline((_value, next) => {
      storedNext = next
    })
    await host.run(1)
    storedNext(2)
    expect(diagnostics).toContain('PIPELINE_NEXT_LATE')
  })
})

/** Async host variant that records pipeline diagnostics. */
class AsyncHostWithDiagnostic extends PluginHost<Record<string, never>, number> {
  constructor(diagnostic: (message: string, code?: string) => void) {
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode: MiddlewarePipelineMode.async },
      diagnostic
    })
  }

  run(value: number): Promise<void> {
    return Promise.resolve(this.runPipeline(value, () => undefined))
  }
}
