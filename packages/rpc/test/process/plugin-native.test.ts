import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
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
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IRemoteServeEndpoint } from '../../src/remote/types.js'

/** A child fixture imports the built process-plugin implementation without Vitest IPC. */
const childFixture = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/node-process-plugin-child.mjs'
)

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

describe('native process plugin', () => {
  it('[A1/A8/A9] serves and replaces a real Node child over native stdio', async () => {
    const token = 'native-process-plugin-token'
    const launcher = createNodeProcessLauncher()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** A real process consumes exactly one unit of the caller-owned budget. */
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
    /** Replacement keeps bootstrap secret while changing only the child behavior. */
    const spec = {
      command: process.execPath,
      args: [childFixture],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
    } as const
    /** The first dependency call must see an installed, verified remote feature. */
    let firstCall: Promise<unknown> | undefined
    const plugin = createProcessPlugin({
      name: 'p',
      contract,
      registrationOwner: { name: 'p', host },
      host: host.plugin,
      report: () => undefined,
      deployment: {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token,
        supervision: {
          id: 'native-child',
          spec,
          launcher,
          budget,
          isolation: 'best-effort',
          report: () => undefined
        },
        rawChannel: async (handle) => handle.channel!,
        establish: (raw, options) => {
          if (raw.kind !== 'byte') throw new TypeError('expected byte channel')
          if (options.role !== 'initiator') throw new TypeError('expected initiator')
          return createProcessTransport(raw, {
            role: options.role,
            offer: createNativeProcessOffer({
              peer: { id: 'parent', runtime: 'node' },
              auth: options.token,
              stream: true
            }),
            peerId: 'child',
            scheduler: options.scheduler,
            ipc: { ...options.session, log: () => undefined },
            report: () => undefined
          })
        }
      },
      endpointFactory: async (channel): Promise<IRemoteServeEndpoint> => {
        const endpoint = await createComposedEndpoint(
          {
            id: 'parent',
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
        return { endpoint: endpoint as unknown as IRpcEndpoint, stream: endpoint.stream }
      }
    })
    const dependent = definePlugin({
      name: 'dependent',
      features: {
        use: defineFeature(
          (_core, dependencies) => {
            firstCall = (
              dependencies.remote as { request(params: unknown[]): Promise<unknown> }
            ).request(['ready'])
            return {}
          },
          { remote: plugin.getFeature('f') }
        )
      },
      install: () => ({})
    })
    try {
      const [pluginHandle] = await host.use(plugin)
      await host.use(dependent)
      expect(await firstCall).toBe('child:ready')
      const feature = pluginHandle!.getFeature('f') as {
        request(params: unknown[]): Promise<unknown>
        generator(params: unknown[]): AsyncIterableIterator<unknown>
      }
      expect(await feature.request(['value'])).toBe('child:value')
      const iterator = feature.generator(['stream'])
      expect(await iterator.next()).toEqual({ done: false, value: 'stream:1' })
      expect(await iterator.next()).toEqual({ done: false, value: 'stream:2' })
      expect(await iterator.next()).toMatchObject({ done: true })
      const replacement = await plugin.replace({
        spec: { ...spec, env: { inherit: [], set: { RPC_VALUE: 'new-child' } } }
      })
      expect(replacement).toMatchObject({
        strategy: 'stop-then-start',
        outcome: { kind: 'replaced', generation: 2 }
      })
      await vi.waitFor(async () => {
        expect(await feature.request(['again'])).toBe('new-child:again')
      })
    } finally {
      await host.dispose()
    }
  })
})
