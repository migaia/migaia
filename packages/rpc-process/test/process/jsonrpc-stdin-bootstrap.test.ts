import { describe, expect, it, vi } from 'vitest'
import {
  createAdapterProcessLaunch,
  createProcessPeer,
  parseProcessPluginDescriptor,
  type IRuntimeProcessPeerOptions
} from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'

/** Fixture token remains runtime bootstrap bytes, never a persisted descriptor field. */
const token = 'jsonrpc-stdin-fixture'

/** The descriptor's public parser must admit the same stdin carrier as live supervision. */
const descriptor = {
  descriptorVersion: 1,
  name: 'python-service',
  runtime: 'python',
  contract: {
    schemaVersion: 1,
    plugin: 'python-service',
    features: { service: { methods: { echo: { mode: 'request', idempotent: false } } } }
  },
  deployment: {
    kind: 'spawn',
    channelKind: 'byte',
    wire: 'jsonrpc',
    budget: { maxUnits: 1 },
    spec: {
      command: 'python3',
      args: ['service.py'],
      env: { inherit: ['PATH'] },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin' }
    }
  }
}

describe('JSON-RPC supervised stdin bootstrap', () => {
  it('[DX6b] admits a stdin bootstrap through the public descriptor parser', () => {
    expect(parseProcessPluginDescriptor(descriptor)).toMatchObject(descriptor)
  })

  it('[DX6b] passes the raw token bootstrap to a supervised JSON-RPC launcher', async () => {
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
    await expect(createProcessPeer(options)).rejects.toMatchObject({ code: 'REMOTE_START_FAILED' })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(bootstrap).toBeUndefined()
  })
})
