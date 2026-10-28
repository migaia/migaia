import { describe, expect, it } from 'vitest'
import { type IPluginHostCore } from '@migaia/plugin-host'
import { createHost } from '../src/host/index.ts'
import {
  AsyncRuntimeHost,
  hostOptions,
  type IRuntimeCase,
  runHostMutationRace
} from './executable-closure-helper.ts'

const runtimeCases: readonly IRuntimeCase[] = [
  {
    id: 'defers removal cleanup until running stages drain and settles mutation races',
    run: async () => {
      let releaseStage!: () => void
      let started!: () => void
      const stageStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      const stageGate = new Promise<void>((resolve) => {
        releaseStage = resolve
      })
      let disposed = false
      let raw: AsyncRuntimeHost | undefined
      const host = await createHost({
        ...hostOptions(),
        quiescenceMs: 0,
        create: () => {
          raw = new AsyncRuntimeHost({
            pipeline: { mode: 'async' },
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
          })
          return raw
        },
        plugins: [
          {
            name: 'staged',
            install: (core: IPluginHostCore<string>) => {
              core.useAsyncPipeline(
                async (value: string, next: (value: string) => Promise<void>) => {
                  started()
                  await stageGate
                  await next(value)
                }
              )
              core.onDispose(() => {
                disposed = true
              })
              return {}
            }
          }
        ] as never
      })
      const running = raw!.runValue('value')
      await stageStarted
      const removal = await host.unUse('staged')
      expect(removal.cleanupComplete).toBe(false)
      expect(removal.cleanupErrors).toEqual([])
      expect(removal.physicalCompletion).toBeDefined()
      expect(disposed).toBe(false)
      releaseStage()
      await running
      await removal.physicalCompletion
      expect(disposed).toBe(true)
      await host.dispose()

      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason)
      }
      const processEvents = (
        globalThis as typeof globalThis & {
          readonly process: {
            on: (event: string, listener: (reason: unknown) => void) => void
            off: (event: string, listener: (reason: unknown) => void) => void
          }
        }
      ).process
      processEvents.on('unhandledRejection', onUnhandled)

      try {
        await runHostMutationRace(
          (raceHost, _raw, tracked) => [
            { label: 'use:left', run: () => raceHost.use(tracked('left') as never) },
            { label: 'use:right', run: () => raceHost.use(tracked('right') as never) },
            { label: 'duplicate:left', run: () => raceHost.use(tracked('left') as never) }
          ],
          ['seed'],
          false,
          'terminal',
          ['seed', 'left', 'right'],
          [2, 2]
        )
        await runHostMutationRace(
          (raceHost, _raw, tracked) => [
            { label: 'use:added', run: () => raceHost.use(tracked('added') as never) },
            { label: 'replace:seed', run: () => raceHost.replace(tracked('seed') as never) }
          ],
          ['seed'],
          false,
          'terminal',
          ['seed', 'added'],
          [3, 3]
        )
        await runHostMutationRace(
          (raceHost, _raw) => [
            { label: 'unUse:seed', run: () => raceHost.unUse('seed') },
            { label: 'dispose:managed', run: () => raceHost.dispose() }
          ],
          ['seed'],
          true
        )
        await runHostMutationRace(
          (raceHost, _raw, tracked) => [
            { label: 'replace:seed', run: () => raceHost.replace(tracked('seed') as never) },
            { label: 'dispose:managed', run: () => raceHost.dispose() }
          ],
          ['seed'],
          true,
          'failed'
        )
        await runHostMutationRace(
          (raceHost, raw, tracked) => [
            { label: 'use:added', run: () => raceHost.use(tracked('added') as never) },
            { label: 'dispose:raw', run: () => raw.dispose() }
          ],
          ['seed'],
          true,
          'failed'
        )
      } finally {
        processEvents.off('unhandledRejection', onUnhandled)
      }
      expect(unhandled).toEqual([])
    }
  }
]

describe('executable Tray Host and Graph acceptance oracles', () => {
  it.each(runtimeCases)('$id', async ({ run }) => {
    await run()
  })
})
