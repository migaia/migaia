import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { type IPluginHostCore } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/testing'
import { createHost } from '../src/host/index.ts'
import { TestHost, AsyncTestHost, options, plugin } from './host-helper.ts'

describe('@migaia/tray/host', () => {
  it('uses quiescenceMs as a logical wait budget without premature cleanup', async () => {
    const scheduler = createManualScheduler()
    const timeline: string[] = []
    let raw: AsyncTestHost | undefined
    let releaseStage!: () => void
    let started!: () => void
    const stageStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve
    })
    let disposed = false
    const managed = await createHost({
      ...options([], () => {
        raw = new AsyncTestHost({
          scheduler,
          pipeline: { mode: 'async' },
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        return raw
      }),
      quiescenceMs: 10,
      plugins: [
        {
          name: 'provider',
          features: plugin('provider').features,
          install: (core: IPluginHostCore<string>) => {
            core.onDispose(() => {
              timeline.push('dispose:provider')
            })
            return { provider: true }
          }
        },
        {
          name: 'staged',
          features: plugin('staged', ['provider']).features,
          install: (core: IPluginHostCore<string>) => {
            core.useAsyncPipeline(async (value: string, next: (value: string) => Promise<void>) => {
              timeline.push('stage:start')
              started()
              await stageGate
              timeline.push('stage:release')
              await next(value)
            })
            core.onDispose(() => {
              disposed = true
              timeline.push('dispose:staged')
            })
            return {}
          }
        }
      ]
    } as never)
    const running = raw!.runValue('value')
    await stageStarted
    const removalPromise = managed.unUse('provider')
    await Promise.resolve()
    scheduler.advance(10)
    const removal = await removalPromise
    const physicalCompletion = removal.physicalCompletion
    expect(removal.cleanupComplete).toBe(false)
    expect(removal.cleanupErrors).toEqual([])
    expect(physicalCompletion).toBeDefined()
    expect(removal.physicalCompletion).toBe(physicalCompletion)
    expect(disposed).toBe(false)
    expect(timeline).toEqual(['stage:start'])
    releaseStage()
    await running
    await physicalCompletion
    expect(disposed).toBe(true)
    expect(timeline).toEqual(['stage:start', 'stage:release', 'dispose:staged', 'dispose:provider'])
    await managed.dispose()
  })

  it('keeps physical cleanup from a Host-owned resource in another realm', async () => {
    /** A Host subclass can own additional realm-specific resources after its base cleanup. */
    const failure = new Error('foreign resource cleanup')
    /** Completes the actual foreign Promise after the managed result is returned. */
    let finish!: () => void
    const foreign = runInNewContext(
      'new Promise(resolve => install(() => resolve({ cleanupErrors: [failure] })))',
      {
        failure,
        install: (complete: () => void) => {
          finish = complete
        }
      }
    ) as Promise<{ readonly cleanupErrors: readonly unknown[] }>
    /** Base Host cleanup remains genuine; the extra resource keeps its own realm's Promise. */
    class ForeignResourceHost extends TestHost {
      override async dispose() {
        const result = await super.dispose()
        return { ...result, cleanupComplete: false, physicalCompletion: foreign }
      }
    }
    const managed = await createHost(
      options(
        [],
        () =>
          new ForeignResourceHost({
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
          })
      )
    )
    const result = await managed.dispose()
    expect(result.cleanupComplete).toBe(false)
    finish()
    const physical = await result.physicalCompletion!
    expect(physical.cleanupErrors).toEqual([failure])
    expect(physical.cleanupErrors[0]).toBe(failure)
  })

  it('keeps creation cleanupErrors immediate and physicalCompletion separate', async () => {
    const pending = new Promise<never>(() => {})
    class FailingHost extends TestHost {
      override dispose() {
        return Promise.resolve({
          logicalTerminal: true as const,
          cleanupComplete: false,
          cleanupErrors: Object.freeze([]),
          physicalCompletion: pending
        })
      }
    }
    await expect(
      createHost({
        ...options(
          [],
          () =>
            new FailingHost({
              execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
            })
        ),
        plugins: [plugin('first', ['second']), plugin('second', ['first'])]
      } as never)
    ).rejects.toMatchObject({
      detail: {
        cleanupErrors: [],
        cleanupComplete: false,
        physicalCompletion: pending
      }
    })
  })
})
