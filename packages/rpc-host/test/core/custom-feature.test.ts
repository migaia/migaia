import { createComposedEndpoint } from '../../dist/core/composed.js'
import { createRuntimeFeatureRoots } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { describe, expect, it } from 'vitest'
import { connect } from '../../dist/core/middleware/connect.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

import { defineFeature, type IRpcFeature } from '../../dist/core/feature.js'
import { defineMiddleware } from '../../dist/core/middleware.js'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'

/**
 * Native definitions come from actual Host assembly; each composition still owns independent
 * installation state.
 */
const { roots: nativeRoots } = createRuntimeFeatureRoots(
  { id: 'custom-feature-native-roots', middlewares: [] },
  { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
)

describe('custom feature public boundary', () => {
  it('installs the first-party chunk through endpoint capabilities and closes its framer once', async () => {
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
    const endpoint = await createComposedEndpoint(
      {
        id: 'native-first-party-chunk',
        transport,
        framer,
        middlewares: [connect({ transport }), codec(defineJsonCodec({ version: 1 }))]
      },
      nativeRoots
    )
    await endpoint.dispose()
    await endpoint.dispose()
    expect(closes).toBe(1)
  })

  it('creates a synchronous native Feature with only its selected root projection', async () => {
    const [transport] = createMemoryTransportPair()
    const feature = defineFeature(() => ({ observe: () => 'native-root' }))
    const endpoint = await createComposedEndpoint(
      {
        id: 'native-custom-feature',
        transport,
        middlewares: [connect({ transport })],
        features: [feature] as const
      },
      nativeRoots
    )
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
    const endpoint = await createComposedEndpoint(
      {
        id: 'custom-feature-endpoint',
        transport,
        middlewares: [connect({ transport }), middleware] as const
      },
      nativeRoots
    )
    expect(endpoint.observe()).toBe('custom-feature-endpoint')
    await endpoint.dispose()
    await endpoint.dispose()
    expect(releases).toBe(1)
  })

  it('injects declared Feature roots into native Middleware without publishing them directly', async () => {
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
    const endpoint = await createComposedEndpoint(
      {
        id: 'feature-record',
        transport,
        middlewares: [connect({ transport }), middleware] as const
      },
      nativeRoots
    )
    expect(endpoint.throughFeature()).toBe('feature:feature-record')
    expect('root' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('isolates one declared Feature across native Middleware registrations', async () => {
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
    const endpoint = await createComposedEndpoint(
      {
        id: 'feature-isolation',
        transport,
        middlewares: [connect({ transport }), first, second] as const
      },
      nativeRoots
    )
    expect(endpoint.firstFromFeature()).toBe('first')
    expect(endpoint.secondFromFeature()).toBe('second')
    await endpoint.dispose()
  })

  it('rejects failed native Middleware installation before transport ingress', async () => {
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
        throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      }
    }))
    await expect(
      createComposedEndpoint(
        {
          id: 'failed-native-middleware',
          transport: observedTransport,
          middlewares: [connect({ transport: observedTransport }), failing] as const
        },
        nativeRoots
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
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
            throw new RpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.endpointModuleInvalid
            )
          return {}
        }
      }))
      if (mode === 'fail') {
        await expect(
          createComposedEndpoint(
            {
              id,
              transport,
              middlewares: [connect({ transport }), middleware] as const,
              features: [feature] as const
            },
            nativeRoots
          )
        ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
        return
      }
      const endpoint = await createComposedEndpoint(
        {
          id,
          transport,
          middlewares: [connect({ transport }), middleware] as const,
          features: [feature] as const
        },
        nativeRoots
      )
      expect(endpoint.observe()).toBe(id)
      await endpoint.dispose()
    }

    await install('first-3', 'pass')
    await install('fixture-failure', 'fail')
    await install('fixture-restored', 'pass')
    expect(trace).toEqual(['pass:first-3', 'fail:fixture-failure', 'pass:fixture-restored'])
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
    const widenedFeatures = [first, second] as IRpcFeature[]
    /** Compile-only branch keeps the widened-array rejection out of runtime execution. */
    const typeOnlyBranch: boolean = false
    if (typeOnlyBranch) {
      void createComposedEndpoint(
        {
          id: 'widened-feature-array',
          transport: observedTransport,
          middlewares: [],
          // @ts-expect-error Feature composition requires a finite readonly tuple.
          features: widenedFeatures
        },
        {}
      )
    }
    await expect(
      createComposedEndpoint(
        {
          id: 'duplicate-feature-endpoint',
          transport: observedTransport,
          middlewares: [connect({ transport: observedTransport })],
          features: [first, second] as const
        },
        nativeRoots
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(subscribeCalls).toBe(0)
    await expect(
      createComposedEndpoint(
        {
          id: 'forged-feature-endpoint',
          transport: observedTransport,
          middlewares: [connect({ transport: observedTransport })],
          features: [{ key: 'forged' }] as never
        },
        nativeRoots
      )
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
      createComposedEndpoint(
        {
          id: 'base-collision',
          transport: observedTransport,
          middlewares: [],
          features: [colliding] as const
        },
        nativeRoots
      )
    ).rejects.toMatchObject({ code: 'CAPABILITY_CONFLICT' })
    await expect(
      createComposedEndpoint(
        {
          id: 'hostile-thenable',
          transport: observedTransport,
          middlewares: [],
          features: [hostileThenable] as const
        },
        nativeRoots
      )
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
    const endpoint = await createComposedEndpoint(
      {
        id: 'native-promise',
        transport,
        middlewares: [connect({ transport }), native] as const
      },
      nativeRoots
    )
    expect(endpoint.native).toBe(true)
    await endpoint.dispose()
    await expect(
      createComposedEndpoint(
        {
          id: 'rollback-feature',
          transport,
          middlewares: [connect({ transport }), failing] as const
        },
        nativeRoots
      )
    ).rejects.toThrow()
    expect(releases).toBe(1)
  })
})
