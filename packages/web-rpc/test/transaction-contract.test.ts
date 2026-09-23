import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../src/core.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createClientFirstPartyRoots } from '../src/internal/client-first-party-roots.js'
import { createProviderFirstPartyRoots } from '../src/internal/provider-first-party-roots.js'
import { connect } from '../src/middleware/connect.js'
import { defineMiddleware } from '../src/middleware.js'
import { defineFeature } from '@migaia/plugin-host'
import type { IWebRpcMiddleware, IWebRpcPlugin, IWebRpcPluginInstallResult } from '../src/typing.js'
import type { IWebRpcHookEvent } from '../src/typing.js'
import type { IWebRpcPluginConstraint } from '../src/internal/plugin-contract.js'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'

type IObservedHost = {
  readonly config: { readonly get: (path: string) => unknown }
  readonly dispose: () => Promise<IPluginHostDisposalResult>
  readonly getShared: (key: PropertyKey) => unknown
}

type IObservedView = {
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  readonly getShared: (key: PropertyKey) => unknown
}

type IObservedBatch = {
  readonly host: IObservedHost
  readonly names: readonly string[]
}

type IObservedDisposal = {
  readonly host: IObservedHost
  readonly promise: Promise<IPluginHostDisposalResult>
}

const observed = vi.hoisted(() => ({
  batches: [] as IObservedBatch[],
  disposals: [] as IObservedDisposal[],
  events: [] as string[],
  hookEvents: [] as IWebRpcHookEvent[],
  throwFromHook: false,
  hosts: [] as IObservedHost[],
  views: [] as IObservedView[]
}))

vi.mock('../src/internal/web-rpc-plugin-host.js', async () => {
  const actual = await vi.importActual<typeof import('../src/internal/web-rpc-plugin-host.js')>(
    '../src/internal/web-rpc-plugin-host.js'
  )

  // 宿主现在是工厂产出的句柄而不是类：观测点从「继承并 override」变成「包装工厂返回的句柄」。
  // 观测到的是同一批外部可见行为，且不再要求被观测对象必须可被继承。
  const createObserved: typeof actual.createWebRpcPluginHost = (
    id,
    transport,
    construction,
    hooks,
    options,
    readCleanupErrors
  ) => {
    const host = actual.createWebRpcPluginHost(
      id,
      transport,
      construction,
      (event) => {
        observed.hookEvents.push(event)
        hooks(event)
        if (observed.throwFromHook) throw new Error('diagnostic observer failed')
      },
      options,
      readCleanupErrors
    )
    const wrapped = Object.freeze({
      ...host,
      installBatch: async (plugins: readonly IWebRpcPluginConstraint[]) => {
        observed.events.push('host:installBatch')
        observed.batches.push({ host: wrapped, names: plugins.map((plugin) => plugin.name) })
        const view = await host.installBatch(plugins)
        observed.views.push(view as IObservedView)
        return view
      },
      dispose: (): Promise<IPluginHostDisposalResult> => {
        observed.events.push('host:dispose')
        const promise = host.dispose()
        observed.disposals.push({ host: wrapped, promise })
        return promise
      }
    }) as ReturnType<typeof actual.createWebRpcPluginHost>
    observed.hosts.push(wrapped as unknown as IObservedHost)
    return wrapped
  }

  return { ...actual, createWebRpcPluginHost: createObserved }
})

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

/** Host control members that must never cross the composed endpoint projection. */
const hostControlKeys = [
  'pipelineMode',
  'usePipeline',
  'useAsyncPipeline',
  'useGeneratorPipeline',
  'useAsyncGeneratorPipeline',
  'getShared',
  'config',
  'use',
  'unUse'
] as const

let configSequence = 0

/** Creates a transport whose physical subscription remains observable during composition. */
function createConfig(
  onSubscribe: () => void,
  middlewares: readonly IWebRpcMiddleware[] = [connect()]
): IWebRpcCoreConfig {
  const [transport] = createMemoryTransportPair()
  return {
    id: `transaction-contract-${configSequence++}`,
    transport: {
      ...transport,
      subscribe: (listener) => {
        onSubscribe()
        return transport.subscribe(listener)
      }
    },
    middlewares
  }
}

/** Creates native middleware whose async resource work remains in the Host construction scope. */
function createFeatureModule(
  key: string,
  install: () => Promise<
    Record<string, unknown> & { readonly dispose?: () => void | Promise<void> }
  >
) {
  return defineMiddleware(key, (core) => {
    return {
      install: async () => {
        const { dispose, ...extension } = await install()
        if (typeof dispose === 'function') core.own(dispose, () => dispose())
        return extension
      }
    }
  })
}

