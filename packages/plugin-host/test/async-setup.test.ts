import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

describe('async setup definition admission', () => {
  it('A8 captures setup as a known function field and rejects invalid definitions', async () => {
    expect(() => definePlugin({ name: 'invalid', setup: 1, install: () => ({}) } as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )

    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    expect(() => host.use({ name: 'raw', setup: 'x', install: () => ({}) } as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )

    /** Counts calls to the source hook after the definition has frozen its wrapper. */
    let calls = 0
    const original = (_context: unknown) => {
      calls += 1
      return { ready: true }
    }
    const plugin = definePlugin({ name: 'valid', setup: original, install: () => ({}) })
    expect(typeof plugin.setup).toBe('function')
    expect(plugin.setup).not.toBe(original)
    expect(plugin.setup?.({} as never)).toEqual({ ready: true })
    expect(calls).toBe(1)
    await host.use(definePlugin({ name: 'raw', install: () => ({}) }))
    await host.dispose()
  })
})
