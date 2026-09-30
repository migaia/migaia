import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

describe('host mutation bench fixture', () => {
  it('preserves leaf mutation behavior after unrelated registrations', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    try {
      /** Unrelated registrations match the independent A18 benchmark's larger fixture. */
      const unrelated = Array.from({ length: 500 }, (_, index) =>
        definePlugin({
          name: `config-${index}`,
          config: { value: index },
          install: () => ({})
        })
      )
      await host.use(...(unrelated as never))
      await host.use(definePlugin({ name: 'leaf', install: () => ({ action: () => 1 }) }))
      await host.plugin.disable('leaf')
      await host.plugin.enable('leaf')
      await host.replace(
        'leaf',
        definePlugin({ name: 'leaf', install: () => ({ action: () => 2 }) })
      )
      expect(host.config.get('config-0.value' as never)).toBe(0)
      /** Two views of one committed generation must reuse the cached extension function. */
      const composition = openComposition(host)
      const first = composition.getCurrentSnapshot()
      const second = composition.getCurrentSnapshot()
      expect(first.extensions.action).toBe(second.extensions.action)
    } finally {
      await host.dispose()
    }
  })
})
