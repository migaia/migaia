import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcContext, IRpcEndpoint } from '../../src/core/typing.js'
import { serveRemotePlugin } from '../../src/remote/serve-plugin.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'
import { createRemoteLayerError } from '../../src/remote/error.js'
import { createRemoteRegistration } from '../../src/remote/proxy.js'
import { streamRoots } from '../streaming/fixture.js'
import { remoteHarness } from './fixture.js'

/** A3 proves request and stream hooks receive their own admitted core contexts. */
describe('remote service plugin', () => {
  it('rejects an absent target before publishing providers and disposes the dedicated endpoint', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const provide = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const contract: IRemoteContract = {
      schemaVersion: 1,
      plugin: 'missing',
      features: { f: { methods: { request: { mode: 'request', idempotent: false } } } }
    }
    try {
      await expect(
        serveRemotePlugin({
          host,
          contract,
          endpoint: { endpoint: { provide, dispose } as unknown as IRpcEndpoint },
          report: () => undefined
        })
      ).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
      expect(provide).not.toHaveBeenCalled()
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      await host.dispose()
    }
  })

  it('passes the stream-open context unchanged and invokes its hook once', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      streamRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      streamRoots()
    )
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let requestContext: IRpcContext | undefined
    let streamContext: IRpcContext | undefined
    let hookCalls = 0
    let requestCalls = 0
    const hookError = createRemoteLayerError(
      RpcRemoteLayerErrorCode.closed,
      new Error('hook root cause')
    )
    const target = definePlugin({
      name: 'p',
      features: {
        f: defineFeature(() => ({
          request: (value: unknown, context: IRpcContext) => {
            requestCalls += 1
            requestContext = context
            return value
          },
          generator: function* (value: unknown, context: IRpcContext) {
            streamContext = context
            yield value
            return 'done'
          }
        }))
      },
      install: () => ({})
    })
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
    await host.use(target)
    const service = await serveRemotePlugin({
      host,
      contract,
      endpoint: { endpoint: server as unknown as IRpcEndpoint, stream: server.stream },
      report: (error) => {
        throw error
      },
      invocationContext: (context) => {
        hookCalls += 1
        if (Array.isArray(context.data) && context.data[0] === 'reject') throw hookError
        return context
      }
    })
    const fixture = remoteHarness()
    const registration = createRemoteRegistration({
      contract,
      binding: {
        ...fixture.binding,
        async openChannel() {
          return { ...fixture.channel, peerId: 'server' }
        }
      },
      endpointFactory: async () => ({
        endpoint: client as unknown as IRpcEndpoint,
        stream: client.stream
      }),
      report: (error) => {
        throw error
      }
    })
    try {
      await registration.prepareGeneration(new AbortController().signal, () => undefined)
      expect(await client.send('server', 'p.f.request', ['ordinary'])).toBe('ordinary')
      const iterator = client.stream.open('server', 'p.f.generator', ['stream'])
      expect(await iterator.next()).toEqual({ done: false, value: 'stream' })
      expect(await iterator.next()).toEqual({ done: true, value: 'done' })
      expect(hookCalls).toBe(2)
      expect(requestContext?.data).toEqual(['ordinary'])
      expect(streamContext?.data).toEqual(['stream'])
      expect(streamContext).not.toBe(requestContext)
      expect(typeof streamContext?.dispatchTo).toBe('function')
      await expect(registration.invokeRequest('p.f.request', ['reject'])).rejects.toMatchObject({
        source: '@migaia/rpc/remote',
        code: 'REMOTE_CLOSED',
        stack: hookError.stack,
        cause: { message: 'hook root cause' }
      })
      expect(requestCalls).toBe(1)
      expect(await client.send('server', 'p.f.request', ['after-hook-error'])).toBe(
        'after-hook-error'
      )
      await host.plugin.disable('p', { policy: 'suspend' })
      await expect(registration.invokeRequest('p.f.request', ['disabled'])).rejects.toMatchObject({
        code: 'REMOTE_CLOSED',
        source: '@migaia/rpc/remote'
      })
      await host.plugin.enable('p')
      expect(await client.send('server', 'p.f.request', ['restored'])).toBe('restored')
    } finally {
      await service.close()
      await registration.release()
      await fixture.registration.release()
      await client.dispose()
      await host.dispose()
    }
  })
})
