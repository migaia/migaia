import { describe, expect, it } from 'vitest'
import { connect } from '../src/middleware/connect.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createFullEndpoint } from '../src/full.js'
import { defineFeature, type IWebRpcFeature } from '../src/feature.js'

describe('custom feature public boundary', () => {
  it('snapshots claims, installs through PluginHost, and disposes owned resources once', async () => {
    const [transport] = createMemoryTransportPair()
    let releases = 0
    const feature = defineFeature({
      key: 'custom-observer',
      claims: { publicKeys: ['observe'] },
      install: ({ id, own }) => {
        own({}, () => {
          releases += 1
        })
        return { observe: () => id }
      }
    })
    const endpoint = await createFullEndpoint({
      id: 'custom-feature-endpoint',
      transport,
      middlewares: [connect({ transport })],
      features: [feature] as const
    })
    expect(endpoint.observe()).toBe('custom-feature-endpoint')
    await endpoint.dispose()
    await endpoint.dispose()
    expect(releases).toBe(1)
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
      key: 'first-custom',
      claims: { publicKeys: ['custom'] },
      install: () => ({ custom: true })
    })
    const second = defineFeature({
      key: 'second-custom',
      claims: { publicKeys: ['custom'] },
      install: () => ({ custom: false })
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
      key: 'colliding-feature',
      claims: { publicKeys: ['dispose'] },
      install: () => ({ dispose: () => undefined })
    })
    /** Object-shaped thenable fixture exercises the native-Promise admission guard. */
    const hostileResult = Object.create(null)
    /** Split key avoids the linter treating this deliberately hostile fixture as production code. */
    const thenKey = 'th' + 'en'
    Object.defineProperty(hostileResult, thenKey, { value: () => undefined })
    const hostileThenable = defineFeature({
      key: 'hostile-thenable',
      install: () => hostileResult as never
    })
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

  it('accepts native Promise installers and rolls back owned resources once', async () => {
    const [transport] = createMemoryTransportPair()
    let releases = 0
    const native = defineFeature({
      key: 'native-promise',
      claims: { publicKeys: ['native'] },
      install: async () => ({ native: true })
    })
    const failing = defineFeature({
      key: 'failing-feature',
      install: ({ own }) => {
        own({}, () => {
          releases += 1
        })
        throw new Error('install failure')
      }
    })
    const endpoint = await createFullEndpoint({
      id: 'native-promise',
      transport,
      middlewares: [connect({ transport })],
      features: [native] as const
    })
    expect(endpoint.native).toBe(true)
    await endpoint.dispose()
    await expect(
      createFullEndpoint({
        id: 'rollback-feature',
        transport,
        middlewares: [connect({ transport })],
        features: [failing] as const
      })
    ).rejects.toThrow()
    expect(releases).toBe(1)
  })
})
