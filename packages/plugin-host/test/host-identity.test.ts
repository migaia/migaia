import { describe, expect, it } from 'vitest'
import {
  defineHost,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode
} from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Explicit unbounded lifecycle policy keeps identity tests independent of wall-clock timing. */
const execution = { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }

/** Concrete class entry used to observe the identity exposed by a Host instance. */
class Host extends PluginHost<Record<string, never>> {}

describe('host identity', () => {
  it('host identity is unique per instance and never a lookup key: same labels receive unique ids', async () => {
    const first = new Host({ execution, identity: { name: 'worker' } })
    const second = new Host({ execution, identity: { name: 'worker' } })
    expect(first.identity.name).toBe('worker')
    expect(second.identity.name).toBe('worker')
    expect(first.identity.id).not.toBe(second.identity.id)
    expect(Object.isFrozen(first.identity)).toBe(true)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('host identity is unique per instance and never a lookup key: package errors carry the issuing identity', async () => {
    const host = new Host({ execution, identity: { name: 'audit' } })
    await host.dispose()
    let thrown: unknown
    try {
      openComposition(host).getCurrentSnapshot()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PluginHostError)
    expect((thrown as PluginHostError).code).toBe(PluginHostErrorCode.hostDisposed)
    expect((thrown as PluginHostError).detail).toEqual({ host: host.identity })
  })

  it('host identity is unique per instance and never a lookup key: config and removal retain the bare plugin name', async () => {
    const host = defineHost({ host: { execution, identity: { name: 'tray' } } })
    const plugin = definePlugin({
      name: 'plain',
      config: { enabled: true },
      install: () => ({})
    })
    const [handle] = await host.use(plugin)
    expect(handle.config.get()).toEqual({ enabled: true })
    const removal = await host.unUse('plain')
    expect(removal).toEqual({ ok: true })
    await host.dispose()
  })

  it('host identity is unique per instance and never a lookup key: diagnostics include the issued id', async () => {
    const diagnostics: string[] = []
    const host = new Host({
      execution,
      identity: { name: 'observed' },
      diagnostic: (message) => diagnostics.push(message)
    })
    await host.use({
      name: 'diagnostic',
      install: () => {
        const extension = {}
        Object.defineProperty(extension, 'hidden', { value: true })
        return extension
      }
    } as never)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatch(new RegExp(`^\\[plugin-host:${host.identity.id}\\] `))
    await host.dispose()
  })
})
