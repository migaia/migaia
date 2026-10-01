import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { CapabilityLevel, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { RpcPlatform } from '../../src/core/transport-constants.js'
import { byteProcessPipeline } from '../../src/process/pipeline.js'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import { ProcessPluginChannelKind, ProcessPluginWire } from '../../src/process/plugin/constants.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import type { IRemoteChannel } from '../../src/remote/types.js'

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

/** S2 verifies binding handoff without substituting a second RPC implementation. */
describe('process plugin spawn binding', () => {
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
