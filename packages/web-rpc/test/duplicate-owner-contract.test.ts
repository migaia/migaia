import { describe, expect, it, vi } from 'vitest'
import {
  createComposedEndpoint,
  type IWebRpcCoreConfig,
  type IWebRpcKernelSurface
} from '../src/core.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { outbound } from '../src/features/outbound.js'
import { provider } from '../src/features/provider.js'
import {
  defineEndpointModule,
  snapshotEndpointModules,
  withEndpointModuleOwner
} from '../src/internal/endpoint-modules.js'
import { createEndpointProjection } from '../src/internal/endpoint-projection.js'
import { WebRpcErrorCode, WebRpcLifecycleError } from '../src/errors.js'
import { connect } from '../src/middleware/connect.js'
import { createConstructionControl } from '../src/internal/construction-install.js'
import { WebRpcPluginHost } from '../src/internal/web-rpc-plugin-host.js'
import { ReplayWindow } from '../src/internal/replay.js'
import { PeerRegistry } from '../src/internal/peers.js'
import { ProviderAdmissionRegistry } from '../src/internal/provider-admission.js'
import { ChunkAssembler } from '../src/internal/chunk.js'
import type { IWebRpcAbortSignal, IWebRpcPlugin } from '../src/typing.js'

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

/** Creates a minimal test module with explicit dependency and conflict claims. */
function moduleWith(
  key: string,
  install: () => Promise<{ readonly dispose: () => void }>,
  requires: readonly (string | ReturnType<typeof defineEndpointModule>)[] = [],
  conflicts: readonly string[] = []
) {
  return defineEndpointModule<IWebRpcCoreConfig, IWebRpcKernelSurface>(
    key,
    async () => install(),
    requires,
    conflicts
  )
}

