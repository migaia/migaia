import { describe, expect, it, vi } from 'vitest'
import { createComposedEndpoint } from '../../src/core.js'
import { outbound } from '../../src/features/outbound.js'
import { WebRpcErrorCode, WebRpcLifecycleError } from '../../src/errors.js'
import { WebRpcErrorText } from '../../src/error-text.js'
import { connect } from '../../src/middleware/connect.js'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { createConstructionControl } from '../../src/internal/construction-install.js'
import { defineEndpointModule } from '../../src/internal/endpoint-modules.js'
import { createEndpointProjection } from '../../src/internal/endpoint-projection.js'
import type { IWebRpcPluginConstraint } from '../../src/internal/plugin-contract.js'
import { WebRpcPluginHost } from '../../src/internal/web-rpc-plugin-host.js'
import type { IWebRpcCoreConfig } from '../../src/core.js'
import type { IWebRpcAbortSignal } from '../../src/typing.js'

const hostileProjectionModule = defineEndpointModule<IWebRpcCoreConfig, Record<string, unknown>>(
  'round14-projection-hostile',
  async () => {
    const surface = Object.create(null) as Record<string, unknown>
    Object.defineProperty(surface, 'forged', {
      configurable: false,
      enumerable: true,
      value: undefined,
      writable: false
    })
    return Object.freeze(surface)
  },
  [],
  [],
  { publicKeys: ['forged'], exposedKeys: ['forged'] }
)

/** Builds the narrow owner callbacks required by the frozen projection helper. */
const options = (host: object) => ({
  host,
  publicKeys: ['send', 'provide'],
  exposedKeys: ['send', 'provide'],
  on: () => undefined,
  hooks: Object.freeze({ on: () => undefined }),
  hostDispose: () => Promise.resolve()
})

