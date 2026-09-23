import { describe, expect, it, vi } from 'vitest'
import { createWebRpcPluginHost } from '../../src/internal/web-rpc-plugin-host.js'
import { createComposedEndpoint } from '../../src/core.js'
import { defineFeature } from '../../src/feature.js'
import { createClientFirstPartyRoots } from '../../src/internal/client-first-party-roots.js'
import { WebRpcErrorCode, WebRpcLifecycleError } from '../../src/errors.js'
import { WebRpcErrorText } from '../../src/error-text.js'
import { connect } from '../../src/middleware/connect.js'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { createConstructionControl } from '../../src/internal/construction-install.js'
import { createEndpointProjection } from '../../src/internal/endpoint-projection.js'
import type { IWebRpcPluginConstraint } from '../../src/internal/plugin-contract.js'
import type { IWebRpcAbortSignal } from '../../src/typing.js'

/** Native output with an undefined public value must fail closed at the projection boundary. */
const hostileProjectionFeature = defineFeature(() => Object.freeze({ forged: undefined }))

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
    // 投影现在把可调用成员包一层，用来把宿主的 `VIEW_REVOKED` 翻译成本包的 ENDPOINT_DISPOSED——
    // 宿主的存活判定在成员体之前执行，端点没有别的拦截点。保证从「同一个引用」放宽为「同一个实现」：
    // 调用投影出的成员，被调到的必须还是原来那一个函数，且同一个键每次读到同一个对象。
    expect(projection.send).toBe(projection.send)
    projection.send('payload')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('payload')
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
    try {
      const construction = createComposedEndpoint(
        {
          id: 'round14-projection-hostile',
          transport,
          middlewares: [connect({ transport })],
          features: [hostileProjectionFeature] as const
        },
        createClientFirstPartyRoots()
      )
      await expect(construction).rejects.toMatchObject({
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.endpointModuleInvalid
      })
      // 宿主由工厂产出而非类，没有原型可监视；它 dispose 的外部效应就是这一次 transport 关闭。
      expect(closeCalls).toBe(1)
    } finally {
      // 无需还原任何 spy。
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
    const host = createWebRpcPluginHost(
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
      // 与生产一致：投影的来源是 extensions，不是宿主本身。
      host: {},
      publicKeys: [],
      exposedKeys: [],
      on: () => undefined,
      hooks: Object.freeze({}),
      hostDispose: () => host.dispose() as unknown as Promise<void>
    }) as Readonly<{ readonly dispose: () => Promise<void> }>
    try {
      const first = endpoint.dispose()
      // 宿主句柄是冻结的，不能被 spy 重定义；等价观测是它自己的保证：dispose 链被记忆化，所以
      // 端点交出的 Promise 与直接向宿主索取的是同一个引用。
      expect(first).toBe(host.dispose())
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
      await host.dispose().catch(() => undefined)
    }
  })
})