/** Creates a middleware whose Host-owned shared publication can be observed during rollback. */
function createSharedMiddleware(
  name: string,
  key: PropertyKey,
  value: unknown,
  dispose: () => void
): IWebRpcPlugin {
  const result: IWebRpcPluginInstallResult = {
    extension: {},
    shared: { [key]: value }
  }
  return {
    name,
    metadata: { claims: emptyClaims, sharedProvides: [key] },
    install: (scope) => {
      scope.own({}, dispose)
      return result
    }
  }
}

/** Clears only this file's test observer; production and unrelated test state remain untouched. */
afterEach(() => {
  observed.batches.length = 0
  observed.disposals.length = 0
  observed.events.length = 0
  observed.hookEvents.length = 0
  observed.throwFromHook = false
  observed.hosts.length = 0
  observed.views.length = 0
})

describe('MET-RED-006 PluginHost batch completeness', () => {
  it('proves one Host receives the complete kernel, middleware, feature, and activation batch', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      createProviderFirstPartyRoots()
    )
    try {
      expect(observed.hosts).toHaveLength(1)
      expect(observed.batches).toHaveLength(1)
      expect(observed.batches[0]?.names).toEqual([
        'kernel',
        'connect',
        'middleware-finalize',
        'endpoint-capabilities',
        'activation'
      ])
    } finally {
      await endpoint.dispose()
    }
  })
})

describe('MET-RED-007 Host rollback ownership', () => {
  it('proves extension, shared publication, and resources roll back once', async () => {
    const sharedKey = Symbol('transaction-shared')
    const firstValue = Object.freeze({ owner: 'first' })
    const extensionValue = vi.fn()
    let resourceDisposals = 0
    let featureDisposals = 0
    let observedShared: unknown
    let observedExtension: unknown
    const first = createSharedMiddleware('transaction-first', sharedKey, firstValue, () => {
      resourceDisposals += 1
    })
    const installedFeature = createFeatureModule('transaction-installed-feature', async () => ({
      transactionExtension: extensionValue,
      dispose: () => {
        featureDisposals += 1
      }
    }))
    const primaryFailure = new Error('later batch member failed')
    const failingFeature = createFeatureModule('transaction-failing-feature', async () => {
      const host = observed.hosts[0]
      observedExtension = undefined
      observedShared = host?.getShared(sharedKey)
      throw primaryFailure
    })
    const failure = await createComposedEndpoint(
      createConfig(() => undefined, [connect(), first, installedFeature, failingFeature]),
      createClientFirstPartyRoots()
    ).catch((error: unknown) => error)

    expect(failure).toBe(primaryFailure)
    // Async batch publication is atomic: an external Host observer cannot see a candidate
    // registration before the later member succeeds.
    expect(observedShared).toBeUndefined()
    expect(observedExtension).toBeUndefined()
    expect(resourceDisposals).toBe(1)
    expect(featureDisposals).toBe(1)
    expect(observed.hosts).toHaveLength(1)
    expect(observed.batches).toHaveLength(1)
    const host = observed.hosts[0]!
    expect(Object.hasOwn(host, 'transactionExtension')).toBe(false)
    expect(() => host.getShared(sharedKey)).toThrow(
      expect.objectContaining({ code: 'HOST_DISPOSED' })
    )
    expect(observed.disposals).toHaveLength(1)
    expect(new Set(observed.disposals.map(({ host: disposedHost }) => disposedHost)).size).toBe(1)
  })
})

describe('MET-RED-016 activation boundary', () => {
  it('proves transport subscription is deferred until the complete Host batch commits', async () => {
    let subscriptions = 0
    let installSubscriptionCount = -1
    const observer: IWebRpcPlugin = {
      name: 'transaction-install-observer',
      metadata: { claims: emptyClaims },
      install: () => {
        installSubscriptionCount = subscriptions
        return { extension: {}, shared: {} }
      }
    }
    const endpoint = await createComposedEndpoint(
      createConfig(() => {
        subscriptions += 1
      }, [connect(), observer]),
      createClientFirstPartyRoots()
    )
    try {
      expect(installSubscriptionCount).toBe(0)
      expect(subscriptions).toBe(1)
    } finally {
      await endpoint.dispose()
    }
  })

  it('proves failed install keeps transport unsubscribed and activation uncommitted', async () => {
    let subscriptions = 0
    let installSubscriptionCount = -1
    const observer: IWebRpcPlugin = {
      name: 'transaction-install-observer',
      metadata: { claims: emptyClaims },
      install: () => {
        installSubscriptionCount = subscriptions
        return { extension: {}, shared: {} }
      }
    }
    const primaryFailure = new Error('later activation batch member failed')
    const failingFeature = createFeatureModule('transaction-late-failure', async () => {
      observed.events.push('feature:failure')
      throw primaryFailure
    })
    const construction = createComposedEndpoint(
      createConfig(() => {
        subscriptions += 1
      }, [connect(), observer, failingFeature]),
      Object.create(null)
    )

    await expect(construction).rejects.toBe(primaryFailure)
    expect(installSubscriptionCount).toBe(0)
    expect(subscriptions).toBe(0)
    expect(observed.events).toEqual(['host:installBatch', 'feature:failure', 'host:dispose'])
  })
})

