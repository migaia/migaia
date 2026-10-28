import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.ts'
import { Host, plugin } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('owns disposer returned by async install', async () => {
    const closed: string[] = []
    const host = new Host()
    await host.use(
      plugin('resource', async (core) => {
        core.onDispose(() => {
          closed.push('resource')
        })
        return {}
      })
    )
    await host.dispose()
    expect(closed).toEqual(['resource'])
  })

  it('uses one install resource disposer with async protocol priority', async () => {
    const calls: string[] = []
    const host = new Host()
    const resource = { marker: 'x' } as Record<PropertyKey, unknown>
    Object.defineProperties(resource, {
      dispose: { value: () => calls.push('explicit') },
      [Symbol.asyncDispose]: { value: async () => calls.push('async') },
      [Symbol.dispose]: { value: () => calls.push('sync') }
    })
    await host.use(
      plugin('resource-protocol', (core) => {
        core.onDispose(resource as never)
        return {}
      })
    )
    await host.dispose()
    expect(calls).toEqual(['async'])
  })

  it('falls back to plugin-level disposal symbols', async () => {
    const calls: string[] = []
    const host = new Host()
    const pluginWithDispose = {
      name: 'symbol-plugin',
      install: () => ({}),
      [Symbol.asyncDispose]: async () => {
        calls.push('async')
      },
      [Symbol.dispose]: () => calls.push('sync')
    }
    await host.use(pluginWithDispose)
    await host.unUse('symbol-plugin')
    expect(calls).toEqual(['async'])
  })

  it('rejects resources without a supported disposer during install', async () => {
    const host = new Host()
    await expect(
      host.use(
        plugin('unsupported-resource', (core) => {
          core.onDispose({} as never)
          return {}
        })
      )
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
  })

  it('deletes registration after failed unload so callers can decide on reinstall', async () => {
    const host = new Host()
    let pluginDisposeCalls = 0
    let resourceDisposeCalls = 0
    const retryable = plugin(
      'retryable',
      (core) => {
        core.onDispose(() => {
          resourceDisposeCalls += 1
          if (resourceDisposeCalls === 1) throw new Error('resource cleanup failed')
        })
        return { retryMarker: true }
      },
      {
        dispose: () => {
          pluginDisposeCalls += 1
          if (pluginDisposeCalls === 1) throw new Error('plugin cleanup failed')
        }
      }
    )
    await host.use(retryable)
    const removal = await host.unUse('retryable')
    expect(removal).toMatchObject({ ok: false, errors: expect.any(Array) })
    await expect(host.config.update('retryable', () => ({}))).rejects.toBeInstanceOf(
      PluginHostError
    )
    expect(pluginDisposeCalls).toBe(1)
    expect(resourceDisposeCalls).toBe(1)
    await expect(host.use(retryable)).resolves.toHaveLength(1)
  })
})