describe('canonical endpoint projection', () => {
  it('copies only data descriptors, freezes a null-prototype surface, and keeps provide identity', async () => {
    const send = vi.fn()
    const provide = vi.fn()
    const host = { send, provide }
    const projection = createEndpointProjection(options(host)) as Readonly<{
      readonly send: typeof send
      readonly provide: (method: string, provider: () => void) => unknown
      readonly dispose: () => Promise<void>
    }>

    expect(Reflect.ownKeys(projection)).toEqual(['on', 'hooks', 'dispose', 'send', 'provide'])
    expect(Object.getPrototypeOf(projection)).toBeNull()
    expect(Object.isFrozen(projection)).toBe(true)
    expect(projection.send).toBe(send)
    expect(projection.send).toBe(projection.send)
    expect(projection.provide('echo', () => undefined)).toBe(projection)
    expect(provide).toHaveBeenCalledWith('echo', expect.any(Function))
    await projection.dispose()
  })

  const hostileHosts: readonly (readonly [string, Record<string, unknown>])[] = [
    ['missing', {}],
    ['extra', { send: () => undefined, provide: () => undefined, forged: true }],
    ['reserved', { send: () => undefined, provide: () => undefined, getShared: () => undefined }]
  ]
  it.each(hostileHosts)('rejects %s host projection before publish', (_name, host) => {
    expect(() => createEndpointProjection(options(host))).toThrow(
      expect.objectContaining({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
    )
  })

  it('rejects a symbol own-key collision before reading or publishing any descriptor', () => {
    const symbol = Symbol('forged')
    const host = Object.create(null) as Record<string, unknown>
    Object.defineProperty(host, 'send', { enumerable: true, value: () => undefined })
    Object.defineProperty(host, 'provide', { enumerable: true, value: () => undefined })
    Object.defineProperty(host, symbol, { enumerable: true, value: true })

    expect(() => createEndpointProjection(options(host))).toThrow(
      expect.objectContaining({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
    )
  })

  it('reserves __proto__ in both manifests before reading or publishing descriptors', () => {
    const host = Object.create(null) as Record<string, unknown>
    Object.defineProperty(host, 'send', { enumerable: true, value: () => undefined })
    Object.defineProperty(host, 'provide', { enumerable: true, value: () => undefined })
    Object.defineProperty(host, '__proto__', { enumerable: true, value: () => undefined })

    expect(() =>
      createEndpointProjection({
        ...options(host),
        publicKeys: ['send', 'provide', '__proto__'],
        exposedKeys: ['send', 'provide', '__proto__']
      })
    ).toThrow(
      expect.objectContaining({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
    )
  })

  it('rejects accessors and throwing proxies without executing a public getter', () => {
    let getterReads = 0
    const accessorHost: Record<string, unknown> = { provide: () => undefined }
    Object.defineProperty(accessorHost, 'send', {
      enumerable: true,
      get: () => {
        getterReads += 1
        return () => undefined
      }
    })
    expect(() => createEndpointProjection(options(accessorHost))).toThrow()
    expect(getterReads).toBe(0)

    const throwingHost = new Proxy(
      { send: () => undefined, provide: () => undefined },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor trap')
        }
      }
    )
    expect(() => createEndpointProjection(options(throwingHost))).toThrow(
      expect.objectContaining({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
    )
  })

  it('disposes the real Host when composed projection admission fails and never returns an escaped surface', async () => {
    const [clientTransport] = createMemoryTransportPair()
    let closeCalls = 0
    const transport = {
      ...clientTransport,
      ownership: 'owned' as const,
      close: () => {
        closeCalls += 1
        clientTransport.close()
      }
    }
    const hostDispose = vi.spyOn(WebRpcPluginHost.prototype, 'dispose')

    try {
      const construction = createComposedEndpoint(
        {
          id: 'round14-projection-hostile',
          transport,
          middlewares: [connect({ transport })]
        },
        [outbound(), hostileProjectionModule] as const
      )
      await expect(construction).rejects.toMatchObject({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
      expect(hostDispose).toHaveBeenCalledTimes(1)
      expect(closeCalls).toBe(1)
    } finally {
      hostDispose.mockRestore()
    }
  })

  it('returns the exact Host Promise and records one shared disposal identity', async () => {
    let rejectHost!: (error: unknown) => void
    const hostPromise = new Promise<void>((_resolve, reject) => {
      rejectHost = reject
    })
    const endpoint = createEndpointProjection({
      ...options({ send: () => undefined, provide: () => undefined }),
      hostDispose: () => hostPromise
    }) as Readonly<{ readonly dispose: () => Promise<void> }>
    const first = endpoint.dispose()
    expect(endpoint.dispose()).toBe(first)
    expect(first).toBe(hostPromise)
    const hostFailure = new Error('host failure')
    rejectHost(hostFailure)
    await expect(first).rejects.toBe(hostFailure)
  })

  it('retries beforeDispose after a throw before delegating to Host', () => {
    const beforeDisposeFailure = new Error('before dispose failed')
    const hostPromise = Promise.resolve()
    const beforeDispose = vi.fn((_endpoint: object) => {
      if (beforeDispose.mock.calls.length === 1) throw beforeDisposeFailure
    })
    const hostDispose = vi.fn(() => hostPromise)
    const endpoint = createEndpointProjection({
      ...options({ send: () => undefined, provide: () => undefined }),
      hostDispose,
      beforeDispose
    }) as Readonly<{ readonly dispose: () => Promise<void> }>

    expect(() => endpoint.dispose()).toThrow(beforeDisposeFailure)
    expect(beforeDispose).toHaveBeenCalledTimes(1)
    expect(hostDispose).not.toHaveBeenCalled()
    expect(endpoint.dispose()).toBe(hostPromise)
    expect(beforeDispose).toHaveBeenCalledTimes(2)
    expect(endpoint.dispose()).toBe(hostPromise)
    expect(beforeDispose).toHaveBeenCalledTimes(2)
    expect(hostDispose).toHaveBeenCalledTimes(2)
  })

  it('delegates to a real WebRpcPluginHost Promise and preserves translated disposal errors', async () => {
    const cleanup = new Error('integrated projection cleanup failed')
    const [transport] = createMemoryTransportPair()
    const host = new WebRpcPluginHost(
      'integrated-projection-host',
      transport,
      createConstructionControl({
        signal: new AbortController().signal as IWebRpcAbortSignal
      }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
      () => [{ resource: 'resource disposer', error: cleanup }]
    )
    const plugin: IWebRpcPluginConstraint = {
      name: 'integrated-projection-disposer',
      install: (core) => {
        core.onDispose(() => {
          throw cleanup
        })
        return {}
      }
    }
    await host.installBatch([plugin])
    const endpoint = createEndpointProjection({
      host,
      publicKeys: [],
      exposedKeys: [],
      on: () => undefined,
      hooks: Object.freeze({}),
      hostDispose: () => host.dispose() as unknown as Promise<void>
    }) as Readonly<{ readonly dispose: () => Promise<void> }>
    const hostDisposeSpy = vi.spyOn(host, 'dispose')
    try {
      const first = endpoint.dispose()
      const hostResult = hostDisposeSpy.mock.results[0]?.value
      expect(first).toBe(hostResult)
      expect(endpoint.dispose()).toBe(first)
      expect(endpoint.dispose()).toBe(first)
      await expect(first).rejects.toMatchObject({
        name: 'WebRpcLifecycleError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.endpointDisposed,
        cause: cleanup,
        cleanupErrors: [{ resource: 'resource disposer', error: cleanup }]
      })
      await expect(first).rejects.toBeInstanceOf(WebRpcLifecycleError)
    } finally {
      hostDisposeSpy.mockRestore()
      await host.dispose().catch(() => undefined)
    }
  })
})