describe('MET-RED-021 feature disposer and public surface ownership', () => {
  it('proves a feature disposer stays Host-owned while only its admitted surface is public', async () => {
    let disposerCalls = 0
    const featureDisposer = (): void => {
      disposerCalls += 1
    }
    const cleanupFeature = createFeatureModule('transaction-feature', async () => ({
      dispose: featureDisposer
    }))
    const feature = defineFeature(() => Object.freeze({ feature: () => undefined }))
    const endpoint = await createComposedEndpoint(
      {
        ...createConfig(() => undefined, [connect(), cleanupFeature]),
        features: [feature] as const
      },
      Object.create(null)
    )
    expect(Reflect.ownKeys(endpoint)).toEqual(['dispose', 'feature'])
    expect(endpoint).not.toBe(observed.hosts[0])
    expect(typeof endpoint.feature).toBe('function')
    expect(endpoint.dispose).not.toBe(featureDisposer)
    for (const key of hostControlKeys) expect(key in (endpoint as object), key).toBe(false)
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    await endpoint.dispose()
    expect(observed.disposals).toHaveLength(1)
    expect(disposerCalls).toBe(1)
  })
})

describe('MET-RED-024 preflight conflict ownership', () => {
  it('proves duplicate route, port, and public-key claims reject before Host or install effects', async () => {
    const cases = [
      { claims: { routes: ['transaction-route'] }, label: 'route' },
      { claims: { provides: ['transaction-port'] }, label: 'port' },
      { claims: { publicKeys: ['transaction-key'] }, label: 'public key' }
    ] as const
    for (const { claims, label } of cases) {
      observed.batches.length = 0
      observed.disposals.length = 0
      observed.hosts.length = 0
      let installs = 0
      let subscriptions = 0
      const publicKeys = 'publicKeys' in claims ? claims.publicKeys : []
      const first = defineMiddleware({
        name: `transaction-${label}-first`,
        metadata: { claims: { ...emptyClaims, ...claims } },
        install: async () => {
          installs += 1
          return { extension: {}, shared: {} }
        }
      })
      const second = defineMiddleware({
        name: `transaction-${label}-second`,
        metadata: { claims: { ...emptyClaims, ...claims, publicKeys } },
        install: async () => {
          installs += 1
          return { extension: {}, shared: {} }
        }
      })
      const failure = await createComposedEndpoint(
        createConfig(() => {
          subscriptions += 1
        }, [connect(), first, second]),
        Object.create(null)
      ).catch((error: unknown) => error)

      expect(failure, label).toMatchObject({ code: 'INVALID_CONFIG' })
      expect(installs, label).toBe(0)
      expect(subscriptions, label).toBe(0)
      expect(observed.hosts, label).toHaveLength(0)
      expect(observed.batches, label).toHaveLength(0)
    }
  })
})

