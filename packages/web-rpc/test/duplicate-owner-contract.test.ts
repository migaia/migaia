import { describe, expect, it, vi } from 'vitest'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../src/core.js'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { defineRpcFeature } from '../src/internal/define-rpc-feature.js'
import { defineFeature } from '../src/feature.js'
import { createFirstPartyRoots } from '../src/internal/first-party-roots.js'
import { createEndpointProjection } from '../src/internal/endpoint-projection.js'
import { WebRpcErrorCode, WebRpcLifecycleError } from '../src/errors.js'
import { connect } from '../src/middleware/connect.js'
import { createConstructionControl } from '../src/internal/construction-install.js'
import { createWebRpcPluginHost } from '../src/internal/web-rpc-plugin-host.js'
import { ReplayWindow } from '../src/internal/replay.js'
import { PeerRegistry } from '../src/internal/peers.js'
import { ProviderAdmissionRegistry } from '../src/internal/provider-admission.js'
import type { IWebRpcAbortSignal, IWebRpcPlugin } from '../src/typing.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'

type IBuildCapabilityTopology =
  typeof import('@migaia/capability/graph/topology').buildCapabilityTopology

const topologyMock = vi.hoisted(() => ({
  actual: undefined as IBuildCapabilityTopology | undefined,
  build: vi.fn<IBuildCapabilityTopology>()
}))

vi.mock('@migaia/capability/graph/topology', async () => {
  const actual = await vi.importActual<typeof import('@migaia/capability/graph/topology')>(
    '@migaia/capability/graph/topology'
  )
  topologyMock.actual = actual.buildCapabilityTopology
  topologyMock.build.mockImplementation(actual.buildCapabilityTopology)
  return { ...actual, buildCapabilityTopology: topologyMock.build }
})

/** Raw package sources used only for explicit owner and legacy-path assertions. */
const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** Returns one required source text and fails if the package inventory is incomplete. */
function source(path: string): string {
  const value = SOURCES[path]
  expect(value, `missing source inventory entry: ${path}`).toBeDefined()
  return value ?? ''
}

