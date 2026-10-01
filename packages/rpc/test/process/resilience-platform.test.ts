import { fileURLToPath } from 'node:url'
import { PluginHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createRemotePlugin } from '../../src/remote/plugin.js'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import type { IProcessHandle } from '@migaia/supervision/process'
import { createUnitBudget } from '@migaia/supervision'
import { describe, expect, it, vi } from 'vitest'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createControlFeature } from '../../src/core/features/control.js'
import { createDiscoveryFeature } from '../../src/core/features/discovery.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { createStreamFeature } from '../../src/core/features/stream.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { connect } from '../../src/core/middleware/connect.js'
import { framer } from '../../src/core/middleware/framer.js'
import { ping } from '../../src/core/middleware/ping.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IRemoteContract } from '../../src/remote/contract.js'

/** Request and generator exercise both core provider routes on a real pipe. */
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: false },
        generator: { mode: 'generator', idempotent: false }
      }
    }
  }
}

/** Composes a single stream owner beside the channel's IPC features. */
function streamRoots() {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const discovery = createDiscoveryFeature(outbound)
  const control = createControlFeature(outbound, discovery)
  const provider = createProviderFeature(outbound)
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-discovery': discovery,
    'first-party-control': control,
    'first-party-provider': provider,
    'first-party-stream': createStreamFeature(outbound, provider)
  }
}

/** Flush the bounded supervisor and remote continuations after each manual deadline. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 32; turn += 1) await Promise.resolve()
}

describe('process resilience platform health', () => {
  it('[A5] restarts real busy-loop children through native RPC ping in later generations', async () => {
    const scheduler = createManualScheduler()
    const handles: IProcessHandle[] = []
    const exits: unknown[] = []
    const reports: unknown[] = []
    const token = 'health-fixture-secret'
    const launcher = createNodeProcessLauncher()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let entered: () => void = () => undefined
    const binding = createSpawnProcessBinding(
      {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token,
        offer: createNativeProcessOffer({
          peer: { id: 'parent', runtime: 'node' },
          auth: token,
          stream: true
        }),
        supervision: {
          id: 'busy-health',
          scheduler,
          spec: {
            command: process.execPath,
            args: [fileURLToPath(new URL('./fixtures/health-busy-child.mjs', import.meta.url))],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          launcher: {
            capabilities: launcher.capabilities,
            launch: async (spec, context) => {
              const handle = await launcher.launch(spec, context)
              handles.push(handle)
              return handle
            }
          },
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
          isolation: 'best-effort',
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 },
          output: {
            onChunk: (_stream, chunk) => {
              if (new TextDecoder().decode(chunk).includes('busy-loop-entered')) entered()
            }
          },
          report: (error) => reports.push(error)
        },
        rawChannel: async (handle) => handle.channel!,
        establish: (raw, context) => {
          if (raw.kind !== 'byte') throw new TypeError('fixture expects native bytes')
          return createProcessTransport(raw, {
            role: 'initiator',
            offer: context.offer!,
            peerId: 'child',
            scheduler,
            signal: context.signal as AbortSignal,
            ipc: { ...context.session, log: () => undefined },
            report: (error) => reports.push(error)
          })
        }
      },
      (error) => reports.push(error)
    )
    const unsubscribe = binding.supervisor.subscribe((event) => {
      if (event.type === 'exit') exits.push(event)
    })
    const definition = createRemotePlugin({
      name: 'p',
      contract,
      host: host.plugin,
      binding,
      report: (error) => reports.push(error),
      endpointFactory: async (channel) => {
        const endpoint = await createComposedEndpoint(
          {
            id: 'parent',
            scheduler,
            transport: channel.transport,
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              abort(),
              connect({ transport: channel.transport }),
              ping()
            ]
          },
          {
            ...streamRoots(),
            'channel-ipc-log': channel.features[0]!,
            'channel-ipc-gate': channel.features[1]!
          }
        )
        return binding.bindEndpoint(channel, {
          endpoint: endpoint as unknown as IRpcEndpoint,
          stream: endpoint.stream
        })
      }
    })
    try {
      const [installed] = await host.use(definition)
      const feature = installed.getFeature('f') as { request(params: unknown[]): Promise<unknown> }
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const current = handles[cycle]!
        expect(await feature.request(['healthy'])).toBe('child:healthy')
        const hanging = new Promise<void>((resolve) => {
          entered = resolve
        })
        process.kill(current.identity.pid!, 'SIGUSR2')
        await hanging
        const origin = scheduler.now()
        for (let check = 0; check < 3; check += 1) {
          scheduler.advance(origin + (check + 1) * 5_000 - scheduler.now())
          await settle()
          expect(exits).toHaveLength(cycle)
          scheduler.advance(2_000)
          await settle()
        }
        await current.exited
        await vi.waitFor(() => expect(binding.supervisor.state).toBe('backoff'))
        expect(exits).toHaveLength(cycle + 1)
        scheduler.advance(1)
        const next = await binding.supervisor.whenReady()
        expect(next.state).toBe('ready')
        if (next.state !== 'ready') throw new Error('fixture replacement failed')
        expect(next.unit.identity.pid).not.toBe(current.identity.pid)
        await vi.waitFor(async () =>
          expect(await feature.request(['rebound'])).toBe('child:rebound')
        )
      }
      expect(handles).toHaveLength(3)
      expect(exits).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) }),
        expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) })
      ])
      expect(binding.health).toBe('ping')
      expect(await feature.request(['final'])).toBe('child:final')
      expect(JSON.stringify(reports)).not.toContain(token)
    } finally {
      unsubscribe()
      await host.dispose()
      await binding.supervisor.dispose()
      await Promise.allSettled(handles.map((handle) => handle.exited))
    }
  }, 30_000)
})
