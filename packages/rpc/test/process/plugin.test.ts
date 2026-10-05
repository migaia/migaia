import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, isDefinedPlugin } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { CapabilityLevel, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { RpcPlatform } from '../../src/core/transport-constants.js'
import { byteProcessPipeline } from '../../src/process/pipeline.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { ProcessPluginChannelKind, ProcessPluginWire } from '../../src/process/plugin/constants.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import type { IRemotePluginDefinition } from '../../src/remote/plugin.js'
import type {
  IProcessPluginEstablish,
  IProcessPluginOptions
} from '../../src/process/plugin/types.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'

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

/** The class's protected sync path is exposed only to this acceptance fixture. */
class SyncProbeHost extends PluginHost<Record<string, never>> {
  sync(plugin: IRemotePluginDefinition) {
    return this.useSync([plugin])
  }
}

/** S2 verifies binding handoff without substituting a second RPC implementation. */
describe('process plugin spawn binding', () => {
  it('[A1/A3] completes remote preparation before a dependent first calls its feature', async () => {
    const fixture = remoteHarness()
    const host = new SyncProbeHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const token = 'private-bootstrap-token'
    /** The caller's proposal must be the exact one handed to establish. */
    const offer = createNativeProcessOffer({
      peer: { id: 'client', runtime: 'node' },
      auth: token
    })
    const scheduler = fixture.binding.scheduler
    const spec = processSpec(token)
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    /** Termination settles the mock process exit so Host cleanup cannot hang. */
    let settleExit!: (value: { code: number | null; signal: string | null }) => void
    const handle: IProcessHandle = {
      identity: { fingerprint: 'installed-child' },
      exited: new Promise((resolve) => {
        settleExit = resolve
      }),
      terminate: () => settleExit({ code: 0, signal: null })
    }
    const raw: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    const launch = vi.fn(async () => handle)
    const keyFactory = vi.fn(() => 'process-logical-key')
    const retryPort = {
      dispatch: vi.fn(
        (input: Parameters<NonNullable<IProcessPluginOptions['retryPort']>['dispatch']>[0]) =>
          input.sendOnce({ expectedGeneration: input.generation, key: input.key })
      )
    }
    const establish = vi.fn(
      async (
        _raw: Parameters<IProcessPluginEstablish>[0],
        options: Parameters<IProcessPluginEstablish>[1]
      ) => {
        expect(options.token).toBe(token)
        expect(options.offer).toBe(offer)
        expect(options.session.processId).toBe('installed-child')
        return {
          ...fixture.channel,
          agreement: { ...fixture.channel.agreement, source: 'negotiated' as const }
        }
      }
    )
    const plugin = createProcessPlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      registrationOwner: { name: 'p', host },
      host: host.plugin,
      endpointFactory: async () => fixture.served,
      report: () => undefined,
      keyFactory,
      retryPort,
      deployment: {
        kind: 'spawn',
        channelKind: ProcessPluginChannelKind.byte,
        wire: ProcessPluginWire.native,
        token,
        offer,
        supervision: {
          id: 'client',
          spec,
          budget,
          scheduler,
          launcher: {
            capabilities: {
              termination: CapabilityLevel.enforced,
              'fault-isolation': CapabilityLevel.enforced,
              'bootstrap-stdin': CapabilityLevel.enforced
            },
            launch
          },
          health: { check: async () => undefined },
          report: () => undefined
        },
        rawChannel: async () => raw,
        establish
      }
    })
    /** Installation observes the Feature only after describe has completed. */
    let result: Promise<unknown> | undefined
    const dependent = definePlugin({
      name: 'dependent',
      features: {
        use: defineFeature(
          (_core, dependencies) => {
            result = (
              dependencies.remote as { request(params: unknown[]): Promise<unknown> }
            ).request(['value'])
            return {}
          },
          { remote: plugin.getFeature('f') }
        )
      },
      install: () => ({})
    })
    try {
      expect(isDefinedPlugin(plugin)).toBe(true)
      expect(() => host.sync(plugin)).toThrowError(
        expect.objectContaining({ code: 'SETUP_REQUIRES_ASYNC_INSTALL' })
      )
      expect(launch).not.toHaveBeenCalled()
      await host.use(plugin)
      await host.use(dependent)
      expect(await result).toBe('result')
      expect(launch).toHaveBeenCalledTimes(1)
      expect(establish).toHaveBeenCalledTimes(1)
      expect(keyFactory).toHaveBeenCalledTimes(1)
      expect(retryPort.dispatch).toHaveBeenCalledTimes(1)
      expect(fixture.sends[1]?.options).toMatchObject({ idempotencyKey: 'process-logical-key' })
      expect(fixture.sends[0]?.method).toBe('migaia.remote.runtime.describe')
      expect(fixture.sends[1]?.method).toBe('p.f.request')
    } finally {
      await host.dispose()
    }
  })
  it('[A1] forwards one session, scheduler, and post-subscription stderr to the channel adapter', async () => {
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

  it('[A3] rejects a mismatched bootstrap without launch or exposing token', () => {
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
        source: '@migaia/rpc/process',
        code: RpcProcessErrorCode.pluginInvalidOption,
        detail: { field: 'supervision.spec.bootstrap' }
      })
    )
    expect(launch).not.toHaveBeenCalled()
  })
})
