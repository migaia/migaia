import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../dist/process/adapters/node-child-process.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

/** The child uses the public automatic bootstrap path, just as the documented example does. */
const entry = fileURLToPath(new URL('./fixtures/outlet-command-child.mjs', import.meta.url))

describe('process outlet command readiness', () => {
  it.each(['restart', 'replace'] as const)(
    '[DX3-process] %s resolves only after the new generation can receive an immediate request',
    async (command) => {
      /** Preserve full original diagnostics, including the documented best-effort warning. */
      const reported: unknown[] = []
      /** Native errors stay visible to the assertions without replacement. */
      const report = (error: unknown): void => {
        reported.push(error)
      }
      /** This launcher retains the actual child resource and minted runtime identity. */
      const launcher = createNodeProcessLauncher()
      /** One unit bounds replacement to the existing stop-then-start policy. */
      const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: systemScheduler })
      /** Bootstrap token is fixture data and is never included in returned diagnostic metadata. */
      const token = 'dx-command-readiness-token'
      /** The actual public Host owns this original native launch and its member commands. */
      const host = await createRpcHost({
        report,
        plugins: [
          processPlugin({
            name: 'service',
            spawn: {
              kind: 'spawn',
              channelKind: 'byte',
              token,
              supervision: {
                id: 'dx-ready-child',
                isolation: 'best-effort',
                scheduler: systemScheduler,
                report,
                budget,
                launcher,
                spec: {
                  command: process.execPath,
                  args: [entry],
                  env: { inherit: ['PATH'], set: {} },
                  stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                  bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
                }
              },
              rawChannel: async (unit) => (unit as INodeProcessHandle).channel!
            },
            report
          })
        ]
      })
      try {
        /** A changed admitted identity independently proves replacement isolation. */
        const previous = await host.process.send('service', 'identity')
        /** No event wait or sleep occurs between native command completion and business routing. */
        const outcome = await host.process.members[command]('service')
        expect(outcome).toMatchObject(
          command === 'restart' ? { state: 'ready' } : { kind: 'replaced' }
        )
        expect(await host.process.send('service', 'math.double', 4)).toBe(8)
        expect(await host.process.send('service', 'identity')).not.toBe(previous)
        await expect(host.process.send(previous as string, 'identity')).rejects.toMatchObject({
          source: 'rpc.endpoint',
          code: 'TARGET_UNKNOWN'
        })
        /**
         * Best-effort admission warns once; normal native retirement also rejects stale
         * generation-1 preparation. No native IO failure occurred, so this diagnostic must not
         * invent a cause.
         */
        expect(reported).toEqual([
          expect.objectContaining({
            name: 'Error',
            message: 'supervision capability is unsupported',
            source: 'supervision',
            code: 'CAPABILITY_UNSUPPORTED',
            detail: { capability: 'termination', level: 'unsupported', kind: 'process' },
            stack: expect.stringMatching(/\S/)
          }),
          expect.objectContaining({
            name: 'Error',
            message: 'Remote generation is closed',
            source: 'rpc.remote',
            code: 'REMOTE_CLOSED',
            detail: { generation: 1 },
            stack: expect.stringMatching(/\S/)
          })
        ])
      } finally {
        await host.close()
      }
      expect(budget.inUse).toBe(0)
    }
  )
})
