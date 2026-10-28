import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../dist/threads/node-launcher.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import type { INativeFixtureHost } from './fixture.ts'

/** A real Worker uses only public factories and exposes its own admitted instance identity. */
const entry = fileURLToPath(new URL('./fixtures/outlet-command-worker.mjs', import.meta.url))

describe('thread outlet command readiness', () => {
  it.each(['restart', 'replace'] as const)(
    '[DX3-thread] %s resolves only after the new generation can receive an immediate request',
    async (command) => {
      /** Host owns every generation; no event wait or retry hides publication ordering. */
      /** Lazy pipeline authority reads this case's own native host only at installation. */
      const rpc = rpcHostPipelines(
        () => host,
        (name, request) => host.pipeline(name, request)
      )
      const host = defineHost({
        ...rpc,
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      }) as INativeFixtureHost
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
          threadPlugin({
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
        const previous = await host.thread!.send('worker', 'identity')
        /** Await only the public command; the next operation must already be routable. */
        const outcome = await host.thread!.members[command]('worker')
        expect(outcome).toMatchObject(
          command === 'restart' ? { state: 'ready' } : { kind: 'replaced' }
        )
        expect(await host.thread!.send('worker', 'math.double', 4)).toBe(8)
        expect(await host.thread!.send('worker', 'identity')).not.toBe(previous)
        await expect(host.thread!.send(previous as string, 'identity')).rejects.toMatchObject({
          source: 'rpc.endpoint',
          code: 'TARGET_UNKNOWN'
        })
        /**
         * Native retirement closes generation 1 before its supervisor leaves ready. The existing
         * observer reports that rejected stale preparation without inventing a native cause.
         */
        expect(reported).toEqual([
          expect.objectContaining({
            name: 'Error',
            message: 'Remote generation is closed',
            source: 'rpc.remote',
            code: 'REMOTE_CLOSED',
            detail: { generation: 1 },
            stack: expect.stringMatching(/\S/)
          })
        ])
        /** Preserves absence when intentional native retirement has no original error. */
        expect((reported[0] as Error).cause).toBeUndefined()
      } finally {
        await host.dispose()
      }
      expect(budget.inUse).toBe(0)
    }
  )
})
