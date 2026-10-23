import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { rpcByteRuntimeBootstrap } from '@migaia/rpc-contract/runtime'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'
import { createRpcHost } from '../../dist/index.js'
import {
  defineFeaturePlugin,
  defineTransportPlugin,
  holdAdapterByteBootstrapSource
} from '../../dist/plugin/index.js'
import { readRpcPluginMetadata } from '../../dist/plugin/metadata.js'
import { memoryServer } from './fixture.js'
import {
  createAdapterDeployment,
  readAdapterDeployment,
  type IAdapterDeploymentAcceptedSession
} from '../../dist/runtime-adapter/deployment.js'
import { readRuntimeByteBootstrap } from '../../dist/runtime-adapter/byte/bootstrap.js'
import { createRuntimeByteConnection } from '../../dist/runtime-adapter/byte/handshake.js'
import * as endpointFactory from '../../dist/core/runtime-api-endpoint.js'
import { diagnostics, duplex } from '../adapter-boundary/audit-byte-fixture.js'

/** This fixture uses the real first-frame grammar and private receiver, never a returned DTO. */
const local = {
  runtime: 'fixture',
  platform: 'Process' as const,
  diagnostics,
  expectedStringText: 'bootstrap fixture requires text',
  bootstrapInvalidText: 'bootstrap fixture invalid'
}
/** Safe fixture identity is distinct from the caller's ordinary host default. */
const childSelf = { name: 'actual-child', instanceId: 'actual-child-instance' }
/** The bytes carry the same received launch generation later advertised by the child. */
const bootstrap = {
  kind: rpcByteRuntimeBootstrap.kind,
  version: rpcByteRuntimeBootstrap.version,
  self: childSelf,
  parentInstanceId: 'actual-parent',
  token: 'fixture-token',
  generation: { kind: 'restart', value: 3, providerId: 'original-launch-owner' }
}

/** Drain only the real returned consumer in the business assertion. */
async function items(iterator: AsyncIterable<unknown>) {
  const values: unknown[] = []
  for await (const value of iterator) values.push(value)
  return values
}

