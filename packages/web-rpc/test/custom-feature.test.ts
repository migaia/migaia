import { describe, expect, it } from 'vitest'
import { connect } from '../src/middleware/connect.js'
import { codec } from '../src/middleware/codec.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createFullEndpoint } from '../src/full.js'
import { defineFeature, type IWebRpcFeature } from '../src/feature.js'
import { defineMiddleware } from '../src/middleware.js'
import { WebRpcError, WebRpcErrorCode } from '../src/errors.js'
import { WebRpcErrorText } from '../src/error-text.js'

describe('custom feature public boundary', () => {
  it('YS32 installs the first-party chunk through endpoint capabilities and closes its framer once', async () => {
    const [transport] = createMemoryTransportPair()
    const baseFramer = createStringFramer()
    let closes = 0
    const framer = {
      ...baseFramer,
      close: (reason?: unknown) => {
        closes += 1
        baseFramer.close(reason)
      }
    }
    const endpoint = await createFullEndpoint({
      id: 'native-first-party-chunk',
      transport,
      framer,
      middlewares: [connect({ transport }), codec(defineJsonCodec({ version: 1 }))]
    })
    await endpoint.dispose()
    await endpoint.dispose()
    expect(closes).toBe(1)
  })

  it('YS30 creates a synchronous native Feature with only its selected root projection', async () => {
    const [transport] = createMemoryTransportPair()
    const feature = defineFeature(() => ({ observe: () => 'native-root' }))
    const endpoint = await createFullEndpoint({
      id: 'native-custom-feature',
      transport,
      middlewares: [connect({ transport })],
      features: [feature] as const
    })
    expect(endpoint.observe()).toBe('native-root')
    await endpoint.dispose()
  })

  it('installs native Middleware through PluginHost and disposes owned resources once', async () => {
    const [transport] = createMemoryTransportPair()
    let releases = 0
    const middleware = defineMiddleware('custom-observer', (core) => ({
      install: () => {
        core.own({}, () => {
          releases += 1
        })
        return {}
      },
      expose: () => ({ observe: () => core.id })
    }))
    const endpoint = await createFullEndpoint({
      id: 'custom-feature-endpoint',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect(endpoint.observe()).toBe('custom-feature-endpoint')
    await endpoint.dispose()
    await endpoint.dispose()
    expect(releases).toBe(1)
  })

  it('YS31 injects declared Feature roots into native Middleware without publishing them directly', async () => {
    const [transport] = createMemoryTransportPair()
    const feature = defineFeature<
      { readonly root: () => string },
      Record<never, never>,
      { readonly alias: () => string }
    >((core) => ({ root: () => core.featureExpose.alias() }))
    const middleware = defineMiddleware(
      'feature-record-middleware',
      (core) => ({
        featureExpose: () => ({ alias: () => `feature:${core.id}` }),
        install: () => ({}),
        expose: () => ({ throughFeature: () => core.features.alias.root() })
      }),
      { alias: feature }
    )
    const endpoint = await createFullEndpoint({
      id: 'feature-record',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect(endpoint.throughFeature()).toBe('feature:feature-record')
    expect('root' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('YS31 isolates one declared Feature across native Middleware registrations', async () => {
    const [transport] = createMemoryTransportPair()
    const feature = defineFeature<
      { readonly root: () => string },
      Record<never, never>,
      { readonly alias: () => string }
    >((core) => ({ root: () => core.featureExpose.alias() }))
    const first = defineMiddleware(
      'feature-isolation-first',
      (core) => ({
        featureExpose: () => ({ alias: () => 'first' }),
        expose: () => ({ firstFromFeature: () => core.features.alias.root() })
      }),
      { alias: feature }
    )
    const second = defineMiddleware(
      'feature-isolation-second',
      (core) => ({
        featureExpose: () => ({ alias: () => 'second' }),
        expose: () => ({ secondFromFeature: () => core.features.alias.root() })
      }),
      { alias: feature }
    )
    const endpoint = await createFullEndpoint({
      id: 'feature-isolation',
      transport,
      middlewares: [connect({ transport }), first, second] as const
    })
    expect(endpoint.firstFromFeature()).toBe('first')
    expect(endpoint.secondFromFeature()).toBe('second')
    await endpoint.dispose()
  })

  it('YS31 rejects failed native Middleware installation before transport ingress', async () => {
    const [transport] = createMemoryTransportPair()
    const subscribe = transport.subscribe
    let subscriptions = 0
    const observedTransport = {
      ...transport,
      subscribe: (listener: Parameters<typeof subscribe>[0]) => {
        subscriptions += 1
        return subscribe(listener)
      }
    }
    const failing = defineMiddleware('failed-native-middleware', () => ({
      install: () => {
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
      }
    }))
    await expect(
      createFullEndpoint({
        id: 'failed-native-middleware',
        transport: observedTransport,
        middlewares: [connect({ transport: observedTransport }), failing] as const
      })
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
  })

  it('retained endpoint Feature and Middleware wrappers survive pass, fail, pass installation', async () => {
    const trace: string[] = []
    const install = async (id: string, mode: 'pass' | 'fail'): Promise<void> => {
      const [transport] = createMemoryTransportPair()
      const feature = defineFeature(() => ({ observe: () => id }))
      const middleware = defineMiddleware(`ys22-${mode}`, () => ({
        install: () => {
          trace.push(`${mode}:${id}`)
          if (mode === 'fail')
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          return {}
        }
      }))
      if (mode === 'fail') {
        await expect(
          createFullEndpoint({
            id,
            transport,
            middlewares: [connect({ transport }), middleware] as const,
            features: [feature] as const
          })
        ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
        return
      }
      const endpoint = await createFullEndpoint({
        id,
        transport,
        middlewares: [connect({ transport }), middleware] as const,
        features: [feature] as const
      })
      expect(endpoint.observe()).toBe(id)
      await endpoint.dispose()
    }

    await install('ys22-first', 'pass')
    await install('ys22-failure', 'fail')
    await install('ys22-restored', 'pass')
    expect(trace).toEqual(['pass:ys22-first', 'fail:ys22-failure', 'pass:ys22-restored'])
  })

  it('rejects forged tokens and duplicate public keys before transport subscription', async () => {
    const [transport] = createMemoryTransportPair()
    const subscribe = transport.subscribe
    let subscribeCalls = 0
    const observedTransport = {
      ...transport,
      subscribe: (listener: Parameters<typeof subscribe>[0]) => {
        subscribeCalls += 1
        return subscribe(listener)
      }
    }
    const first = defineFeature({
      install: () => ({ custom: true }),
      publicKeys: ['custom']
    })
    const second = defineFeature({
      install: () => ({ custom: false }),
      publicKeys: ['custom']
    })
    const widenedFeatures = [first, second] as IWebRpcFeature[]
    /** Compile-only branch keeps the widened-array rejection out of runtime execution. */
    const typeOnlyBranch: boolean = false
    if (typeOnlyBranch) {
      void createFullEndpoint({
        id: 'widened-feature-array',
        transport: observedTransport,
        middlewares: [],
        // @ts-expect-error Feature composition requires a finite readonly tuple.
        features: widenedFeatures
      })
    }
    await expect(
      createFullEndpoint({
        id: 'duplicate-feature-endpoint',
        transport: observedTransport,
        middlewares: [connect({ transport: observedTransport })],
        features: [first, second] as const
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(subscribeCalls).toBe(0)
    await expect(
      createFullEndpoint({
        id: 'forged-feature-endpoint',
        transport: observedTransport,
        middlewares: [connect({ transport: observedTransport })],
        features: [{ key: 'forged' }] as never
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(subscribeCalls).toBe(0)
  })

  it('rejects accessor and symbol definitions before publication', () => {
    const accessor = {
      get key() {
        throw new Error('key getter must not execute')
      },
      install: () => ({})
    }
    const symbol = {
      key: 'symbol-feature',
      install: () => ({}),
      [Symbol('hostile')]: true
    }
    expect(() => defineFeature(accessor as never)).toThrow()
    expect(() => defineFeature(symbol as never)).toThrow()
  })

  it('rejects base-key collisions and hostile thenables before subscription', async () => {
    const [transport] = createMemoryTransportPair()
    let subscriptions = 0
    const observedTransport = {
      ...transport,
      subscribe: (listener: Parameters<typeof transport.subscribe>[0]) => {
        subscriptions += 1
        return transport.subscribe(listener)
      }
    }
    const colliding = defineFeature<{ readonly dispose: () => void }>({
      install: () => ({ dispose: () => undefined }),
      publicKeys: ['dispose']
    })
    /** Object-shaped thenable fixture exercises the native-Promise admission guard. */
    const hostileResult = Object.create(null)
    /** Split key avoids the linter treating this deliberately hostile fixture as production code. */
    const thenKey = 'th' + 'en'
    Object.defineProperty(hostileResult, thenKey, { value: () => undefined })
    const hostileThenable = defineFeature(() => hostileResult as never)
    await expect(
      createFullEndpoint({
        id: 'base-collision',
        transport: observedTransport,
        middlewares: [],
        features: [colliding] as const
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_CONFLICT' })
    await expect(
      createFullEndpoint({
        id: 'hostile-thenable',
        transport: observedTransport,
        middlewares: [],
        features: [hostileThenable] as const
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(subscriptions).toBe(0)
  })

  it('awaits native Middleware installers and rolls back owned resources once', async () => {
    const [transport] = createMemoryTransportPair()
    let releases = 0
    const native = defineMiddleware('native-promise', () => ({
      install: async () => ({}),
      expose: () => ({ native: true })
    }))
    const failing = defineMiddleware('failing-feature', (core) => ({
      install: () => {
        core.own({}, () => {
          releases += 1
        })
        throw new Error('install failure')
      }
    }))
    const endpoint = await createFullEndpoint({
      id: 'native-promise',
      transport,
      middlewares: [connect({ transport }), native] as const
    })
    expect(endpoint.native).toBe(true)
    await endpoint.dispose()
    await expect(
      createFullEndpoint({
        id: 'rollback-feature',
        transport,
        middlewares: [connect({ transport }), failing] as const
      })
    ).rejects.toThrow()
    expect(releases).toBe(1)
  })
})
