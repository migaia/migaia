import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

/** Creates an unbounded Host so lifecycle timing does not affect handle assertions. */
const createHost = (): PluginHost<Record<string, never>> =>
  new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })

describe('plugin handles', () => {
  it('returns handles', async () => {
    const host = createHost()
    const a = definePlugin({ name: 'a', install: () => ({ a: () => 'a' }) })
    const b = definePlugin({ name: 'b', install: () => ({ b: () => 'b' }) })
    const handles = await host.use(a, b)

    expect(handles.map((handle) => handle.name)).toEqual(['a', 'b'])
    expect(handles[0].extensions.a()).toBe('a')
    expect(await host.unUse('a')).toEqual({ ok: true })
    expect(await host.unUse('b')).toEqual({ ok: true })
  })

  it('enforces per-registration liveness', async () => {
    const host = createHost()
    const c = definePlugin({ name: 'c', install: () => ({ cCall: () => 'c' }) })
    const d = definePlugin({ name: 'd', install: () => ({ dCall: () => 'd' }) })
    const [cHandle, dHandle] = await host.use(c, d)
    const dCall = dHandle.extensions.dCall

    await host.plugin.disable('c')
    expect(dCall()).toBe('d')
    expect(() => cHandle.extensions).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginDisabled })
    )
    await host.unUse('d')
    expect(() => dCall()).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
  })
})
