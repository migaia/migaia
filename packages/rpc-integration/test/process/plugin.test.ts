import { describe, expect, it, vi } from 'vitest'
import { definePlugin, PluginHost, isDefinedPlugin } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/testing'
import { CapabilityLevel, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { RpcPlatform } from '@migaia/rpc-host/plugin'
import { byteProcessPipeline } from '../fixtures/process-diagnostics.js'
import { createSpawnProcessBinding } from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { nativeHostFixture } from './fixtures/host-native.js'
import type { IRuntimeOutlet } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { ProcessPluginChannelKind } from '../../../rpc-plugin-process/dist/process/plugin/constants.js'
import { ProcessPluginWire } from '../../../rpc-plugin-process/dist/process/plugin/constants.js'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'
import type { IProcessPluginEstablish } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IProcessPluginOptions } from '../../../rpc-plugin-process/dist/process/plugin.js'

/** A valid spec is shared by the supervisor and the optional caller-owned pool. */
function processSpec(token: string): IProcessSpec {
  return {
    command: 'memory-child',
    args: [],
    env: { inherit: [], set: {} },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
    bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
  }
}

/** The process profile can expose one unit without starting a real child. */
function processHandle(): IProcessHandle {
  return {
    identity: { fingerprint: 'child-1', pid: 123 },
    exited: new Promise(() => undefined),
    terminate: vi.fn()
  }
}