describe('candidate-specific duplicate-owner contracts', () => {
  it('proves MET-RED-001 keeps one canonical endpoint root owner', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [outbound()]
    )
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    expect(Object.isFrozen(endpoint)).toBe(true)
    expect(Object.keys(SOURCES)).not.toContain('../src/endpoint.ts')
    await endpoint.dispose()
  })

  it('proves MET-RED-002 installs a feature without constructing a nested endpoint', async () => {
    let installs = 0
    const feature = defineEndpointModule<IWebRpcCoreConfig, { featureValue: () => number }>(
      'candidate-002',
      async () => {
        installs += 1
        return { featureValue: () => 2 }
      },
      [],
      [],
      { publicKeys: ['featureValue'], exposedKeys: ['featureValue'] }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [feature]
    )
    expect(installs).toBe(1)
    expect(endpoint.featureValue()).toBe(2)
    expect(source('../src/core.ts')).not.toContain('new WebRpcEndpoint')
    await endpoint.dispose()
  })

  it('proves MET-RED-004 composes independent feature surfaces through one root', async () => {
    const first = defineEndpointModule<IWebRpcCoreConfig, { first: () => string }>(
      'candidate-004-first',
      async () => ({ first: () => 'first' }),
      [],
      [],
      { publicKeys: ['first'], exposedKeys: ['first'] }
    )
    const second = defineEndpointModule<IWebRpcCoreConfig, { second: () => string }>(
      'candidate-004-second',
      async () => ({ second: () => 'second' }),
      [],
      [],
      { publicKeys: ['second'], exposedKeys: ['second'] }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [first, second]
    )
    expect([endpoint.first(), endpoint.second()]).toEqual(['first', 'second'])
    expect(Object.getPrototypeOf(endpoint)).toBeNull()
    await endpoint.dispose()
  })

  it('proves MET-RED-005 uses the canonical transport and outbound sender', async () => {
    let subscriptions = 0
    const endpoint = await createComposedEndpoint(
      createConfig(() => {
        subscriptions += 1
      }),
      [outbound()]
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
    const host = new WebRpcPluginHost(
      'candidate-007',
      transport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined
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
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [outbound()]
    )
    expect(source('../src/internal/web-rpc-plugin-host.ts')).toContain('extends PluginHost')
    expect(Object.values(SOURCES).join('\n')).not.toContain('@migaia/middleware-pipeline')
    expect('usePipeline' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('proves MET-RED-009 invokes current middleware directly without a legacy adapter', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined, [connect()]),
      [outbound()]
    )
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

  it('proves MET-RED-014 keeps chunk assembly in ChunkAssembler', () => {
    const chunks = new ChunkAssembler({ chunkSize: 8 })
    expect(
      chunks.accept({ messageId: 'candidate-014', index: 0, total: 2, data: 'a' }, 'peer')
    ).toBeUndefined()
    expect(
      chunks.accept({ messageId: 'candidate-014', index: 1, total: 2, data: 'b' }, 'peer')
    ).toBe('ab')
    expect(chunks.size).toBe(0)
  })

  it('proves MET-RED-015 installs dependencies before the requesting feature', async () => {
    const order: string[] = []
    const dependency = moduleWith('candidate-015-dependency', async () => {
      order.push('dependency')
      return { dispose: () => undefined }
    })
    const dependent = moduleWith(
      'candidate-015-dependent',
      async () => {
        order.push('dependent')
        return { dispose: () => undefined }
      },
      [dependency]
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [dependent]
    )
    expect(order).toEqual(['dependency', 'dependent'])
    await endpoint.dispose()
  })

  it('proves MET-RED-017 accepts only package-minted feature definitions', () => {
    const token = moduleWith('candidate-017', async () => ({ dispose: () => undefined }))
    expect(snapshotEndpointModules([token]).map(({ key }) => key)).toEqual(['candidate-017'])
    expect(() => snapshotEndpointModules([{ ...token }])).toThrow(TypeError)
  })

  it('proves MET-RED-018 rejects shadow public writes before install effects', async () => {
    let installs = 0
    const first = defineEndpointModule<IWebRpcCoreConfig, { shadow: () => void }>(
      'candidate-018-first',
      async () => {
        installs += 1
        return { shadow: () => undefined }
      },
      [],
      [],
      { publicKeys: ['shadow'] }
    )
    const second = defineEndpointModule<IWebRpcCoreConfig, { shadow: () => void }>(
      'candidate-018-second',
      async () => {
        installs += 1
        return { shadow: () => undefined }
      },
      [],
      [],
      { publicKeys: ['shadow'] }
    )
    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        [first, second]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(installs).toBe(0)
  })

  it('proves MET-RED-019 keeps shared ports endpoint-local and symbol-keyed', async () => {
    const [firstTransport, secondTransport] = createMemoryTransportPair()
    const sharedKey = Symbol('candidate-019')
    const firstHost = new WebRpcPluginHost(
      'candidate-019-first',
      firstTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined
    )
    const secondHost = new WebRpcPluginHost(
      'candidate-019-second',
      secondTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined
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
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [provider()]
    )
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
    const dependency = defineEndpointModule<IWebRpcCoreConfig, Record<string, never>>(
      'candidate-025-dependency',
      async () => withEndpointModuleOwner({}, owner)
    )
    const dependent = defineEndpointModule<IWebRpcCoreConfig, { dependent: () => string }>(
      'candidate-025-dependent',
      async () => ({ dependent: () => owner.id }),
      [dependency],
      [],
      { publicKeys: ['dependent'], exposedKeys: ['dependent'] }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [dependent]
    )
    expect(endpoint.dependent()).toBe('candidate-025-owner')
    expect(Reflect.ownKeys(endpoint)).not.toContain('candidate-025-dependency')
    await endpoint.dispose()
  })

  it('proves MET-RED-026 slim features use canonical lifecycle owners', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [outbound()]
    )
    expect(typeof endpoint.send).toBe('function')
    expect(Object.values(SOURCES).join('\n')).not.toContain('EndpointResourceManager')
    expect(source('../src/core.ts')).toContain('host.installBatch(')
    await endpoint.dispose()
  })

  it('proves MET-RED-027 does not leak implicit dependency surfaces', async () => {
    const dependency = defineEndpointModule<IWebRpcCoreConfig, { hidden: () => void }>(
      'candidate-027-hidden',
      async () => ({ hidden: () => undefined }),
      [],
      [],
      { publicKeys: ['hidden'], exposedKeys: ['hidden'] }
    )
    const root = defineEndpointModule<IWebRpcCoreConfig, { visible: () => void }>(
      'candidate-027-root',
      async () => ({ visible: () => undefined }),
      [dependency],
      [],
      { publicKeys: ['visible'], exposedKeys: ['visible'] }
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [root]
    )
    expect(Reflect.ownKeys(endpoint)).toEqual(['on', 'hooks', 'dispose', 'visible'])
    expect('hidden' in endpoint).toBe(false)
    await endpoint.dispose()
  })

  it('proves MET-RED-028 gives chunk expiry one injected timer owner', () => {
    let timers = 0
    let clears = 0
    const chunks = new ChunkAssembler(
      { assemblyTimeoutMs: 10 },
      {
        now: () => 0,
        setTimeout: () => {
          timers += 1
          return {
            clear: () => {
              clears += 1
            }
          }
        },
        clearTimeout: (timer) => timer.clear()
      }
    )
    chunks.accept({ messageId: 'candidate-028', index: 0, total: 2, data: 'a' }, 'peer')
    expect(timers).toBe(1)
    chunks.clear()
    expect(clears).toBe(1)
  })

  it('proves MET-RED-029 returns the canonical root projection without a full wrapper', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [outbound()]
    )
    expect(Reflect.ownKeys(endpoint)).toEqual([
      'on',
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
    const host = new WebRpcPluginHost(
      'candidate-032',
      transport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      {},
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
    const host = { send: () => undefined }
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
    expect(projection.send).toBe(host.send)
    const firstDispose = projection.dispose()
    expect(projection.dispose()).toBe(firstDispose)
    expect(firstDispose).toBe(hostPromise)
    await firstDispose

    const cleanup = new Error('duplicate-owner disposal cleanup')
    const [hostTransport] = createMemoryTransportPair()
    const webRpcHost = new WebRpcPluginHost(
      'duplicate-owner-disposal',
      hostTransport,
      createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
      () => undefined,
      {},
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
    const modules = source('../src/internal/endpoint-modules.ts')
    const installs: string[] = []
    let subscriptions = 0
    topologyMock.build.mockClear()
    const actualTopology = topologyMock.actual
    expect(actualTopology).toBeDefined()
    topologyMock.build.mockImplementationOnce((nodes, onUnknownProvider, onCycle, onInvalid) => {
      const topology = actualTopology!(nodes, onUnknownProvider, onCycle, onInvalid)
      return { ...topology, ordered: topology.ordered.toReversed() }
    })
    const first = moduleWith('duplicate-owner-first', async () => {
      installs.push('first')
      return { dispose: () => undefined }
    })
    const second = moduleWith('duplicate-owner-second', async () => {
      installs.push('second')
      return { dispose: () => undefined }
    })
    const reversedEndpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      [first, second]
    )
    expect(installs).toEqual(['second', 'first'])
    expect(topologyMock.build).toHaveBeenCalledTimes(1)
    expect(topologyMock.build.mock.calls[0]?.[0].map(({ id }) => id)).toEqual([
      'duplicate-owner-first',
      'duplicate-owner-second'
    ])
    await reversedEndpoint.dispose()
    installs.length = 0

    const dependency = moduleWith('duplicate-owner-dependency', async () => {
      installs.push('dependency')
      return { dispose: () => undefined }
    })
    const dependent = moduleWith(
      'duplicate-owner-dependent',
      async () => {
        installs.push('dependent')
        return { dispose: () => undefined }
      },
      [dependency]
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      [dependent]
    )
    expect(installs).toEqual(['dependency', 'dependent'])
    expect(subscriptions).toBe(0)
    await endpoint.dispose()

    let conflictInstalls = 0
    const blocked = moduleWith('duplicate-owner-blocked', async () => {
      conflictInstalls += 1
      return { dispose: () => undefined }
    })
    const conflicting = moduleWith(
      'duplicate-owner-conflicting',
      async () => {
        conflictInstalls += 1
        return { dispose: () => undefined }
      },
      [],
      ['duplicate-owner-blocked']
    )
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [blocked, conflicting]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.capabilityConflict })
    expect(conflictInstalls).toBe(0)
    expect(subscriptions).toBe(0)
    expect(modules).toContain('buildCapabilityTopology')
    expect(modules).not.toContain('CapabilityGraph')
    expect(modules).not.toMatch(/while\s*\(definitions\.length\)/)
    expect(modules).not.toMatch(/findIndex\s*\(/)
  })
})
