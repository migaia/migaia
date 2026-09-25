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

/**
 * Host-owned failure and closing semantics of an async host. These restore the R2 baselines that
 * exercised the retired `runAsyncPipeline` wrapper directly; they now run through a real host so
 * the host's combiner (`PIPELINE_FAILED`, source `@migaia/plugin-host`) and active checks are what
 * is asserted, not middleware-pipeline's defaults.
 */
describe('async host pipeline failure and closing baselines', () => {
  /** Runs once and returns the rejection value, or a sentinel when the run resolved. */
  const settle = async (host: AsyncHost): Promise<unknown> => {
    try {
      await host.run(1)
      return 'resolved'
    } catch (error) {
      return error
    }
  }

  it('observes downstream failure when upstream throws after next()', async () => {
    const host = new AsyncHost()
    const stageError = new Error('upstream')
    const downstreamError = new Error('downstream')
    host.useAsyncPipeline(async (_value, next) => {
      void next(2)
      throw stageError
    })
    host.useAsyncPipeline(async () => {
      throw downstreamError
    })
    const caught = await settle(host)
    expect(caught).toBeInstanceOf(AggregateError)
    expect(caught).toMatchObject({ code: 'PIPELINE_FAILED', source: '@migaia/plugin-host' })
    expect((caught as AggregateError).errors).toEqual([stageError, downstreamError])
  })

  it.each(['await', 'return'] as const)(
    'keeps two error slots when %s next() and downstream reject with the same Error',
    async (style) => {
      const host = new AsyncHost()
      const sharedError = new Error(`same ${style} error`)
      host.useAsyncPipeline(async (_value, next) => {
        const result = next(2)
        if (style === 'await') await result
        else return result
      })
      host.useAsyncPipeline(async () => Promise.reject(sharedError))
      await expect(host.run(1)).rejects.toMatchObject({
        code: 'PIPELINE_FAILED',
        errors: [sharedError, sharedError]
      })
    }
  )

  it('AF-T24: throw undefined and reject(undefined) are not swallowed as success', async () => {
    const thrown = new AsyncHost()
    thrown.useAsyncPipeline(async () => {
      throw undefined
    })
    await expect(thrown.run(1)).rejects.toBeUndefined()

    const rejected = new AsyncHost()
    rejected.useAsyncPipeline(async (_value, next) => {
      void next(2)
    })
    rejected.useAsyncPipeline(async () => Promise.reject(undefined))
    await expect(rejected.run(1)).rejects.toBeUndefined()
  })

  it('AF-T24: double undefined failures produce a tagged AggregateError with two undefined slots', async () => {
    const host = new AsyncHost()
    host.useAsyncPipeline(async (_value, next) => {
      void next(2)
      throw undefined
    })
    host.useAsyncPipeline(async () => Promise.reject(undefined))
    const caught = await settle(host)
    expect((caught as { code?: string }).code).toBe('PIPELINE_FAILED')
    expect((caught as AggregateError).errors).toEqual([undefined, undefined])
  })

  it('preserves exact stage rejection when host turns closing', async () => {
    const host = new AsyncHost()
    const stageError = new Error('stage failed while host closes')
    host.useAsyncPipeline(async () => {
      void host.dispose()
      throw stageError
    })
    await expect(host.run(1)).rejects.toBe(stageError)
  })

  it('handles long next chains without overflowing the call stack', async () => {
    const host = new AsyncHost()
    for (let position = 0; position < 20000; position += 1)
      host.useAsyncPipeline((value, next) => next(value + 1))
    await expect(host.run(0)).resolves.toBe(20000)
  })

  it('preserves exact downstream rejection when host turns closing', async () => {
    const host = new AsyncHost()
    const downstreamError = new Error('downstream failed while host closes')
    host.useAsyncPipeline(async (_value, next) => {
      void next(2)
    })
    host.useAsyncPipeline(async () => {
      void host.dispose()
      throw downstreamError
    })
    await expect(host.run(1)).rejects.toBe(downstreamError)
  })

  it('combines dual failures before HOST_DISPOSING in exact stage-first order', async () => {
    const host = new AsyncHost()
    const stageError = new Error('stage failed while host closes')
    const downstreamError = new Error('downstream failed while host closes')
    host.useAsyncPipeline(async (_value, next) => {
      void next(2)
      throw stageError
    })
    host.useAsyncPipeline(async () => {
      void host.dispose()
      throw downstreamError
    })
    const caught = await settle(host)
    expect(caught).toBeInstanceOf(AggregateError)
    expect(caught).toMatchObject({ source: '@migaia/plugin-host', code: 'PIPELINE_FAILED' })
    expect((caught as AggregateError).errors).toEqual([stageError, downstreamError])
  })

  it('throws HOST_DISPOSING after successful incomplete dispatch', async () => {
    const host = new AsyncHost()
    host.useAsyncPipeline(async () => {
      void host.dispose()
    })
    await expect(host.run(1)).rejects.toMatchObject({
      source: '@migaia/plugin-host',
      code: 'HOST_DISPOSING'
    })
  })

  it('does not assert HOST_DISPOSING after done completes dispatch', async () => {
    const host = new AsyncHost()
    host.useAsyncPipeline(async (value, next) => {
      await next(value + 1)
      void host.dispose()
    })
    await expect(host.run(1)).resolves.toBe(2)
  })
})