/** Creates a transport configuration whose physical subscription is observable. */
function createConfig(
  onSubscribe: () => void,
  middlewares: readonly IWebRpcPlugin[] = [connect()]
): IWebRpcCoreConfig {
  const [transport] = createMemoryTransportPair()
  return {
    id: `duplicate-owner-${Math.random()}`,
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

/** Defines a package-native root with the same prepare/public bridge used by first-party Features. */
function defineTestRoot<TSurface extends object>(
  publicKeys: readonly (keyof TSurface & string)[],
  install: () => TSurface
) {
  return defineRpcFeature(
    {
      publicKeys,
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys,
        exposedKeys: [],
        activator: false
      }
    },
    () => {
      const publicSurface = install()
      return Object.freeze({ prepare: () => Object.freeze({ public: publicSurface }) })
    },
    {}
  )
}

describe('candidate-specific duplicate-owner contracts', () => {
  it('projects a non-first-party public Feature output without invoking its prepare-shaped method', async () => {
    let prepareCalls = 0
    const prepare = () => {
      prepareCalls += 1
      return Object.freeze({ public: { x: 1 } })
    }
    const feature = defineFeature(() => Object.freeze({ prepare, other: 2 }))
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { feature }
    )
    expect(typeof Reflect.get(endpoint, 'prepare')).toBe('function')
    expect(Reflect.get(endpoint, 'other')).toBe(2)
    expect(prepareCalls).toBe(0)
    await endpoint.dispose()
  })

  it('proves MET-RED-001 keeps one canonical endpoint root owner', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    expect(Object.isFrozen(endpoint)).toBe(true)
    expect(Object.keys(SOURCES)).not.toContain('../src/endpoint.ts')
    await endpoint.dispose()
  })

  it('proves MET-RED-002 installs a feature without constructing a nested endpoint', async () => {
    let installs = 0
    const feature = defineTestRoot(['featureValue'], () => {
      installs += 1
      return Object.freeze({ featureValue: () => 2 })
    })
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-candidate-002': feature }
    )
    expect(installs).toBe(1)
    expect((Reflect.get(endpoint, 'featureValue') as () => number)()).toBe(2)
    expect(source('../src/core.ts')).not.toContain('new WebRpcEndpoint')
    await endpoint.dispose()
  })

  it('proves MET-RED-004 composes independent feature surfaces through one root', async () => {
    const first = defineTestRoot(['first'], () => Object.freeze({ first: () => 'first' }))
    const second = defineTestRoot(['second'], () => Object.freeze({ second: () => 'second' }))
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-first': first, 'first-party-second': second }
    )
    expect([
      (Reflect.get(endpoint, 'first') as () => string)(),
      (Reflect.get(endpoint, 'second') as () => string)()
    ]).toEqual(['first', 'second'])
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    await endpoint.dispose()
  })

  it('proves MET-RED-005 uses the canonical transport and outbound sender', async () => {
    let subscriptions = 0
    const endpoint = await createClientEndpoint(
      createConfig(() => {
        subscriptions += 1
      })
    )
    expect(subscriptions).toBe(1)
    expect(source('../src/internal/outbound-attachment.ts')).toContain(
      "from './outbound-sender.js'"
    )
    expect(SOURCES['../src/internal/pipeline.ts']).toBeUndefined()
    await endpoint.dispose()
  })

  it('proves MET-RED-007 delegates rollback ownership to one PluginHost', async () => {
    const [transport] = createMemoryTransportPair()
    const sharedKey = Symbol('candidate-007-shared')
    const sharedValue = Object.freeze({ owner: 'candidate-007' })
    const extension = () => 'extension'
    const primary = new Error('candidate-007 failure')
    let cleanupCalls = 0
    const host = createWebRpcPluginHost(
      'candidate-007',
      transport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    )
    const first = {
      name: 'candidate-007-first',
      config: { enabled: true },
      shared: () => ({ [sharedKey]: sharedValue }),
      install: (core: { onDispose: (dispose: () => void) => void }) => {
        core.onDispose(() => {
          cleanupCalls += 1
        })
        return { candidate007Extension: extension }
      }
    }
    const second = {
      name: 'candidate-007-second',
      install: () => {
        throw primary
      }
    }
    await expect(host.use(first, second)).rejects.toMatchObject({ cause: primary })
    expect(cleanupCalls).toBe(1)
    expect(Object.hasOwn(host, 'candidate007Extension')).toBe(false)
    expect(host.getShared(sharedKey)).toBeUndefined()
    expect(host.config.get('candidate-007-first')).toBeUndefined()
    await host.dispose()
  })

  it('proves MET-RED-008 leaves generic pipeline ownership in PluginHost', async () => {
    const endpoint = await createClientEndpoint(createConfig(() => undefined))
    // 宿主壳层已从「继承 PluginHost」改为「defineHost 产出句柄」；这条断言要观测的是
    // 「通用 pipeline 所有权留在 plugin-host 里」，用宿主入口而不是继承关系来表达。
    expect(source('../src/internal/web-rpc-plugin-host.ts')).toContain('defineHost')
    expect(Object.values(SOURCES).join('\n')).not.toContain('@migaia/middleware-pipeline')
    expect('usePipeline' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('proves MET-RED-009 invokes current middleware directly without a legacy adapter', async () => {
    const endpoint = await createClientEndpoint(createConfig(() => undefined, [connect()]))
    expect(typeof endpoint.send).toBe('function')
    expect(Object.values(SOURCES).join('\n')).not.toContain('adaptLegacyMiddleware')
    await endpoint.dispose()
  })

  it('proves MET-RED-010 owns pending settlement in one construction control', () => {
    let now = 100
    let disposed = 0
    const control = createConstructionControl({
      signal: new AbortController().signal as IWebRpcAbortSignal,
      timeoutMs: 50,
      time: {
        now: () => now,
        setTimeout: () => ({ clear: () => undefined }),
        clearTimeout: (timer) => timer.clear(),
        dispose: () => {
          disposed += 1
        }
      }
    })
    expect(control.deadlineAt).toBe(150)
    now = 120
    expect(control.remaining()).toBe(30)
    control.close()
    control.close()
    expect(disposed).toBe(0)
  })

  it('proves MET-RED-011 keeps replay admission in ReplayWindow', () => {
    const replay = new ReplayWindow(2, 1_000)
    expect(replay.reserveId('candidate-011')).toBe(true)
    expect(replay.reserveId('candidate-011')).toBe(false)
    replay.releaseId('candidate-011')
    expect(replay.hasReservedId('candidate-011')).toBe(true)
    replay.clear()
    expect(replay.hasReservedId('candidate-011')).toBe(false)
  })

  it('proves MET-RED-012 keeps peer leases in PeerRegistry', () => {
    const peers = new PeerRegistry<string>(2, 1_000)
    peers.add('configured', true)
    peers.add('learned')
    expect(peers.snapshot()).toEqual(['configured', 'learned'])
    peers.removeLearned('learned')
    expect(peers.snapshot()).toEqual(['configured'])
  })

  it('proves MET-RED-013 keeps provider admission in ProviderAdmissionRegistry', () => {
    const admission = new ProviderAdmissionRegistry(2, 1)
    expect(admission.acquire('task-a', 'peer-a')).toBe(true)
    expect(admission.acquire('task-b', 'peer-a')).toBe(false)
    admission.release('task-a')
    expect(admission.acquire('task-b', 'peer-a')).toBe(true)
    expect(admission.size).toBe(1)
  })

  it('proves MET-RED-014 keeps chunk assembly in the D13 framer owner', () => {
    const framer = createStringFramer({ chunkBytes: 1, maxMessageBytes: 8 })
    const context = { source: 'peer', messageId: 'candidate-014' }
    const frames = framer.frame('ab', context)
    expect(framer.accept(frames[0], context)).toEqual({ status: 'pending' })
    expect(framer.accept(frames[1], context)).toEqual({ status: 'complete', value: 'ab' })
  })

  it('proves MET-RED-015 installs dependencies before the requesting feature', async () => {
    const order: string[] = []
    const dependency = defineTestRoot([], () => {
      order.push('dependency')
      return Object.freeze({})
    })
    const dependent = defineRpcFeature(
      {
        publicKeys: [],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      () => {
        order.push('dependent')
        return Object.freeze({ prepare: () => Object.freeze({ public: {} }) })
      },
      { dependency }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-dependent': dependent }
    )
    expect(order).toEqual(['dependency', 'dependent'])
    await endpoint.dispose()
  })

  it('proves MET-RED-017 accepts only package-minted feature definitions', async () => {
    const feature = defineTestRoot([], () => Object.freeze({}))
    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        { feature: { ...feature } }
      )
    ).rejects.toMatchObject({ code: 'INVALID_OPTION' })
  })

  it('proves MET-RED-018 rejects shadow public writes before install effects', async () => {
    let installs = 0
    const first = defineTestRoot(['shadow'], () => {
      installs += 1
      return Object.freeze({ shadow: () => undefined })
    })
    const second = defineTestRoot(['shadow'], () => {
      installs += 1
      return Object.freeze({ shadow: () => undefined })
    })
    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        { 'first-party-first': first, 'first-party-second': second }
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(installs).toBe(0)
  })

  it('proves MET-RED-019 keeps shared ports endpoint-local and symbol-keyed', async () => {
    const [firstTransport, secondTransport] = createMemoryTransportPair()
    const sharedKey = Symbol('candidate-019')
    const firstHost = createWebRpcPluginHost(
      'candidate-019-first',
      firstTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    )
    const secondHost = createWebRpcPluginHost(
      'candidate-019-second',
      secondTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    )
    await firstHost.use({
      name: 'candidate-019-owner',
      shared: () => ({ [sharedKey]: 'owned' }),
      install: () => ({})
    })
    expect(firstHost.getShared(sharedKey)).toBe('owned')
    expect(secondHost.getShared(sharedKey)).toBeUndefined()
    await Promise.all([firstHost.dispose(), secondHost.dispose()])
  })

  it('proves MET-RED-020 exposes provider behavior without provider controllers', async () => {
    const endpoint = await createProviderEndpoint(createConfig(() => undefined))
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
    expect('providerCancellation' in endpoint).toBe(false)
    expect('abortProvider' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('proves MET-RED-023 uses one absolute construction deadline', () => {
    let now = 1_000
    const control = createConstructionControl({
      signal: new AbortController().signal as IWebRpcAbortSignal,
      timeoutMs: 100,
      time: {
        now: () => now,
        setTimeout: () => ({ clear: () => undefined }),
        clearTimeout: (timer) => timer.clear(),
        dispose: () => undefined
      }
    })
    expect(control.deadlineAt).toBe(1_100)
    now = 1_075
    expect(control.remaining()).toBe(25)
    expect(control.deadlineAt).toBe(1_100)
    control.close()
  })

  it('proves MET-RED-025 injects one canonical dependency owner without public leakage', async () => {
    const owner = Object.freeze({ id: 'candidate-025-owner' })
    const dependency = defineRpcFeature(
      {
        publicKeys: [],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      () => Object.freeze({ owner, prepare: () => Object.freeze({ public: {} }) }),
      {}
    )
    const dependent = defineRpcFeature(
      {
        publicKeys: ['dependent'],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: ['dependent'],
          exposedKeys: [],
          activator: false
        }
      },
      (_core, dependencies) =>
        Object.freeze({
          prepare: () =>
            Object.freeze({ public: { dependent: () => dependencies.dependency.owner.id } })
        }),
      { dependency }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-dependent': dependent }
    )
    expect((Reflect.get(endpoint, 'dependent') as () => string)()).toBe('candidate-025-owner')
    expect(Reflect.ownKeys(endpoint)).not.toContain('candidate-025-dependency')
    await endpoint.dispose()
  })

  it('proves MET-RED-026 slim features use canonical lifecycle owners', async () => {
    const endpoint = await createClientEndpoint(createConfig(() => undefined))
    expect(typeof endpoint.send).toBe('function')
    expect(Object.values(SOURCES).join('\n')).not.toContain('EndpointResourceManager')
    expect(source('../src/core.ts')).toContain('host.installBatch(')
    await endpoint.dispose()
  })

  it('proves MET-RED-027 does not leak implicit dependency surfaces', async () => {
    const dependency = defineTestRoot(['hidden'], () => Object.freeze({ hidden: () => undefined }))
    const root = defineRpcFeature(
      {
        publicKeys: ['visible'],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: ['visible'],
          exposedKeys: [],
          activator: false
        }
      },
      () =>
        Object.freeze({ prepare: () => Object.freeze({ public: { visible: () => undefined } }) }),
      { dependency }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-root': root }
    )
    expect(Reflect.ownKeys(endpoint)).toEqual(['dispose', 'visible'])
    expect('hidden' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('proves MET-RED-028 gives D13 framing expiry one injected timer owner', () => {
    let timers = 0
    let clears = 0
    const framer = createStringFramer({
      chunkBytes: 1,
      maxMessageBytes: 8,
      assemblyTimeoutMs: 10,
      schedule: () => {
        timers += 1
        return Object.freeze({})
      },
      cancel: () => {
        clears += 1
      }
    })
    const context = { source: 'peer', messageId: 'candidate-028' }
    const [frame] = framer.frame('ab', context)
    framer.accept(frame, context)
    expect(timers).toBe(1)
    framer.close()
    expect(clears).toBe(1)
  })

  it('proves MET-RED-029 returns the canonical root projection without a full wrapper', async () => {
    const endpoint = await createClientEndpoint(createConfig(() => undefined))
    expect(Reflect.ownKeys(endpoint)).toEqual([
      'hooks',
      'dispose',
      'send',
      'sendAll',
      'dispatch',
      'dispatchAll'
    ])
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    expect(Object.keys(SOURCES)).not.toContain('../src/full-endpoint.ts')
    await endpoint.dispose()
  })

  it('proves MET-RED-030 uses canonical configuration error semantics', () => {
    expect(() =>
      createConstructionControl({
        signal: new AbortController().signal as IWebRpcAbortSignal,
        timeoutMs: -1
      })
    ).toThrow(expect.objectContaining({ code: WebRpcErrorCode.invalidConfig }))
    expect(source('../src/internal/construction-install.ts')).toContain('WebRpcConfigurationError')
  })

  it('proves MET-RED-032 keeps diagnostic cleanup at the Host disposal boundary', async () => {
    const cleanup = new Error('candidate-032 cleanup')
    const [transport] = createMemoryTransportPair()
    const host = createWebRpcPluginHost(
      'candidate-032',
      transport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
      () => [{ resource: 'candidate-032', error: cleanup }]
    )
    await host.use({
      name: 'candidate-032-owner',
      install: (core) => {
        core.onDispose(() => {
          throw cleanup
        })
        return {}
      }
    })
    const failure = await host.dispose().catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup,
      cleanupErrors: [{ resource: 'candidate-032', error: cleanup }]
    })
  })
})

describe('MET-RED-022/035 projection and public lifecycle surface', () => {
  it('proves MET-RED-022/035 projection avoids last-write-wins merge and returns the exact Host Promise', async () => {
    const projectionSource = source('../src/internal/endpoint-projection.ts')
    let sendCalls = 0
    const host = {
      send: () => {
        sendCalls += 1
      }
    }
    const hostPromise = Promise.resolve()
    const projection = createEndpointProjection({
      host,
      publicKeys: ['send'],
      exposedKeys: ['send'],
      on: () => undefined,
      hooks: Object.freeze({}),
      hostDispose: () => hostPromise
    }) as Readonly<{ readonly send: () => void; readonly dispose: () => Promise<void> }>

    expect(projectionSource).not.toContain('Object.assign')
    expect(Object.getPrototypeOf(projection)).toBeNull()
    expect(Object.isFrozen(projection)).toBe(true)
    // 投影把可调用成员包一层，用来把宿主的 `VIEW_REVOKED` 翻译成本包的 ENDPOINT_DISPOSED；保证从
    // 「同一个引用」放宽为「同一个实现」——调用投影出的成员，被调到的必须还是原来那一个函数。
    expect(projection.send).toBe(projection.send)
    projection.send()
    expect(sendCalls).toBe(1)
    const firstDispose = projection.dispose()
    expect(projection.dispose()).toBe(firstDispose)
    expect(firstDispose).toBe(hostPromise)
    await firstDispose

    const cleanup = new Error('duplicate-owner disposal cleanup')
    const [hostTransport] = createMemoryTransportPair()
    const webRpcHost = createWebRpcPluginHost(
      'duplicate-owner-disposal',
      hostTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
      () => [{ resource: 'resource disposer', error: cleanup }]
    )
    await webRpcHost.use({
      name: 'duplicate-owner-disposal-plugin',
      install: (core) => {
        core.onDispose(() => {
          throw cleanup
        })
        return {}
      }
    })
    const hostDispose = webRpcHost.dispose()
    expect(webRpcHost.dispose()).toBe(hostDispose)
    const failure = await hostDispose.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: '@migaia/web-rpc',
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup,
      cleanupErrors: [{ resource: 'resource disposer', error: cleanup }]
    })
  })
})

describe('MET-RED-003/024/039/040 capability topology admission', () => {
  it('proves MET-RED-003/024/039/040 capability topology owns ordering and rejects conflicts before install effects', async () => {
    const installs: string[] = []
    let subscriptions = 0
    topologyMock.build.mockClear()
    const actualTopology = topologyMock.actual
    expect(actualTopology).toBeDefined()
    topologyMock.build.mockImplementationOnce((nodes, onUnknownProvider, onCycle, onInvalid) => {
      const topology = actualTopology!(nodes, onUnknownProvider, onCycle, onInvalid)
      return { ...topology, ordered: topology.ordered.toReversed() }
    })
    const first = defineTestRoot([], () => {
      installs.push('first')
      return Object.freeze({})
    })
    const second = defineTestRoot([], () => {
      installs.push('second')
      return Object.freeze({})
    })
    const reversedEndpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      { 'first-party-first': first, 'first-party-second': second }
    )
    expect(installs).toEqual(['first', 'second'])
    expect(topologyMock.build).toHaveBeenCalled()
    await reversedEndpoint.dispose()
    installs.length = 0

    const dependency = defineTestRoot([], () => {
      installs.push('dependency')
      return Object.freeze({})
    })
    const dependent = defineRpcFeature(
      {
        publicKeys: [],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      () => {
        installs.push('dependent')
        return Object.freeze({ prepare: () => Object.freeze({ public: {} }) })
      },
      { dependency }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      { 'first-party-dependent': dependent }
    )
    expect(installs).toEqual(['dependency', 'dependent'])
    expect(subscriptions).toBe(0)
    await endpoint.dispose()

    let conflictInstalls = 0
    const blocked = defineTestRoot(['conflict'], () => {
      conflictInstalls += 1
      return Object.freeze({ conflict: () => undefined })
    })
    const conflicting = defineRpcFeature(
      {
        publicKeys: ['conflict'],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: ['conflict'],
          exposedKeys: [],
          activator: false
        }
      },
      () => {
        conflictInstalls += 1
        return Object.freeze({
          prepare: () => Object.freeze({ public: { conflict: () => undefined } })
        })
      },
      {}
    )
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        { 'first-party-blocked': blocked, 'first-party-conflicting': conflicting }
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(conflictInstalls).toBe(0)
    expect(subscriptions).toBe(0)
    expect(topologyMock.build).toHaveBeenCalled()
  })
})
