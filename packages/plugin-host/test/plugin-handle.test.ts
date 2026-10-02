import { describe, expect, it } from 'vitest'
import {
  definePlugin,
  isPluginHandleCurrent,
  PluginHost,
  PluginHostErrorCode
} from '../src/index.js'

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
    expect(await host.unUse('a')).toMatchObject({ ok: true })
    expect(await host.unUse('b')).toMatchObject({ ok: true })
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

describe('K257 exact handle registration probe', () => {
  it('keeps disabled registrations current and rejects replaced or disposed handles', async () => {
    /** Registration probe must not change name-addressed extension reads. */
    const host = createHost()
    /** Two definitions reuse one extension value while representing distinct registrations. */
    const first = definePlugin({ name: 'same', install: () => ({ value: 'first' }) })
    const second = definePlugin({ name: 'same', install: () => ({ value: 'second' }) })
    const [original] = await host.use(first)
    expect(isPluginHandleCurrent(original)).toBe(true)
    await host.plugin.disable('same', { policy: 'suspend' })
    expect(isPluginHandleCurrent(original)).toBe(true)
    await host.unUse('same')
    expect(isPluginHandleCurrent(original)).toBe(false)
    const [replacement] = await host.use(second)
    expect(isPluginHandleCurrent(original)).toBe(false)
    expect(isPluginHandleCurrent(replacement)).toBe(true)
    expect(original.extensions.value).toBe('second')
    await host.dispose()
    expect(isPluginHandleCurrent(replacement)).toBe(false)
    expect(isPluginHandleCurrent({ name: 'same' })).toBe(false)
    expect(isPluginHandleCurrent(null)).toBe(false)
  })
})
