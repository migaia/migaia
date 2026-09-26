import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../../src/core/client.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createFullEndpoint } from '../../src/core/full.js'
import { defineRpcFeature } from '../../src/core/internal/define-rpc-feature.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import type { IRpcCoreConfig } from '../../src/core/composed.js'
import type { IRpcPluginInstallScope } from '../../src/core/typing.js'
import { connect } from '../../src/core/middleware/connect.js'
import { InboundIdentityCoordinator } from '../../src/core/internal/inbound-identity.js'
import { RpcVariationCoordinator } from '../../src/core/internal/variation-coordinator.js'

let configSequence = 0

/** Builds a minimal composition config while exposing subscription side effects. */
function createConfig(
  onSubscribe: () => void,
  extraMiddlewares: readonly IRpcCoreConfig['middlewares'][number][] = []
): IRpcCoreConfig {
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

/** Creates a first-party native prepare root whose cleanup is owned by the real construction scope. */
function definePrepareRoot(install: (scope: IRpcPluginInstallScope) => object) {
  return defineRpcFeature(
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
    () => Object.freeze({ prepare: install }),
    {}
  )
}

describe('composition topology and rollback', () => {
  it('admits one shared source identity lease and rejects forged source proof', async () => {
    const accepted = {}
    const coordinator = new InboundIdentityCoordinator({
      now: () => Date.now(),
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
      now: () => Date.now(),
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
      now: () => Date.now(),
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
      now: () => Date.now(),
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
      now: () => Date.now(),
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
      now: () => Date.now(),
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
      now: () => Date.now(),
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
    const owner = new InboundIdentityCoordinator({ now: () => Date.now(), platform: 'Memory' })
    const foreign = new InboundIdentityCoordinator({ now: () => Date.now(), platform: 'Memory' })
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
    const coordinator = new RpcVariationCoordinator(
      () => Date.now(),
      () => Date.now()
    )
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

    const endpoint = await createProviderEndpoint(createConfig(() => subscriptions++))
    expect(endpoint.send).toEqual(expect.any(Function))
    expect('provide' in endpoint).toBe(true)
    expect(subscriptions).toBe(1)
    await endpoint.dispose()
  })

  it('composes all five first-party features with one transport subscription', async () => {
    let subscriptions = 0
    const endpoint = await createFullEndpoint(createConfig(() => subscriptions++))

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
        installations += 1
        return Object.freeze({
          prepare: () => Object.freeze({ public: { conflict: () => undefined } })
        })
      },
      {}
    )
    const blocked = defineRpcFeature(
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
        installations += 1
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
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
    expect(installations).toBe(0)
  })

  it('keeps coordinator lifecycle ownership when composing provider surface', async () => {
    const endpoint = await createProviderEndpoint(createConfig(() => undefined))
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
    } as unknown as Readonly<Record<string, import('../../src/core/feature.js').IRpcFeature>>

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        hostile
      )
    ).rejects.toMatchObject({
      code: RpcCoreErrorCode.invalidConfig
    })
    expect(subscriptions).toBe(0)
  })

  it('rejects a missing native prepare output before transport subscription', async () => {
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
      () => Object.freeze({}),
      {}
    )
    let subscriptions = 0

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        { 'first-party-dependent': dependent }
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
  })

  it('rejects retired iterable roots and malformed native roots before transport subscription', async () => {
    let subscriptions = 0
    const root = definePrepareRoot(() => ({}))
    const malformed = defineRpcFeature(
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
      () => Object.freeze({}),
      {}
    )

    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [root] as unknown as Readonly<
          Record<string, import('../../src/core/feature.js').IRpcFeature>
        >
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        { 'first-party-malformed': malformed }
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
    expect(subscriptions).toBe(0)
  })

  it('rolls back installed modules in reverse order and preserves primary failure', async () => {
    const disposed: string[] = []
    const first = definePrepareRoot((scope) => {
      scope.own('first', () => {
        disposed.push('first')
      })
      return {}
    })
    const second = definePrepareRoot((scope) => {
      scope.own('second', () => {
        disposed.push('second')
      })
      return {}
    })
    const failing = definePrepareRoot(() => {
      throw new Error('primary install failure')
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        {
          'first-party-first': first,
          'first-party-second': second,
          'first-party-failing': failing
        }
      )
    ).rejects.toMatchObject({ message: 'primary install failure' })
    expect(disposed).toEqual(['second', 'first'])
  })

  it('continues rollback after disposer failures and keeps primary plus secondary errors reachable', async () => {
    const primary = new Error('primary install failure')
    const firstCleanup = new Error('first cleanup failure')
    const secondCleanup = new Error('second cleanup failure')
    const disposed: string[] = []
    const first = definePrepareRoot((scope) => {
      scope.own('first', () => {
        disposed.push('first')
        throw firstCleanup
      })
      return {}
    })
    const second = definePrepareRoot((scope) => {
      scope.own('second', () => {
        disposed.push('second')
        throw secondCleanup
      })
      return {}
    })
    const failing = definePrepareRoot(() => {
      throw primary
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        {
          'first-party-first-cleanup': first,
          'first-party-second-cleanup': second,
          'first-party-failing-cleanup': failing
        }
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
    let getterReads = 0
    const getterModule = definePrepareRoot((scope) => {
      const resource: { readonly dispose?: () => void } = {}
      Object.defineProperty(resource, 'dispose', {
        get: () => {
          getterReads += 1
          throw getterFailure
        }
      })
      scope.own(resource, () => resource.dispose!())
      return {}
    })
    const asyncModule = definePrepareRoot((scope) => {
      scope.own('async-cleanup', async () => {
        disposed.push('async')
        throw rejection
      })
      return {}
    })
    const failing = definePrepareRoot(() => {
      throw primary
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined),
        {
          'first-party-getter-cleanup': getterModule,
          'first-party-async-cleanup': asyncModule,
          'first-party-primary-cleanup': failing
        }
      )
    ).rejects.toMatchObject({
      cause: primary,
      cleanupErrors: [{ error: rejection }, { error: getterFailure }]
    })
    expect(disposed).toEqual(['async'])
    expect(getterReads).toBe(1)
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
        return { extension: {}, ports: {} }
      }
    }
    const failing = definePrepareRoot(() => {
      throw new Error('installer failure')
    })

    await expect(
      createComposedEndpoint(
        createConfig(() => undefined, [trackedMiddleware]),
        { 'first-party-middleware-failing': failing }
      )
    ).rejects.toThrow('installer failure')
    expect(disposed).toBe(1)
  })

  it('accepts a surface without optional disposer or debug reader', async () => {
    const noLifecycleSurface = definePrepareRoot(() => ({}))
    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-surface-without-lifecycle': noLifecycleSurface }
    )

    await endpoint.dispose()
  })

  it('merges selected surfaces and disposes every feature once in reverse order', async () => {
    const disposed: string[] = []
    const first = defineRpcFeature(
      {
        publicKeys: ['first'],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: ['first'],
          exposedKeys: [],
          activator: false
        }
      },
      () =>
        Object.freeze({
          prepare: (scope: IRpcPluginInstallScope) => {
            scope.own('first', () => {
              disposed.push('first')
            })
            return Object.freeze({ public: { first: () => 'first' } })
          }
        }),
      {}
    )
    const second = defineRpcFeature(
      {
        publicKeys: ['second'],
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: ['second'],
          exposedKeys: [],
          activator: false
        }
      },
      () =>
        Object.freeze({
          prepare: (scope: IRpcPluginInstallScope) => {
            scope.own('second', () => {
              disposed.push('second')
            })
            return Object.freeze({ public: { second: () => 'second' } })
          }
        }),
      {}
    )

    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      { 'first-party-surface-first': first, 'first-party-surface-second': second }
    )

    expect((Reflect.get(endpoint, 'first') as () => string)()).toBe('first')
    expect((Reflect.get(endpoint, 'second') as () => string)()).toBe('second')
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
    expect(disposed).toEqual(['second', 'first'])
  })
})
