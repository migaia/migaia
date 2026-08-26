import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import {
  createComposedEndpoint,
  type IWebRpcCoreConfig,
  type IWebRpcKernelSurface
} from '../../src/core.js'
import { defineEndpointModule } from '../../src/internal/endpoint-modules.js'
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

/** Defines a test module with a recorded installer and optional object-reference dependency. */
function moduleWith(
  key: string,
  install: () => Promise<{ readonly dispose: () => void }>,
  requires: readonly (string | ReturnType<typeof defineEndpointModule>)[] = []
) {
  return defineEndpointModule<IWebRpcCoreConfig, IWebRpcKernelSurface>(
    key,
    async () => install(),
    requires
  )
}

describe('capability topology adapter', () => {
  it('WRC-C-T71 preserves transitive order while keeping one installer path', async () => {
    const installs: string[] = []
    const provider = moduleWith('provider', async () => {
      installs.push('provider')
      return { dispose: () => undefined }
    })
    const dependent = moduleWith(
      'dependent',
      async () => {
        installs.push('dependent')
        return { dispose: () => undefined }
      },
      [provider]
    )

    const endpoint = await createComposedEndpoint(
      createConfig(() => undefined),
      [dependent]
    )
    expect(installs).toEqual(['provider', 'dependent'])
    await endpoint.dispose()
  })

  it('WRC-C-T71 fails missing and cyclic topology before subscription or installation', async () => {
    let subscriptions = 0
    let installs = 0
    const missing = moduleWith(
      'missing-dependent',
      async () => {
        installs += 1
        return { dispose: () => undefined }
      },
      ['absent']
    )
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [missing]
      )
    ).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig,
      cause: expect.any(TypeError)
    })

    const cycleA = moduleWith(
      'cycle-a',
      async () => {
        installs += 1
        return { dispose: () => undefined }
      },
      ['cycle-b']
    )
    const cycleB = moduleWith(
      'cycle-b',
      async () => {
        installs += 1
        return { dispose: () => undefined }
      },
      ['cycle-a']
    )
    await expect(
      createComposedEndpoint(
        createConfig(() => subscriptions++),
        [cycleA, cycleB]
      )
    ).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig,
      cause: expect.any(TypeError)
    })
    expect(subscriptions).toBe(0)
    expect(installs).toBe(0)
  })
})
