import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../src/client.js'
import { createComposedEndpoint } from '../src/core.js'
import { createProviderEndpoint } from '../src/provider.js'
import { defineEndpointModule, EndpointModuleKey } from '../src/internal/endpoint-modules.js'
import { outbound } from '../src/features/outbound.js'
import { provider } from '../src/features/provider.js'
import { discovery } from '../src/features/discovery.js'
import { control } from '../src/features/control.js'
import { canonicalChunk as chunk } from '../src/features/canonical-chunk.js'
import { WebRpcErrorCode } from '../src/errors.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import type { IWebRpcCoreConfig, IWebRpcKernelSurface } from '../src/core.js'
import { connect } from '../src/middleware/connect.js'
import { InboundIdentityCoordinator } from '../src/internal/inbound-identity.js'
import { WebRpcVariationCoordinator } from '../src/internal/variation-coordinator.js'

let configSequence = 0

/** Builds a minimal composition config while exposing subscription side effects. */
function createConfig(
  onSubscribe: () => void,
  extraMiddlewares: readonly IWebRpcCoreConfig['middlewares'][number][] = []
): IWebRpcCoreConfig {
  const [transport] = createMemoryTransportPair()
  return {
    id: `topology-${++configSequence}`,
    transport: {
      ...transport,
      subscribe: (listener) => {
        onSubscribe()
        return transport.subscribe(listener)
      }
    },
    middlewares: [connect(), ...extraMiddlewares]
  }
}

/** Creates a package-owned test module with a controlled installer and disposer. */
function moduleWith(
  key: string,
  install: () => Promise<{ readonly dispose: () => void }>,
  requires: readonly string[] = [],
  conflicts: readonly string[] = []
) {
  return defineEndpointModule<IWebRpcCoreConfig, IWebRpcKernelSurface>(
    key,
    async () => install(),
    requires,
    conflicts
  )
}

