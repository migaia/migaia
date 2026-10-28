import { describe, expect, it, vi } from 'vitest'
import { defineHost, definePlugin, type IPluginHostCore } from '../../src/index.ts'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { StageLanes } from '../../src/stage-lanes.ts'
import { deferred } from '@migaia/utils/promise'

/** Creates one async host whose owner can choose either execution entry. */
const createHost = () =>
  defineHost<Record<string, never>, number>({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode: MiddlewarePipelineMode.async }
    }
  })

describe('dual pipeline entries', () => {
  it('preserves terminal value and Promise identity with no stages', () => {
    /** No wrapper may replace the backend-owned result. */
    const result = { value: 42 }
    /** Actual operation Promise stays visible to the caller. */
    const promise = Promise.resolve(result)
    /** One canonical host owns both execution entries. */
    const host = createHost()
    expect(host.runPipelineSync(1, () => result)).toBe(result)
    expect(host.runPipelineAsync(1, () => promise)).toBe(promise)
  })

  it('preserves terminal Promise subclass identity with no stages', () => {
    /** Backend-owned Promise subclasses must keep the same empty-lane return identity. */
    class P<T> extends Promise<T> {}
    /** Static resolve constructs a real subclass instance rather than a structural thenable. */
    const terminal = P.resolve(1)
    /** The default async entry must return the backend operation without assimilating it. */
    const host = createHost()
    expect(host.runPipelineAsync(1, () => terminal)).toBe(terminal)
  })

  it('runs the same synchronous stages in both entries and preserves halt', async () => {
    /** Stage order stays identical in the two canonical runner projections. */
    const seen: string[] = []
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    host.usePipeline((value, next) => {
      seen.push('first')
      next(value + 1)
      seen.push('after')
    })
    host.usePipeline((value, next) => {
      seen.push('second')
      next(value * 2)
    })
    expect(host.runPipelineSync(2, (value) => value)).toBe(6)
    expect(seen).toEqual(['first', 'after', 'second'])
    seen.length = 0
    await expect(host.runPipelineAsync(2, async (value) => value)).resolves.toBe(6)
    expect(seen).toEqual(['first', 'after', 'second'])
    /** A halted traversal must leave its terminal uncalled. */
    const halted = createHost()
    halted.usePipeline(() => undefined)
    expect(
      halted.runPipelineSync(1, () => {
        throw new Error('unreachable terminal')
      })
    ).toBeUndefined()
    await expect(
      halted.runPipelineAsync(1, async () => {
        throw new Error('unreachable terminal')
      })
    ).resolves.toBeUndefined()
  })

  it('rejects before any effects and restores sync entry across owner visibility changes', async () => {
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    /** Count both earlier sync stages and the terminal: rejection must enter neither. */
    let effects = 0
    host.usePipeline((value, next) => {
      effects += 1
      next(value)
    })
    /** The registration owns one async intervention until removal or replacement. */
    const plugin = definePlugin({
      name: 'async',
      install: (core: IPluginHostCore<number>) => {
        core.useAsyncPipeline(async (value, next) => {
          effects += 1
          await next(value + 1)
        })
        return {}
      }
    })
    await host.use(plugin)
    /** Rejected sync calls inspect cached counts, without even requesting a stage snapshot. */
    const snapshot = vi.spyOn(StageLanes.prototype, 'snapshot')
    try {
      expect(() =>
        host.runPipelineSync(1, () => {
          effects += 1
        })
      ).toThrowError(
        expect.objectContaining({
          source: 'plugin.host',
          code: 'ASYNC_STAGE_IN_SYNC_ENTRY'
        })
      )
      expect(effects).toBe(0)
      expect(snapshot).not.toHaveBeenCalled()
    } finally {
      snapshot.mockRestore()
    }
    await expect(host.runPipelineAsync(1, async (value) => value)).resolves.toBe(2)
    await host.plugin.disable('async')
    expect(host.runPipelineSync(1, (value) => value)).toBe(1)
    await host.plugin.enable('async')
    expect(() => host.runPipelineSync(1, (value) => value)).toThrowError(
      expect.objectContaining({ code: 'ASYNC_STAGE_IN_SYNC_ENTRY' })
    )
    await host.replace(
      'async',
      definePlugin({
        name: 'async',
        install: (core: IPluginHostCore<number>) => {
          core.usePipeline((value, next) => next(value + 3))
          return {}
        }
      })
    )
    expect(host.runPipelineSync(1, (value) => value)).toBe(4)
    await host.unUse('async')
    expect(host.runPipelineSync(1, (value) => value)).toBe(1)
    await host.dispose()
  })

  it('keeps failed candidate stages invisible and does not revive them later', async () => {
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    /** Installation failure must not increment the published async stage count. */
    const original = new TypeError('candidate failed')
    await expect(
      host.use(
        definePlugin({
          name: 'broken',
          install: (core: IPluginHostCore<number>) => {
            core.useAsyncPipeline(async (value, next) => {
              await next(value)
            })
            throw original
          }
        })
      )
    ).rejects.toMatchObject({ cause: original })
    expect(host.runPipelineSync(1, (value) => value)).toBe(1)
    await expect(host.runPipelineAsync(2, async (value) => value)).resolves.toBe(2)
    await host.dispose()
  })

  it('waits for the actual async terminal before onion cleanup and disposal complete', async () => {
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    /** This real operation remains pending after the middleware reaches its terminal. */
    const operation = deferred<number>()
    /** Entry signal proves that the terminal has started before checking completion. */
    const entered = deferred<void>()
    /** Records actual stage and terminal ordering across asynchronous boundaries. */
    const seen: string[] = []
    host.useAsyncPipeline(async (value, next) => {
      seen.push('before')
      await next(value)
      seen.push('after')
    })
    /** Keeps the in-flight pipeline result for completion and cancellation assertions. */
    const running = host.runPipelineAsync(1, () => {
      entered.resolve()
      return operation.promise
    })
    await entered.promise
    expect(seen).toEqual(['before'])
    operation.resolve(42)
    await expect(running).resolves.toBe(42)
    expect(seen).toEqual(['before', 'after'])
    await host.dispose()
  })

  it.each(['sync', 'async'] as const)(
    'retains next-once and native failure semantics in %s entry',
    async (entry) => {
      /** This owner exercises the next-once failure in each entry. */
      const duplicate = createHost()
      duplicate.usePipeline((value, next) => {
        next(value)
        next(value)
      })
      if (entry === 'sync') {
        expect(() => duplicate.runPipelineSync(1, (value) => value)).toThrowError(
          expect.objectContaining({ code: 'PIPELINE_NEXT_DUPLICATE' })
        )
      } else {
        await expect(duplicate.runPipelineAsync(1, async (value) => value)).rejects.toMatchObject({
          code: 'PIPELINE_NEXT_DUPLICATE'
        })
      }
      /** This owner witnesses exact native stage-error identity. */
      const failed = createHost()
      /** Original failure identity must survive the canonical runner unchanged. */
      const original = new RangeError('stage failure')
      failed.usePipeline(() => {
        throw original
      })
      if (entry === 'sync')
        expect(() => failed.runPipelineSync(1, (value) => value)).toThrow(original)
      else await expect(failed.runPipelineAsync(1, async (value) => value)).rejects.toBe(original)
      await duplicate.dispose()
      await failed.dispose()
    }
  )

  it('retains downstream failure even when an upstream stage catches next rejection', async () => {
    /** The original runner retains downstream failure even when the stage catches next rejection. */
    const original = new Error('handled terminal failure')
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    /** Records that upstream received the downstream rejection before the runner rejects. */
    let recovered = false
    host.useAsyncPipeline(async (value, next) => {
      try {
        await next(value)
      } catch (error) {
        expect(error).toBe(original)
        recovered = true
      }
    })
    await expect(host.runPipelineAsync(1, () => Promise.reject(original))).rejects.toBe(original)
    expect(recovered).toBe(true)
    await host.dispose()
  })

  it('passes the original cancellation signal through the new async entry', async () => {
    /** One canonical owner exercises both runner views and their shared lifecycle. */
    const host = createHost()
    /** Started-stage notification avoids racing cancellation with admission. */
    const entered = deferred<void>()
    /** Stage captures the original host signal; no extra controller is created. */
    let signal: AbortSignal | undefined
    host.useAsyncPipeline(async (_value, _next, context) => {
      signal = context?.signal as AbortSignal
      entered.resolve()
      await new Promise<void>((resolve) => {
        signal!.addEventListener('abort', () => resolve(), { once: true })
      })
    })
    /** Keeps the in-flight pipeline result for completion and cancellation assertions. */
    const running = host.runPipelineAsync(1, async (value) => value)
    await entered.promise
    /** The original disposal Promise waits for the in-flight lease to leave. */
    const closing = host.dispose()
    expect(signal?.aborted).toBe(true)
    await expect(running).rejects.toMatchObject({ code: 'HOST_DISPOSING' })
    await closing
    expect(() => host.runPipelineSync(1, (value) => value)).toThrowError(
      expect.objectContaining({ code: 'HOST_DISPOSED' })
    )
    await expect(host.runPipelineAsync(1, async (value) => value)).rejects.toMatchObject({
      code: 'HOST_DISPOSED'
    })
  })
})
