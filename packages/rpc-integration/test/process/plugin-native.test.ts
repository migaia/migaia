import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createControlFeature } from '@migaia/rpc-core/features/control'
import { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { createStreamFeature } from '@migaia/rpc-core/stream'
import type { IRpcEndpoint } from '@migaia/rpc-core'
import { abort } from '@migaia/rpc-core'
import { codec } from '@migaia/rpc-core'
import { connect } from '@migaia/rpc-core'
import { framer } from '@migaia/rpc-core'
import { ping } from '@migaia/rpc-core'
import { createNodeProcessLauncher } from '../../../rpc-process/src/process/adapters/node-child-process.js'
import { createProcessTransport } from '@migaia/rpc-process'
import { createNativeProcessOffer } from '../../../rpc-process/src/process/offer.js'
import { createProcessPlugin } from '../../../rpc-process/src/process/plugin/client.js'
import { createProcessResilience } from '@migaia/rpc-process'
import type { IRemoteContract } from '@migaia/rpc-core/remote'
import type { IRemoteServeEndpoint } from '@migaia/rpc-core/remote'

/** A child fixture imports the built process-plugin implementation without Vitest IPC. */
const childFixture = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  './fixtures/node-process-plugin-child.mjs'
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
  it.each(['default-stop', 'external-switch'] as const)(
    '[A1/A8/A9/K226] serves and replaces a real Node child over native stdio (%s)',
    async (mode) => {
      const token = 'native-process-plugin-token'
      const launcher = createNodeProcessLauncher()
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** A real process consumes exactly one unit of the caller-owned budget. */
      const budget = createUnitBudget({
        kind: 'process',
        maxUnits: mode === 'external-switch' ? 2 : 1
      })
      /** A shared governor retains the public plugin identity across a committed switch. */
      const governor =
        mode === 'external-switch'
          ? createProcessResilience({ scheduler: systemScheduler, report: () => undefined })
          : undefined
      /** Caller-owned governance must remain open after releasing the PluginHost. */
      /** Candidate installation returns a real new feature without consulting the retired proxy. */
      let candidateFeature: { request(params: unknown[]): Promise<unknown> } | undefined
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
        host: {
          ...host.plugin,
          async replace(name, next) {
            const installed = await host.replace(name, next)
            candidateFeature = installed.getFeature('f') as typeof candidateFeature
          }
        },
        resilience: governor,
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
        if (governor) expect(governor.inspect('p')).toMatchObject({ state: 'ready' })
        const replacement = await plugin.replace({
          strategy: mode === 'external-switch' ? 'start-then-switch' : 'stop-then-start',
          spec: { ...spec, env: { inherit: [], set: { RPC_VALUE: 'new-child' } } }
        })
        if (mode === 'external-switch') {
          expect(replacement.strategy).toBe('start-then-switch')
          expect(governor!.inspect('p')).toMatchObject({ state: 'ready' })
          await expect(feature.request(['old'])).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
          expect(await candidateFeature!.request(['again'])).toBe('new-child:again')
        } else {
          expect(replacement).toMatchObject({
            strategy: 'stop-then-start',
            outcome: { kind: 'replaced', generation: 2 }
          })
          await vi.waitFor(async () => {
            expect(await feature.request(['again'])).toBe('new-child:again')
          })
        }
      } finally {
        await host.dispose()
        if (governor) expect(() => governor.onTerminal(() => undefined)()).not.toThrow()
        await governor?.close()
      }
    }
  )
})
