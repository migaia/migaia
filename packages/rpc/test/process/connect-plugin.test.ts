import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { RpcPlatform } from '../../src/core/transport-constants.js'
import { createConnectProcessBinding } from '../../src/process/plugin/binding.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import { byteProcessPipeline } from '../../src/process/pipeline.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'

/** An external process stays outside the lifetime of this owned local socket. */
describe('process plugin connect binding', () => {
  it('[A2] installs through the borrowed connection and leaves the external target owned elsewhere', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Closing the session settles the local supervisor without touching a process handle. */
    let notifyClose: (() => void) | undefined
    const rawClose = vi.fn(async () => notifyClose?.())
    const raw: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose(listener) {
        notifyClose = () => listener()
        return () => {
          notifyClose = undefined
        }
      },
      close: rawClose
    }
    const dial = vi.fn(async () => raw)
    const plugin = createProcessPlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      host: host.plugin,
      endpointFactory: async () => fixture.served,
      report: () => undefined,
      deployment: {
        kind: 'connect',
        address: '/tmp/external-peer.sock',
        token: 'signed-token',
        dial,
        supervision: { scheduler: fixture.binding.scheduler },
        establish: async (_raw, options) => {
          expect(options.token).toBe('signed-token')
          expect(options.offer).toMatchObject({
            auth: 'signed-token',
            capabilities: ['ping@1', 'close@1']
          })
          return {
            ...fixture.channel,
            agreement: { ...fixture.channel.agreement, source: 'negotiated' as const }
          }
        }
      }
    })
    try {
      const [installed] = await host.use(plugin)
      const feature = installed.getFeature('f') as { request(params: unknown[]): Promise<unknown> }
      expect(await feature.request(['value'])).toBe('result')
      expect(dial).toHaveBeenCalledTimes(1)
    } finally {
      await host.dispose()
    }
    expect(rawClose).toHaveBeenCalledTimes(1)
  })
  it('[A2] gives each dial a new session and closes only the owned socket', async () => {
    const scheduler = createManualScheduler()
    const close = vi.fn(async () => undefined)
    /** Each channel emits physical close only when its own close operation completes. */
    const readers: Array<(reason?: unknown) => void> = []
    const dial = vi.fn(async (): Promise<IProcessByteChannel> => ({
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose(listener) {
        readers.push(listener)
        return () => undefined
      },
      async close() {
        await close()
        readers.at(-1)?.()
      }
    }))
    const sessions: string[] = []
    const binding = createConnectProcessBinding(
      {
        kind: 'connect',
        address: '/tmp/external-peer.sock',
        token: 'connection-token',
        dial,
        supervision: { scheduler, restart: { maxRestarts: 0 } },
        establish: async (_raw, options) => {
          sessions.push(options.session.sessionId)
          expect(options.token).toBe('connection-token')
          expect(options.scheduler).toBe(scheduler)
          const channel: IRemoteChannel = {
            transport: {
              platform: RpcPlatform.process,
              send: () => undefined,
              subscribe: () => () => undefined
            },
            peerId: 'external',
            scheduler,
            agreement: { source: 'negotiated', codec: 'json', capabilities: [] },
            pipeline: byteProcessPipeline,
            features: [],
            close: async () => undefined
          }
          return channel
        }
      },
      () => undefined
    )
    const first = await binding.supervisor.start()
    expect(first.state).toBe('ready')
    if (first.state !== 'ready') return
    await binding.openChannel(first.unit, new AbortController().signal)
    expect(sessions[0]).toBe(first.unit.identity.fingerprint)
    await binding.supervisor.stop()
    expect(close).toHaveBeenCalledTimes(1)
    const second = await binding.supervisor.start()
    expect(second.state).toBe('ready')
    if (second.state !== 'ready') return
    await binding.openChannel(second.unit, new AbortController().signal)
    expect(sessions[1]).toBe(second.unit.identity.fingerprint)
    expect(sessions[1]).not.toBe(sessions[0])
    expect(dial).toHaveBeenCalledTimes(2)
    await binding.supervisor.dispose()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('[A2] rejects a missing token before dialing', () => {
    const dial = vi.fn(async () => {
      throw new Error('unreachable')
    })
    expect(() =>
      createConnectProcessBinding(
        {
          kind: 'connect',
          address: '/tmp/external-peer.sock',
          token: '',
          dial,
          establish: async () => {
            throw new Error('unreachable')
          }
        },
        () => undefined
      )
    ).toThrowError(
      expect.objectContaining({
        code: RpcProcessErrorCode.pluginInvalidOption,
        detail: { field: 'deployment.token' }
      })
    )
    expect(dial).not.toHaveBeenCalled()
  })

  it('[A6] closes a borrowed socket when its adapter rejects authentication', async () => {
    const denied = new Error('peer rejected authentication')
    const close = vi.fn(async () => undefined)
    const raw: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close
    }
    const binding = createConnectProcessBinding(
      {
        kind: 'connect',
        address: '/tmp/external-peer.sock',
        token: 'wrong-token',
        dial: async () => raw,
        supervision: { scheduler: createManualScheduler() },
        establish: async () => {
          throw denied
        }
      },
      () => undefined
    )
    const ready = await binding.supervisor.start()
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    await expect(binding.openChannel(ready.unit, new AbortController().signal)).rejects.toBe(denied)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