describe('MET-RED-031 construction and disposal race', () => {
  it('proves a pending install abort settles before late rejection with one terminal path', async () => {
    const controller = new AbortController()
    let installStarted = false
    let rejectLate!: (error: unknown) => void
    let cleanupCalls = 0
    const lateFailure = new Error('late transaction install failure')
    const pendingInstall = new Promise<never>((_resolve, reject) => {
      rejectLate = (error: unknown): void => {
        reject(error)
      }
    })
    const delayed: IWebRpcPlugin = {
      name: 'transaction-delayed-failure',
      metadata: { claims: emptyClaims },
      install: (scope) => {
        installStarted = true
        observed.events.push('feature:install-start')
        scope.own({}, () => {
          cleanupCalls += 1
          observed.events.push('resource:cleanup')
        })
        return pendingInstall
      }
    }
    const construction = createComposedEndpoint(
      {
        ...createConfig(() => undefined, [connect(), delayed]),
        construction: { signal: controller.signal }
      },
      createClientFirstPartyRoots()
    )

    await vi.waitFor(() => expect(installStarted).toBe(true))
    controller.abort('construction cancelled')
    const settled = await Promise.race([
      construction.then(
        () => 'resolved' as const,
        (error: unknown) => ({ status: 'rejected' as const, error })
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100))
    ])
    expect(settled).not.toBe('timeout')
    expect(settled).toMatchObject({ status: 'rejected', error: { code: 'CANCELLED' } })

    expect(observed.hosts).toHaveLength(1)
    expect(observed.batches).toHaveLength(1)
    expect(observed.disposals).toHaveLength(1)
    expect(new Set(observed.disposals.map(({ promise }) => promise)).size).toBe(1)
    expect(new Set(observed.disposals.map(({ host }) => host)).size).toBe(1)
    expect(cleanupCalls).toBe(1)
    expect(observed.events).toEqual([
      'host:installBatch',
      'feature:install-start',
      'resource:cleanup',
      'host:dispose'
    ])

    rejectLate(lateFailure)
    await vi.waitFor(() => {
      expect(observed.hookEvents).toContainEqual(
        expect.objectContaining({
          name: 'failure',
          code: 'INTERNAL',
          error: lateFailure,
          localId: expect.any(String),
          at: expect.any(Number)
        })
      )
    })
    expect(observed.disposals).toHaveLength(1)
    expect(cleanupCalls).toBe(1)
    expect(observed.hookEvents.filter((event) => event.error === lateFailure)).toHaveLength(1)
    // Mutation control: an outer finally/extra dispose would add another Host record and fail this oracle.
  })

  it('does not report a pre-settlement primary install failure as a late diagnostic', async () => {
    const primaryFailure = new Error('pre-settlement transaction install failure')
    const failingFeature = createFeatureModule('transaction-pre-settlement-failure', async () => {
      throw primaryFailure
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined, [connect(), failingFeature]),
        Object.create(null)
      )
    ).rejects.toBe(primaryFailure)
    expect(observed.hookEvents.filter((event) => event.error === primaryFailure)).toHaveLength(0)
    expect(observed.disposals).toHaveLength(1)
  })

  it('isolates a throwing diagnostic hook from late rejection settlement and cleanup', async () => {
    const controller = new AbortController()
    let installStarted = false
    let rejectLate!: (error: unknown) => void
    let cleanupCalls = 0
    const lateFailure = new Error('late diagnostic hook failure')
    const pendingInstall = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const delayed: IWebRpcPlugin = {
      name: 'transaction-throwing-diagnostic',
      metadata: { claims: emptyClaims },
      install: (scope) => {
        installStarted = true
        scope.own({}, () => {
          cleanupCalls += 1
        })
        return pendingInstall
      }
    }
    observed.throwFromHook = true
    const construction = createComposedEndpoint(
      {
        ...createConfig(() => undefined, [connect(), delayed]),
        construction: { signal: controller.signal }
      },
      createClientFirstPartyRoots()
    )

    await vi.waitFor(() => expect(installStarted).toBe(true))
    controller.abort('diagnostic isolation')
    await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' })
    rejectLate(lateFailure)
    await vi.waitFor(() => {
      expect(observed.hookEvents.filter((event) => event.error === lateFailure)).toHaveLength(1)
    })
    expect(observed.disposals).toHaveLength(1)
    expect(cleanupCalls).toBe(1)
  })
})

describe('MET-RED-033 public endpoint boundary', () => {
  it('proves the endpoint is a projection and never the PluginHost object', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      createProviderFirstPartyRoots()
    )
    const host = observed.hosts[0]
    expect(host).toBeDefined()
    expect(Reflect.ownKeys(endpoint)).toEqual([
      'on',
      'hooks',
      'dispose',
      'send',
      'sendAll',
      'dispatch',
      'dispatchAll',
      'provide'
    ])
    expect(endpoint).not.toBe(host)
    for (const key of hostControlKeys) expect(key in (endpoint as object), key).toBe(false)
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    await endpoint.dispose()
    expect(observed.disposals).toHaveLength(1)
  })
})

describe('MET-RED-034 per-endpoint batch cardinality', () => {
  it('proves one endpoint invokes exactly one Host install batch', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      createClientFirstPartyRoots()
    )
    try {
      expect(observed.hosts).toHaveLength(1)
      expect(observed.batches).toHaveLength(1)
      expect(new Set(observed.batches.map(({ host }) => host)).size).toBe(1)
    } finally {
      await endpoint.dispose()
    }
  })
})
