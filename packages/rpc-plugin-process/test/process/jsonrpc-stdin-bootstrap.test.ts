import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { describe, expect, it, vi } from 'vitest'
import { createAdapterProcessLaunch } from '../../dist/process/launch.js'
import { type IRuntimeProcessPeerOptions } from '../../dist/process/runtime-peer.js'
import { createNodeProcessLauncher } from '../../dist/process/adapters/node-child-process.js'
import { createUnitBudget } from '@migaia/supervision'

/** Fixture token remains runtime bootstrap bytes, never a persisted descriptor field. */
const token = 'jsonrpc-stdin-fixture'

describe('JSON-RPC supervised stdin bootstrap', () => {
  it('passes the raw token bootstrap to a supervised JSON-RPC launcher', async () => {
    /** One sentinel launch failure stops before channel assembly without creating an OS child. */
    const launchFailure = new Error('fixture launch boundary reached')
    /** The native preparation reveals whether the public source injected a TS-only bootstrap. */
    let bootstrap: ReturnType<typeof createAdapterProcessLaunch>['bootstrap'] = undefined
    /** Public launcher capabilities are reused without asserting any channel trust. */
    const native = createNodeProcessLauncher()
    /** The public source must invoke this exact launcher with the unchanged token bytes. */
    const launch = vi.fn(
      async (
        spec: Parameters<typeof native.launch>[0],
        context: Parameters<typeof native.launch>[1]
      ) => {
        bootstrap = createAdapterProcessLaunch(spec, context).bootstrap
        expect(spec.bootstrap?.payload).toEqual(new TextEncoder().encode(token))
        throw launchFailure
      }
    )
    /** Keep asynchronous supervision errors observable while failing at the launch boundary. */
    const reports: unknown[] = []
    /** Public configuration uses the same stdio bootstrap path as the standard Python responder. */
    const options: IRuntimeProcessPeerOptions = {
      self: { name: 'jsonrpc-parent', instanceId: 'jsonrpc-parent-1' },
      report: (error) => reports.push(error),
      spawn: {
        kind: 'spawn',
        wire: 'jsonrpc',
        channelKind: 'byte',
        token,
        supervision: {
          id: 'jsonrpc-stdin',
          isolation: 'best-effort',
          restart: { mode: 'never' },
          budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
          report: (error) => reports.push(error),
          launcher: { ...native, launch },
          spec: {
            command: 'python3',
            args: ['service.py'],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          }
        },
        rawChannel: async () => {
          throw launchFailure
        },
        establish: async () => {
          throw launchFailure
        }
      }
    }
    await expect(
      createRpcHost({
        self: options.self,
        report: options.report,
        plugins: [processPlugin({ spawn: options.spawn! })]
      })
    ).rejects.toMatchObject({ code: 'REMOTE_START_FAILED' })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(bootstrap).toBeUndefined()
  })
})
