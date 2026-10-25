/** Retain native launch failure and invocation obligations after retiring JSON-RPC-only framing. */
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, type ISpawnProcessPluginDeployment } from '@migaia/rpc-plugin-process'
import { expect, it, vi } from 'vitest'
import { createNodeProcessLauncher } from '../../dist/process/adapters/node-child-process.js'
import { createUnitBudget } from '@migaia/supervision'

it('retains public start failure and one actual launcher call before channel acquisition', async () => {
  /** The original sentinel ends native launch before any OS child or raw channel is acquired. */
  const launchFailure = new Error('fixture launch boundary reached')
  /** The unchanged native launcher supplies truthful platform capability facts. */
  const native = createNodeProcessLauncher()
  /** Only this actual launcher invocation can reach the original failure boundary. */
  const launch = vi.fn(async () => {
    throw launchFailure
  })
  /** Existing diagnostics remain observable while original supervision rejects startup. */
  const reports: unknown[] = []
  /** Native source policy uses the original specification and its one launch budget. */
  const spawn: ISpawnProcessPluginDeployment = {
    kind: 'spawn',
    channelKind: 'byte',
    token: 'native-stdin-fixture',
    supervision: {
      id: 'native-stdin',
      isolation: 'best-effort',
      restart: { mode: 'never' },
      budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
      report: (error) => {
        reports.push(error)
      },
      launcher: { ...native, launch },
      spec: {
        command: 'python3',
        args: ['service.py'],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode('native-stdin-fixture') }
      }
    },
    rawChannel: async () => {
      throw launchFailure
    }
  }
  await expect(
    createRpcHost({
      self: { name: 'native-parent', instanceId: 'native-parent-1' },
      report: (error) => {
        reports.push(error)
      },
      plugins: [processPlugin({ spawn })]
    })
  ).rejects.toMatchObject({ code: 'REMOTE_START_FAILED' })
  expect(launch).toHaveBeenCalledTimes(1)
})
