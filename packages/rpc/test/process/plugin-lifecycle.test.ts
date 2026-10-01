import { PluginHost } from '@migaia/plugin-host'
import { CapabilityLevel, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { describe, expect, it, vi } from 'vitest'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'

/** Advance promise continuations without depending on wall-clock delays. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

/** One fake process exposes an original exit event and a separate termination port. */
function controlledProcess(fingerprint: string) {
  /** The test drives departure while the supervisor retains the same exit Promise. */
  let finish!: (status: { code: number | null; signal: string | null }) => void
  const handle: IProcessHandle = {
    identity: { fingerprint },
    exited: new Promise((resolve) => {
      finish = resolve
    }),
    terminate: () => finish({ code: 0, signal: null })
  }
  return { handle, finish }
}

describe('process plugin generation lifetime', () => {
  it('[A5] revokes on child exit and rebinds the same feature after a new describe', async () => {
    const fixture = remoteHarness()
    const scheduler = fixture.binding.scheduler
    const token = 'generation-token'
    const spec: IProcessSpec = {
      command: 'memory-child',
      args: [],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
    }
    const children = [controlledProcess('generation-1'), controlledProcess('generation-2')]
    /** A fresh unit is launched only after the previous unit's exit and backoff. */
    let nextChild = 0
    const launch = vi.fn(async () => children[nextChild++]!.handle)
    const raw: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const disable = vi.fn((name: string, options: { readonly policy: 'suspend' }) =>
      host.plugin.disable(name, options)
    )
    const enable = vi.fn((name: string) => host.plugin.enable(name))
    const plugin = createProcessPlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      host: { disable, enable },
      endpointFactory: async () => fixture.served,
      report: () => undefined,
      deployment: {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token,
        supervision: {
          id: 'generations',
          spec,
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
          scheduler,
          launcher: {
            capabilities: {
              termination: CapabilityLevel.enforced,
              'fault-isolation': CapabilityLevel.enforced,
              'bootstrap-stdin': CapabilityLevel.enforced
            },
            launch
          },
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 },
          report: () => undefined
        },
        rawChannel: async () => raw,
        establish: async () => ({
          ...fixture.channel,
          agreement: { ...fixture.channel.agreement, source: 'negotiated' as const }
        })
      }
    })
    try {
      const [installed] = await host.use(plugin)
      const feature = installed.getFeature('f') as { request(params: unknown[]): Promise<unknown> }
      expect(await feature.request(['first'])).toBe('result')
      children[0]!.finish({ code: 1, signal: null })
      await settle()
      await expect(feature.request(['during-exit'])).rejects.toMatchObject({
        code: 'REMOTE_CLOSED'
      })
      expect(disable).toHaveBeenCalledTimes(1)
      scheduler.advance(1)
      await settle()
      expect(launch).toHaveBeenCalledTimes(2)
      expect(enable).toHaveBeenCalledTimes(1)
      expect(await feature.request(['second'])).toBe('result')
      expect(fixture.sends.filter((send) => send.method === 'migaia.remote.describe')).toHaveLength(
        2
      )
    } finally {
      await host.dispose()
    }
  })
})