describe('bootstrap sources before host endpoint construction', () => {
  it('adopts the real first-frame self and generation before one endpoint and keeps bidirectional calls', async () => {
    /** Ordered bytes queue at the original physical resource until its receiver attaches. */
    const physical = duplex()
    const [parentIO, childIO] = physical.ports
    const received = deferred<void>()
    const release = deferred<void>()
    const constructed = vi.spyOn(endpointFactory, 'createRuntimeApiEndpoint')
    const feature = defineFeaturePlugin({ name: 'exact-bootstrap-feature' })
    const seen: unknown[] = []
    const child = defineTransportPlugin({
      name: 'child',
      mode: 'connect-to-parent',
      connect: { timeoutMs: 200 },
      deployment: createAdapterDeployment({
        bootstrap: async (context) => {
          seen.push(context.features)
          await readRuntimeByteBootstrap(childIO!, diagnostics, { timeoutMs: 200 })
          received.resolve()
          await release.promise
          return holdAdapterByteBootstrapSource(childIO!, local)
        },
        open: async () => {
          throw new Error('qualified bootstrap must use its original raw opener')
        }
      })
    })
    const directories: unknown[] = []
    const observer = defineFeaturePlugin({
      name: 'directory-observer',
      setup(context) {
        context.onDispose(
          context.directories.onAccepted((directory) => directories.push(directory))
        )
        directories.push(...context.directories.current())
      }
    })
    const parent = defineTransportPlugin({
      name: 'parent',
      mode: 'spawn',
      deployment: createAdapterDeployment({
        open: async (context) => {
          await parentIO!.write(
            encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(bootstrap)))
          )
          return createRuntimeByteConnection(
            parentIO!,
            {
              role: 'initiator',
              platform: 'Process',
              expectedStringText: local.expectedStringText,
              peerId: childSelf.instanceId,
              signal: context.signal,
              report: context.report,
              offer: {
                versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
                codecs: [RpcCodecId.json],
                capabilities: context.capabilities,
                peer: { id: context.self.instanceId, runtime: 'fixture' },
                auth: bootstrap.token
              },
              ipc: { connectionId: 'parent', sessionId: 'parent', log: () => undefined }
            },
            diagnostics
          )
        }
      })
    })
    const parentOpening = createRpcHost({
      self: { name: 'parent', instanceId: 'actual-parent' },
      plugins: [parent, observer],
      provide: { parent: () => 'reverse' },
      report: () => undefined
    })
    const childOpening = createRpcHost({
      plugins: [child, feature],
      provide: {
        echo: (value: unknown) => value,
        async *values() {
          yield 1
          yield 2
        }
      },
      report: () => undefined
    })
    try {
      await received.promise
      expect(
        constructed.mock.calls.filter(([config]) => config.id === childSelf.instanceId)
      ).toHaveLength(0)
      expect(seen).toEqual([[feature]])
      release.resolve()
      const [parentHost, childHost] = await Promise.all([parentOpening, childOpening])
      try {
        expect(childHost.self).toEqual(childSelf)
        expect(
          constructed.mock.calls.filter(([config]) => config.id === childSelf.instanceId)
        ).toHaveLength(1)
        expect(directories[0]).toMatchObject({
          self: { ...childSelf, generation: bootstrap.generation }
        })
        expect(await parentHost.request('echo', 42)).toBe(42)
        expect(await childHost.request('parent')).toBe('reverse')
        expect(await items(parentHost.stream('values') as AsyncIterable<unknown>)).toEqual([1, 2])
      } finally {
        await childHost.close()
        await parentHost.close()
      }
    } finally {
      release.resolve()
      physical.close()
      vi.restoreAllMocks()
    }
  })

  it('rejects an explicit self mismatch before an endpoint and preserves cleanup failure reports', async () => {
    const physical = duplex()
    const childIO = physical.ports[1]!
    const cleanup = new Error('bootstrap native close failure')
    const close = childIO.close
    vi.spyOn(childIO, 'close').mockImplementation(() => {
      close()
      throw cleanup
    })
    const reports: unknown[] = []
    const constructed = vi.spyOn(endpointFactory, 'createRuntimeApiEndpoint')
    const plugin = defineTransportPlugin({
      name: 'mismatch',
      mode: 'connect-to-parent',
      deployment: createAdapterDeployment({
        bootstrap: async () => {
          await readRuntimeByteBootstrap(childIO, diagnostics)
          return holdAdapterByteBootstrapSource(childIO, local)
        },
        open: async () => {
          throw new Error('mismatch must not open a channel')
        }
      })
    })
    try {
      expect(() => holdAdapterByteBootstrapSource(childIO, local)).toThrowError()
      const opening = createRpcHost({
        self: { name: 'wrong', instanceId: 'wrong' },
        plugins: [plugin],
        report: (error) => reports.push(error)
      })
      await physical.ports[0]!.write(
        encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(bootstrap)))
      )
      await expect(opening).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'INVALID_CONFIG'
      })
      expect(constructed).not.toHaveBeenCalled()
      expect(reports).toContain(cleanup)
      expect(physical.states[1]!.closes).toBe(1)
    } finally {
      vi.restoreAllMocks()
      physical.close()
    }
  })

  it('releases a late actual bootstrap after cancellation without constructing an endpoint', async () => {
    const physical = duplex()
    const childIO = physical.ports[1]!
    const received = deferred<void>()
    const release = deferred<void>()
    const controller = new AbortController()
    const reason = new Error('cancel actual bootstrap preparation')
    const constructed = vi.spyOn(endpointFactory, 'createRuntimeApiEndpoint')
    const plugin = defineTransportPlugin({
      name: 'canceled',
      mode: 'connect-to-parent',
      deployment: createAdapterDeployment({
        bootstrap: async () => {
          await readRuntimeByteBootstrap(childIO, diagnostics)
          received.resolve()
          await release.promise
          return holdAdapterByteBootstrapSource(childIO, local)
        },
        open: async () => {
          throw new Error('canceled source must not open a channel')
        }
      })
    })
    try {
      const opening = createRpcHost({
        plugins: [plugin],
        signal: controller.signal,
        report: () => undefined
      })
      const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError', cause: reason })
      await physical.ports[0]!.write(
        encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(bootstrap)))
      )
      await received.promise
      controller.abort(reason)
      release.resolve()
      await rejected
      expect(constructed).not.toHaveBeenCalled()
      expect(physical.states[1]!.closes).toBe(1)
    } finally {
      release.resolve()
      vi.restoreAllMocks()
      physical.close()
    }
  })

  it('lends the actual listener session with disposal confined to that peer', async () => {
    /** The listener keeps its original native receiver and physical resource owner. */
    const server = memoryServer('borrowed-server')
    const metadata = readRpcPluginMetadata(server.transport)!
    if (metadata.kind !== 'transport') throw new Error('fixture transport required')
    const native = readAdapterDeployment(metadata.definition.deployment)!
    const accepted: IAdapterDeploymentAcceptedSession[] = []
    const constructed = vi.spyOn(endpointFactory, 'createRuntimeApiEndpoint')
    const plugin = defineTransportPlugin({
      name: 'borrowed-listener',
      mode: 'listen',
      deployment: createAdapterDeployment({
        ...native,
        listen: (context, admit) =>
          native.listen!(context, async (channel) => {
            const receipt = await admit(channel)
            accepted.push(receipt)
            return receipt
          })
      })
    })
    const host = await createRpcHost({ ...server.options, plugins: [plugin] })
    const first = await server.connect('first', { provide: { value: () => 1 } })
    const second = await server.connect('second', { provide: { value: () => 2 } })
    try {
      expect(accepted).toHaveLength(2)
      expect(
        constructed.mock.calls.filter(([config]) => config.id === 'borrowed-server')
      ).toHaveLength(1)
      await accepted[0]!.endpoint.endpoint.dispose()
      await expect(host.send('first', 'value')).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      expect(await host.send('second', 'value')).toBe(2)
      expect(first.pair[0].closed).toBe(true)
      expect(second.pair[0].closed).toBe(false)
    } finally {
      await first.host.close()
      await second.host.close()
      await host.close()
      vi.restoreAllMocks()
    }
  })
})
