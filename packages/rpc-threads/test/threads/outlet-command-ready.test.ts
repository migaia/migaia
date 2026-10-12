import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createThreadPlugin } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { runtimeTestHost } from '../../../rpc-core/test/runtime-api/public-host.js'
import type { IRuntimeDynamicSurface } from '@migaia/rpc-core/remote'

/** A real Worker uses only public factories and exposes its own admitted instance identity. */
const entry = fileURLToPath(new URL('./fixtures/outlet-command-worker.mjs', import.meta.url))

describe('thread outlet command readiness', () => {
  it.each(['restart', 'replace'] as const)(
    '[DX3-thread] %s resolves only after the new generation can receive an immediate request',
    async (command) => {
      /** Host owns every generation; no event wait or retry hides publication ordering. */
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      /** Keep native diagnostics observable without changing their objects. */
      const reported: unknown[] = []
      /** Native channel and supervisor share the same scheduler. */
      const report = (error: unknown): void => {
        reported.push(error)
      }
      /** One unit suffices for the default stop-then-start replacement. */
      const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler: systemScheduler })
      try {
        await host.use(
          createThreadPlugin<IRuntimeDynamicSurface>({
            name: 'worker',
            spawn: {
              spec: { entry },
              launcher: createNodeThreadLauncher(),
              channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
              budget,
              scheduler: systemScheduler,
              report
            },
            report
          })
        )
        /** The first identity proves subsequent success belongs to the replacement generation. */
        const previous = await host.thread!.request('worker', 'identity')
        /** Await only the public command; the next operation must already be routable. */
        const outcome = await host.thread![command]('worker')
        expect(outcome).toMatchObject(
          command === 'restart' ? { state: 'ready' } : { kind: 'replaced' }
        )
        expect(await host.thread!.request('worker', 'math.double', 4)).toBe(8)
        expect(await host.thread!.request('worker', 'identity')).not.toBe(previous)
        expect(() =>
          host.thread!.request({ name: 'worker', instanceId: previous as string }, 'identity')
        ).toThrow(expect.objectContaining({ source: '@migaia/rpc/core', code: 'TARGET_UNKNOWN' }))
        /**
         * Native retirement closes generation 1 before its supervisor leaves ready. The existing
         * observer reports that rejected stale preparation with the original transport cause.
         */
        expect(reported).toEqual([
          expect.objectContaining({
            name: 'Error',
            message: 'Remote generation is closed',
            source: '@migaia/rpc/remote',
            code: 'REMOTE_CLOSED',
            detail: { generation: 1 },
            stack: expect.stringMatching(/\S/),
            cause: expect.objectContaining({
              name: 'Error',
              message: '[rpc] message port closed',
              source: '@migaia/rpc/core',
              code: 'TRANSPORT',
              stack: expect.stringMatching(/\S/)
            })
          })
        ])
      } finally {
        await host.dispose()
      }
      expect(budget.inUse).toBe(0)
    }
  )
})