describe('composition topology and rollback', () => {
  it('admits one shared source identity lease and rejects forged source proof', async () => {
    const accepted = {}
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      sourceProof: (source) => source === accepted
    })
    await expect(
      coordinator.admit({
        senderId: 'sender',
        targetId: 'target',
        data: null,
        inbound: { data: null, source: {} }
      })
    ).resolves.toBeUndefined()
    const admission = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: accepted }
    })
    expect(admission?.token).toEqual(expect.any(String))
    admission?.release()
    coordinator.clear()
  })

  it('consumes prepared physical identity receipts once and cannot revive after clear', async () => {
    const source = {}
    const physicalData = { payload: 'physical' }
    const logicalData = { payload: 'logical' }
    let sourceReads = 0
    let dataReads = 0
    let originReads = 0
    let peerIdReads = 0
    let proofCalls = 0
    let verifyCalls = 0
    let resolveVerify: ((value: boolean) => void) | undefined
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      sourceProof: (value) => {
        proofCalls += 1
        return value === source
      },
      connect: {
        verify: (identity) => {
          verifyCalls += 1
          expect(identity).toMatchObject({
            origin: 'https://peer.test',
            peerId: 'peer'
          })
          expect(identity.data).toBe(logicalData)
          expect(identity.data).not.toBe(physicalData)
          return new Promise<boolean>((resolve) => {
            resolveVerify = resolve
          })
        }
      }
    })
    const inbound = {
      get data() {
        dataReads += 1
        return physicalData
      },
      get source() {
        sourceReads += 1
        return source
      },
      get origin() {
        originReads += 1
        return 'https://peer.test'
      },
      get peerId() {
        peerIdReads += 1
        return 'peer'
      }
    }
    const prepared = coordinator.prepareSource(inbound)
    expect(prepared).toBeDefined()
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(dataReads).toBe(1)
    expect(sourceReads).toBe(1)
    expect(originReads).toBe(1)
    expect(peerIdReads).toBe(1)
    expect(proofCalls).toBe(1)
    const request = { senderId: 'sender', targetId: 'target', data: logicalData, inbound }
    const admission = coordinator.admitPrepared(prepared!, request)
    await expect(coordinator.admitPrepared(prepared!, request)).resolves.toBeUndefined()
    expect(verifyCalls).toBe(1)
    coordinator.clear()
    resolveVerify!(true)
    await expect(admission).resolves.toBeUndefined()
    await expect(
      coordinator.admit({ senderId: 'sender', targetId: 'target', data: null, inbound })
    ).resolves.toBeUndefined()
  })

  it('reuses an established lease for source-less inbound messages', async () => {
    let verifyCalls = 0
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      connect: {
        verify: async () => {
          verifyCalls += 1
          return true
        }
      }
    })
    const request = { senderId: 'sender', targetId: 'target', data: null }
    const first = await coordinator.admit(request)
    const reused = await coordinator.admit(request)

    expect(first?.token).toEqual(expect.any(String))
    expect(reused?.token).toBe(first?.token)
    expect(reused?.bindingKey).toBe(first?.bindingKey)
    expect(verifyCalls).toBe(1)
    first?.release()
    reused?.release()
  })

  it('admits a deferred verification once and denies a pending receipt replay', async () => {
    let resolveVerify: ((value: boolean) => void) | undefined
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      connect: {
        verify: () =>
          new Promise<boolean>((resolve) => {
            resolveVerify = resolve
          })
      }
    })
    const request = {
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: {} }
    }
    const prepared = coordinator.prepareSource(request.inbound)!
    const admission = coordinator.admitPrepared(prepared, request)

    await expect(coordinator.admitPrepared(prepared, request)).resolves.toBeUndefined()
    resolveVerify!(true)
    await expect(admission).resolves.toMatchObject({ token: expect.any(String) })
  })

  it('preserves a verification rejection and never revives its consumed receipt', async () => {
    const rejection = new Error('verify rejection')
    let rejectVerify: ((reason: unknown) => void) | undefined
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      connect: {
        verify: () =>
          new Promise<boolean>((_resolve, reject) => {
            rejectVerify = reject
          })
      }
    })
    const request = {
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: {} }
    }
    const prepared = coordinator.prepareSource(request.inbound)!
    const admission = coordinator.admitPrepared(prepared, request)

    rejectVerify!(rejection)
    await expect(admission).rejects.toBe(rejection)
    await expect(coordinator.admitPrepared(prepared, request)).resolves.toBeUndefined()
  })

  it('does not allocate a receipt when source proof closes its owner', () => {
    let proofCalls = 0
    let coordinator: InboundIdentityCoordinator
    coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      sourceProof: () => {
        proofCalls += 1
        coordinator.clear()
        return true
      }
    })
    expect(coordinator.prepareSource({ data: null, source: {} })).toBeUndefined()
    expect(proofCalls).toBe(1)
  })

  it('reuses only the exact logical and physical identity tuple', async () => {
    let verifies = 0
    const coordinator = new InboundIdentityCoordinator({
      platform: 'Memory',
      connect: {
        verify: async () => {
          verifies += 1
          return true
        }
      }
    })
    const firstSource = {}
    const first = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: firstSource, origin: 'one', peerId: 'peer-one' }
    })
    const reused = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: firstSource, origin: 'one', peerId: 'peer-one' }
    })
    const changed = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: {}, origin: 'one', peerId: 'peer-one' }
    })
    const changedOrigin = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: firstSource, origin: 'two', peerId: 'peer-one' }
    })
    const changedPeer = await coordinator.admit({
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: firstSource, origin: 'one', peerId: 'peer-two' }
    })
    expect(reused?.token).toBe(first?.token)
    expect(reused?.bindingKey).toBe(first?.bindingKey)
    expect(changed?.bindingKey).not.toBe(first?.bindingKey)
    expect(changedOrigin?.bindingKey).not.toBe(first?.bindingKey)
    expect(changedPeer?.bindingKey).not.toBe(first?.bindingKey)
    expect(verifies).toBe(4)
    first?.release()
    reused?.release()
    changed?.release()
    changedOrigin?.release()
    changedPeer?.release()
  })

  it('rejects copied, foreign, replayed, and terminal prepared receipts', async () => {
    const request = {
      senderId: 'sender',
      targetId: 'target',
      data: null,
      inbound: { data: null, source: {} }
    }
    const owner = new InboundIdentityCoordinator({ platform: 'Memory' })
    const foreign = new InboundIdentityCoordinator({ platform: 'Memory' })
    const prepared = owner.prepareSource(request.inbound)!
    await expect(foreign.admitPrepared(prepared, request)).resolves.toBeUndefined()
    await expect(owner.admitPrepared({ ...prepared }, request)).resolves.toBeUndefined()
    await expect(owner.admitPrepared(prepared, request)).resolves.toMatchObject({
      token: expect.any(String)
    })
    await expect(owner.admitPrepared(prepared, request)).resolves.toBeUndefined()
    const terminal = owner.prepareSource(request.inbound)!
    owner.clear()
    await expect(owner.admitPrepared(terminal, request)).resolves.toBeUndefined()
  })

  it('keeps variation route ownership single-provider and replay-admitted', async () => {
    const coordinator = new WebRpcVariationCoordinator(() => Date.now())
    const received: string[] = []
    coordinator.register('abort', (_message, peerKey) => {
      received.push(peerKey)
    })
    await expect(coordinator.dispatch('abort', 'task', {}, 'peer')).resolves.toBe(true)
    await expect(coordinator.dispatch('abort', 'task', {}, 'peer')).resolves.toBe(false)
    expect(received).toEqual(['peer'])
    coordinator.clear()
  })

  it('accepts single-feature client and provider presets despite unselected conflicts', async () => {
    const client = await createClientEndpoint(createConfig(() => undefined))
    const provider = await createProviderEndpoint(createConfig(() => undefined))

    expect(client.send).toEqual(expect.any(Function))
    expect(provider.provide).toEqual(expect.any(Function))
    await client.dispose()
    await provider.dispose()
  })

  it('accepts provider dependency closure without a duplicate outbound owner', async () => {
    let subscriptions = 0

    const endpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      [outbound(), provider()]
    )
    expect(endpoint.send).toEqual(expect.any(Function))
    expect('provide' in endpoint).toBe(true)
    expect(subscriptions).toBe(1)
    await endpoint.dispose()
  })

  it('composes all five first-party features with one transport subscription', async () => {
    let subscriptions = 0
    const endpoint = await createComposedEndpoint(
      createConfig(() => subscriptions++),
      [outbound(), provider(), discovery(), control(), chunk()] as const
    )

    expect(endpoint.send).toEqual(expect.any(Function))
    expect(endpoint.provide).toEqual(expect.any(Function))
    expect(endpoint.connect).toMatchObject({ getServerList: expect.any(Function) })
    expect(endpoint.discovery).toMatchObject({ getServerList: expect.any(Function) })
    expect(subscriptions).toBe(1)
    await endpoint.dispose()
  })

  it('rejects a declared directional conflict before subscription or installation', async () => {
    let subscriptions = 0
    let installations = 0
    const conflicting = moduleWith(
      'conflicting',
      async () => {
        installations += 1
        return { dispose: () => undefined }
      },
      [],
      ['blocked']
    )
    const blocked = moduleWith('blocked', async () => {
      installations += 1
      return { dispose: () => undefined }
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [blocked, conflicting]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.capabilityConflict })
    expect(subscriptions).toBe(0)
    expect(installations).toBe(0)
  })

  it('keeps coordinator lifecycle ownership when composing provider surface', async () => {
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [provider()]
    )
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
  })

  it('rejects hostile module iteration before transport subscription', async () => {
    let subscriptions = 0
    const hostile = {
      *[Symbol.iterator](): IterableIterator<never> {
        throw new Error('iterator failure')
      }
    } as unknown as readonly ReturnType<typeof moduleWith>[]

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        hostile
      )
    ).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig,
      cause: expect.any(Error)
    })
    expect(subscriptions).toBe(0)
  })

  it('rejects missing requires before transport subscription', async () => {
    const dependent = moduleWith('dependent', async () => ({ dispose: () => undefined }), [
      EndpointModuleKey.outbound
    ])
    let subscriptions = 0

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [dependent]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
  })

  it('rejects duplicate and cyclic topology before transport subscription', async () => {
    let subscriptions = 0
    const duplicate = moduleWith('duplicate', async () => ({ dispose: () => undefined }))
    const cycleA = moduleWith('cycle-a', async () => ({ dispose: () => undefined }), ['cycle-b'])
    const cycleB = moduleWith('cycle-b', async () => ({ dispose: () => undefined }), ['cycle-a'])

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [duplicate, duplicate]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.capabilityConflict })
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [cycleA, cycleB]
      )
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
  })

  it('rolls back installed modules in reverse order and preserves primary failure', async () => {
    const disposed: string[] = []
    const first = moduleWith('first', async () => ({ dispose: () => disposed.push('first') }))
    const second = moduleWith('second', async () => ({ dispose: () => disposed.push('second') }))
    const failing = moduleWith('failing', async () => {
      throw new Error('primary install failure')
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        [first, second, failing]
      )
    ).rejects.toMatchObject({ message: 'primary install failure' })
    expect(disposed).toEqual(['second', 'first'])
  })

  it('continues rollback after disposer failures and keeps primary plus secondary errors reachable', async () => {
    const primary = new Error('primary install failure')
    const firstCleanup = new Error('first cleanup failure')
    const secondCleanup = new Error('second cleanup failure')
    const disposed: string[] = []
    const first = moduleWith('first-cleanup', async () => ({
      dispose: () => {
        disposed.push('first')
        throw firstCleanup
      }
    }))
    const second = moduleWith('second-cleanup', async () => ({
      dispose: () => {
        disposed.push('second')
        throw secondCleanup
      }
    }))
    const failing = moduleWith('failing-cleanup', async () => {
      throw primary
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        [first, second, failing]
      )
    ).rejects.toMatchObject({
      message: expect.any(String),
      cause: primary,
      cleanupErrors: [{ error: secondCleanup }, { error: firstCleanup }]
    })
    expect(disposed).toEqual(['second', 'first'])
  })

  it('contains hostile disposer getters and asynchronous cleanup rejection', async () => {
    const primary = new Error('primary install failure')
    const getterFailure = new Error('dispose getter failure')
    const rejection = new Error('async cleanup failure')
    const disposed: string[] = []
    const getterModule = defineEndpointModule<IWebRpcCoreConfig, object>(
      'getter-cleanup',
      async () => {
        const surface: { readonly dispose?: () => void } = {}
        Object.defineProperty(surface, 'dispose', {
          get: () => {
            throw getterFailure
          }
        })
        return surface
      }
    )
    const asyncModule = defineEndpointModule<IWebRpcCoreConfig, object>(
      'async-cleanup',
      async () => ({
        dispose: async () => {
          disposed.push('async')
          throw rejection
        }
      })
    )
    const failing = moduleWith('primary-cleanup', async () => {
      throw primary
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        [getterModule, asyncModule, failing]
      )
    ).rejects.toMatchObject({
      cause: primary,
      cleanupErrors: [
        { resource: 'endpoint-module-0', error: rejection },
        { resource: 'endpoint-module-1', error: getterFailure }
      ]
    })
    expect(disposed).toEqual(['async'])
  })

  it('disposes prepared middleware when a non-outbound installer fails', async () => {
    let disposed = 0
    const trackedMiddleware = {
      name: 'tracked-middleware',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      install: (scope: { own<T>(resource: T, release: () => void): T }) => {
        scope.own({}, () => {
          disposed += 1
        })
        return { extension: {}, shared: {} }
      }
    }
    const failing = moduleWith('middleware-failing', async () => {
      throw new Error('installer failure')
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined, [trackedMiddleware]),
        [failing]
      )
    ).rejects.toThrow('installer failure')
    expect(disposed).toBe(1)
  })

  it('accepts a surface without optional disposer or debug reader', async () => {
    const noLifecycleSurface = defineEndpointModule<IWebRpcCoreConfig, object>(
      'surface-without-lifecycle',
      async () => ({})
    )
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [noLifecycleSurface]
    )

    await endpoint.dispose()
  })

  it('merges selected surfaces and disposes every feature once in reverse order', async () => {
    const disposed: string[] = []
    const first = defineEndpointModule<IWebRpcCoreConfig, { readonly first: () => string }>(
      'surface-first',
      async () => ({
        first: () => 'first',
        dispose: () => disposed.push('first')
      }),
      [],
      [],
      { publicKeys: ['first'] }
    )
    const second = defineEndpointModule<IWebRpcCoreConfig, { readonly second: () => string }>(
      'surface-second',
      async () => ({
        second: () => 'second',
        dispose: () => disposed.push('second')
      }),
      [],
      [],
      { publicKeys: ['second'] }
    )

    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [first, second]
    )

    expect(endpoint.first()).toBe('first')
    expect(endpoint.second()).toBe('second')
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
    expect(disposed).toEqual(['second', 'first'])
  })
})