/** Verifies binding handoff without substituting a second RPC implementation. */
describe('process plugin spawn binding', () => {
  it('completes remote preparation before a dependent first calls its feature', async () => {
    /** Real native preparation preserves launch, retry and directory boundaries of the old fixture. */
    const fixture = nativeHostFixture('result', 1)
    /** The ordinary Host owns asynchronous native transport installation. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** The original offered object must reach the real native establisher by identity. */
    const offer = fixture.options.spawn.offer
    /** Count actual OS acquisition rather than a fabricated ready unit. */
    const launch = vi.fn(fixture.options.spawn.supervision.launcher.launch)
    /** Public retry and key policy remain attached to this exact native registration. */
    const keyFactory = vi.fn(() => 'process-logical-key')
    /** The original retry seam dispatches each business operation once. */
    const retryPort = {
      dispatch: vi.fn(
        (input: Parameters<NonNullable<IProcessPluginOptions['retryPort']>['dispatch']>[0]) =>
          input.sendOnce({ expectedGeneration: input.generation, key: input.key })
      )
    }
    /** Retain every exact send input while production owns serialization and physical writes. */
    const sends: { method: string; options: unknown }[] = []
    fixture.observeEndpoint((served) => ({
      ...served,
      endpoint: Object.create(
        served.endpoint,
        Object.getOwnPropertyDescriptors({
          send<T>(...input: Parameters<typeof served.endpoint.send>) {
            sends.push({ method: input[1], options: input[3] })
            return served.endpoint.send<T>(...input)
          }
        })
      )
    }))
    /** The genuine channel and session are returned unchanged after checking native handoff. */
    const establish = vi.fn((...input: Parameters<IProcessPluginEstablish>) => {
      const [raw, options] = input
      expect(options.token).toBe(fixture.options.spawn.token)
      expect(options.offer).toBe(offer)
      expect(options.session.processId).toBe(fixture.handles[0]!.identity.fingerprint)
      return fixture.options.spawn.establish(raw, options)
    })
    /** Only the transport source grammar changes; the ordinary Host owns installation. */
    const plugin = processPlugin({
      ...fixture.options,
      name: 'p',
      keyFactory,
      retryPort,
      spawn: {
        ...fixture.options.spawn,
        establish,
        supervision: {
          ...fixture.options.spawn.supervision,
          launcher: {
            ...fixture.options.spawn.supervision.launcher,
            launch
          }
        }
      }
    })
    /**
     * The dependent's first operation follows native installation, without the removed Feature
     * proxy.
     */
    let result: Promise<unknown> | undefined
    /** Native transport publication completes before a later ordinary plugin can call its outlet. */
    const dependent = definePlugin({
      name: 'dependent',
      install: () => {
        result = (
          host as PluginHost<Record<string, never>> & { process: IRuntimeOutlet }
        ).process.request('p', 'p.f.request', ['value'])
        return {}
      }
    })
    try {
      expect(isDefinedPlugin(plugin)).toBe(true)
      expect(launch).not.toHaveBeenCalled()
      await host.use(plugin)
      await fixture.ready()
      await host.use(dependent)
      expect(await result).toEqual({
        pid: fixture.handles[0]!.identity.pid,
        value: 'result',
        input: ['value'],
        calls: 1,
        disposals: 0
      })
      expect(launch).toHaveBeenCalledTimes(1)
      expect(establish).toHaveBeenCalledTimes(1)
      expect(keyFactory).toHaveBeenCalledTimes(1)
      expect(retryPort.dispatch).toHaveBeenCalledTimes(1)
      expect(sends[1]?.options).toMatchObject({ idempotencyKey: 'process-logical-key' })
      expect(sends[0]?.method).toBe('migaia.remote.runtime.describe')
      expect(sends[1]?.method).toBe('p.f.request')
    } finally {
      await host.dispose()
      await fixture.close()
    }
  })
  it('forwards one session, scheduler, and post-subscription stderr to the channel adapter', async () => {
    const token = 'only-private-bootstrap'
    const scheduler = createManualScheduler()
    const spec = processSpec(token)
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const handle = processHandle()
    const output = vi.fn()
    /** The launch callback captures the true supervision output hook. */
    let emitOutput: ((stream: 'stdout' | 'stderr', chunk: Uint8Array) => void) | undefined
    const raw: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    const received: { sessionId?: string; processId?: string; scheduler?: unknown } = {}
    const logged: Uint8Array[] = []
    const binding = createSpawnProcessBinding(
      {
        kind: 'spawn',
        channelKind: ProcessPluginChannelKind.byte,
        wire: ProcessPluginWire.native,
        token,
        supervision: {
          id: 'spawn-binding',
          spec,
          budget,
          scheduler,
          launcher: {
            capabilities: {
              termination: CapabilityLevel.enforced,
              'fault-isolation': CapabilityLevel.enforced,
              'bootstrap-stdin': CapabilityLevel.enforced
            },
            launch: async (_spec, context) => {
              emitOutput = context.output
              return handle
            }
          },
          output: { onChunk: output },
          report: () => undefined
        },
        rawChannel: async (unit) => {
          expect(unit).toBe(handle)
          return raw
        },
        establish: async (_raw, options) => {
          received.sessionId = options.session.sessionId
          received.processId = options.session.processId
          received.scheduler = options.scheduler
          options.stderr?.((chunk) => logged.push(chunk))
          const channel: IRemoteChannel = {
            transport: {
              platform: RpcPlatform.process,
              send: () => undefined,
              subscribe: () => () => undefined
            },
            peerId: 'child',
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
    const ready = await binding.supervisor.start()
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    emitOutput?.('stderr', new TextEncoder().encode('before-subscribe'))
    const channel = await binding.openChannel(ready.unit, new AbortController().signal)
    expect(channel.scheduler).toBe(scheduler)
    expect(received.scheduler).toBe(scheduler)
    expect(received.sessionId).toBeTruthy()
    expect(received.processId).toBe('child-1')
    emitOutput?.('stdout', new TextEncoder().encode('not-stderr'))
    emitOutput?.('stderr', new TextEncoder().encode('after-subscribe'))
    expect(output).toHaveBeenCalledTimes(3)
    expect(logged.map((chunk) => new TextDecoder().decode(chunk))).toEqual(['after-subscribe'])
  })

  it('rejects a mismatched bootstrap without launch or exposing token', () => {
    const token = 'secret-do-not-report'
    const scheduler = createManualScheduler()
    const spec = processSpec('wrong-secret')
    const launch = vi.fn(async () => processHandle())
    expect(() =>
      createSpawnProcessBinding(
        {
          kind: 'spawn',
          channelKind: ProcessPluginChannelKind.byte,
          wire: ProcessPluginWire.native,
          token,
          supervision: {
            id: 'invalid-spawn',
            spec,
            budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
            scheduler,
            launcher: { capabilities: {}, launch },
            report: () => undefined
          },
          rawChannel: async () => {
            throw new Error('unreachable')
          },
          establish: async () => {
            throw new Error('unreachable')
          }
        },
        () => undefined
      )
    ).toThrowError(
      expect.objectContaining({
        source: 'rpc.transport.process',
        code: RpcProcessErrorCode.pluginInvalidOption,
        detail: { field: 'supervision.spec.bootstrap' }
      })
    )
    expect(launch).not.toHaveBeenCalled()
  })
})
