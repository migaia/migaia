/** Original native Feature dependency order is owned by the single actual PluginHost transaction. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { describe, expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

describe('native capability topology', () => {
  it('preserves transitive order while keeping one installer path', async () => {
    /** The original native factories retain their observable construction order. */
    const installs: string[] = []
    /** This dependency is the same real native Feature used by the retired RPC wrapper. */
    const provider = defineFeature(() => {
      installs.push('provider')
      return {}
    })
    /** Only the canonical native dependency graph resolves this original factory edge. */
    const dependent = defineFeature(
      (_core, dependencies) => {
        void dependencies.provider
        installs.push('dependent')
        return {}
      },
      { provider }
    )
    /** One native owner installs the actual SDK transport together with this Feature root. */
    /** Lazy pipeline authority reads this case's own native host only at installation. */
    const rpc = rpcHostPipelines(
      () => native,
      (name, request) => native.pipeline(name, request)
    )
    const native = defineHost({
      ...rpc,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** The real listener contributes its namespace in that same native transaction. */
    const server = coreMemoryServer('native-topology')
    try {
      await native.use(
        definePlugin({
          name: 'topology',
          features: { api: dependent },
          install: () => ({})
        }),
        server.transport
      )
      expect(installs).toEqual(['provider', 'dependent'])
    } finally {
      await native.dispose()
    }
  })

  it('rejects undefined native dependencies before invoking their factory', () => {
    /** Invalid native dependency admission must not enter the original user factory. */
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
    expect(installs).toBe(0)
  })
})
