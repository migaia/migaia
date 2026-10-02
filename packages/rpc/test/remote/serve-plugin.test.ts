import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import type { IRpcStreamRuntime } from '../../src/core/features/stream.js'
import { abort } from '../../src/core/middleware/abort.js'
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
  it('stops forwarding after target removal suspends the service registration', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let calls = 0
    const target = definePlugin({
      name: 'p',
      features: {
        f: defineFeature(() => ({
          request: () => {
            calls += 1
            return 'live'
          }
        }))
      },
      install: () => ({})
    })
    await host.use(target)
    /** The test endpoint preserves the provider after target removal. */
    let provider:
      | ((context: { data: unknown; success(value: unknown): unknown }) => unknown)
      | undefined
    const endpoint = {
      provide(_method: string, next: typeof provider) {
        provider = next
      },
      async dispose() {}
    } as unknown as IRpcEndpoint
    const service = await serveRemotePlugin({
      host,
      contract: {
        schemaVersion: 1,
        plugin: 'p',
        features: { f: { methods: { request: { mode: 'request', idempotent: false } } } }
      },
      endpoint: { endpoint },
      report: () => undefined
    })
    const context = { data: [], success: (value: unknown) => value }
    try {
      await expect(provider?.(context)).resolves.toBe('live')
      await host.unUse('p', { policy: 'suspend' })
      await expect(provider?.(context)).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      expect(calls).toBe(1)
    } finally {
      await service.close()
      await host.dispose()
    }
  })

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
        middlewares: [connect({ transport: serverTransport }), abort()]
      },
      streamRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      streamRoots()
    )
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let requestContext: IRpcContext | undefined
    let streamContext: IRpcContext | undefined
    let requestHookContext: IRpcContext | undefined
    let streamHookContext: IRpcContext | undefined
    let streamProviderContext: IRpcContext | undefined
    let hookCalls = 0
    let requestCalls = 0
    /** The original hook cause stays reachable by identity on the local owner. */
    const hookCause = new Error('hook root cause')
    const hookError = createRemoteLayerError(RpcRemoteLayerErrorCode.closed, hookCause)
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
    /** Capture the exact context core passes into the registered stream runner. */
    const streamRuntime: IRpcStreamRuntime = {
      open: (...args) => server.stream.open(...args),
      provide: (method, run) =>
        server.stream.provide(method, (params, input) => {
          streamProviderContext = input.context
          return run(params, input)
        }),
      dispose: () => server.stream.dispose()
    }
    const service = await serveRemotePlugin({
      host,
      contract,
      endpoint: { endpoint: server as unknown as IRpcEndpoint, stream: streamRuntime },
      report: (error) => {
        throw error
      },
      invocationContext: (context) => {
        hookCalls += 1
        if (Array.isArray(context.data) && context.data[0] === 'stream') streamHookContext = context
        else if (Array.isArray(context.data) && context.data[0] === 'ordinary')
          requestHookContext = context
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
      expect(streamHookContext).toBe(streamContext)
      expect(streamHookContext).toBe(streamProviderContext)
      expect(requestHookContext).toBe(requestContext)
      expect(typeof streamContext?.dispatchTo).toBe('function')
      /** K232 keeps the exact hook failure local; the requester receives only its code/message. */
      const rejected = await registration
        .invokeRequest('p.f.request', ['reject'])
        .catch((error: unknown) => error)
      expect(rejected).toMatchObject({ code: 'REMOTE_CLOSED', message: hookError.message })
      expect((rejected as Error).cause).toBeUndefined()
      expect(hookError.cause).toBe(hookCause)
      expect(requestCalls).toBe(1)
      expect(await client.send('server', 'p.f.request', ['after-hook-error'])).toBe(
        'after-hook-error'
      )
      await host.plugin.disable('p', { policy: 'suspend' })
      await expect(registration.invokeRequest('p.f.request', ['disabled'])).rejects.toMatchObject({
        code: 'REMOTE_CLOSED',
        message: hookError.message
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
