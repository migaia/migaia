import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { createFullEndpoint } from '../../src/full.js'
import { defineFeature } from '../../src/feature.js'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../../src/core.js'
import { WebRpcErrorCode } from '../../src/errors.js'
import { connect } from '../../src/middleware/connect.js'

let configSequence = 0

/** Creates a memory configuration whose subscription is observable before any install side effect. */
function createConfig(onSubscribe: () => void): IWebRpcCoreConfig {
  const [transport] = createMemoryTransportPair()
  return {
    id: `topology-adapter-${++configSequence}`,
    transport: {
      ...transport,
      subscribe: (listener) => {
        onSubscribe()
        return transport.subscribe(listener)
      }
    },
    middlewares: [connect()]
  }
}

describe('capability topology adapter', () => {
  it('WRC-C-T71 preserves transitive order while keeping one installer path', async () => {
    const installs: string[] = []
    const provider = defineFeature(() => {
      installs.push('provider')
      return {}
    })
    const dependent = defineFeature(
      (_core, dependencies) => {
        void dependencies.provider
        installs.push('dependent')
        return {}
      },
      { provider }
    )

    const endpoint = await createFullEndpoint({
      ...createConfig(() => undefined),
      features: [dependent] as const
    })
    expect(installs).toEqual(['provider', 'dependent'])
    await endpoint.dispose()
  })

  it('WRC-C-T71 rejects undefined native dependencies and retired arrays before installation', async () => {
    let subscriptions = 0
    let installs = 0
    expect(() =>
      defineFeature(
        (_core, dependencies) => {
          void dependencies.absent
          installs += 1
          return {}
        },
        { absent: undefined as never }
      )
    ).toThrow(TypeError)
    /** Retired token arrays must reject before graph inspection, subscription, or installation. */
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [] as never
      )
    ).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig
    })
    expect(subscriptions).toBe(0)
    expect(installs).toBe(0)
  })
})
