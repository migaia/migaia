import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.ts'
import { PluginHostErrorCode } from '../src/error-code.ts'
import { Host, plugin } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('keeps nested objects shared when committing config patches', async () => {
    const host = new Host()
    const shared = { retries: 3 }
    await host.use(plugin('config-owned', () => ({}), { config: {} }))
    await host.config.update('config-owned', () => ({ opts: shared }))
    shared.retries = 99
    await host.config.update('config-owned', (previous) => {
      expect((previous.opts as { retries: number }).retries).toBe(3)
      return {}
    })
  })

  it('updates registration config transactionally', async () => {
    const updates: unknown[] = []
    const host = new Host()
    await host.use(
      plugin('config', () => ({}), {
        config: { enabled: false },
        update: (next: unknown) => updates.push(next)
      })
    )
    await host.config.update('config', (previous) => ({ enabled: !previous.enabled }))
    expect(updates).toEqual([{ enabled: true }])
  })

  it('reads nested config paths through readonly lazy proxies', async () => {
    const nested = { retries: 3 }
    const host = new Host()
    await host.use(
      plugin('config-paths', () => ({}), {
        config: { options: nested, records: [{ enabled: true }] }
      })
    )
    expect(host.config.get('config-paths.options.retries')).toBe(3)
    expect(host.config.get('config-paths.records.[0].enabled')).toBe(true)
    const options = host.config.get('config-paths.options') as { retries: number }
    expect(options).not.toBe(nested)
    expect(options.retries).toBe(3)
    expect(host.config.get('config-paths')).toEqual({
      options: { retries: 3 },
      records: [{ enabled: true }]
    })
    expect(host.config.get('missing.value')).toBeUndefined()
  })

  it('isolates source config and applies update patches with copy-on-write', async () => {
    const source = { options: { retries: 3 }, enabled: true }
    const host = new Host()
    await host.use(plugin('cow', () => ({}), { config: source }))
    source.options.retries = 99
    expect(host.config.get('cow.options.retries')).toBe(3)
    expect(() => {
      ;(host.config.get('cow.options') as { retries: number }).retries = 4
    }).toThrow(TypeError)

    const patch = { options: { retries: 5 } }
    await host.config.update('cow', (previous) => {
      expect(() => {
        ;(previous.options as { retries: number }).retries = 4
      }).toThrow(TypeError)
      return patch
    })
    const updated = host.config.get('cow.options') as { retries: number }
    expect(updated.retries).toBe(5)
    patch.options.retries = 6
    expect((host.config.get('cow.options') as { retries: number }).retries).toBe(5)
    source.options.retries = 100
    expect((host.config.get('cow.options') as { retries: number }).retries).toBe(5)
  })

  it('keeps special plugin names and config paths isolated from prototypes', async () => {
    const host = new Host()
    await host.use(plugin('proto', () => ({}), { config: { safe: { enabled: true } } }))
    expect(host.config.get('proto.safe.enabled')).toBe(true)
    expect(host.config.get('__proto__.safe')).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(() => host.config.get('proto.[-1].safe')).toThrow(TypeError)
  })

  it('reuses the config facade and rejects it after disposal', async () => {
    const host = new Host()
    await host.use(plugin('config-facade', () => ({}), { config: { enabled: true } }))
    expect(host.config).toBe(host.config)
    expect(host.config.get('config-facade.enabled')).toBe(true)
    await host.dispose()
    expect(() => host.config.get('config-facade.enabled')).toThrow(PluginHostError)
  })

  it('requires config recipes to return synchronous plain records', async () => {
    const host = new Host()
    await host.use(plugin('sync-config', () => ({}), { config: { value: 1 } }))
    await expect(
      host.config.update('sync-config', (async () => ({ value: 2 })) as never)
    ).rejects.toBeInstanceOf(TypeError)
    await expect(
      host.config.update('sync-config', () => new Date() as never)
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('protects config snapshots and update candidates with readonly views', async () => {
    const initial = { enabled: false }
    let received: Record<string, unknown> | undefined
    const host = new Host()
    await host.use(
      plugin('config-snapshot', () => ({}), {
        config: initial,
        update: (next: Record<string, unknown>) => {
          received = next
          expect(() => {
            next.enabled = 'plugin-local-mutation'
          }).toThrow(TypeError)
        }
      })
    )
    initial.enabled = true
    await expect(
      host.config.update('config-snapshot', () => ({ enabled: true }))
    ).resolves.toBeUndefined()
    expect(received).toEqual({ enabled: true })
  })

  it('applies top-level config patches and preserves undefined keys', async () => {
    const host = new Host()
    await host.use(plugin('config-merge', () => ({}), { config: { enabled: true, count: 1 } }))
    await host.config.update('config-merge', () => ({ enabled: undefined }))
    let config: Record<string, unknown> | undefined
    await host.config.update('config-merge', (previous) => {
      config = { ...previous, enabled: undefined }
      return { enabled: undefined }
    })
    expect(config).toEqual({ enabled: undefined, count: 1 })
    expect(config).toHaveProperty('enabled')
  })

  it('computes concurrent config recipes from latest committed state', async () => {
    const host = new Host()
    let finalCount = -1
    await host.use(plugin('config-counter', () => ({}), { config: { count: 0 } }))
    await Promise.all([
      host.config.update('config-counter', (previous) => ({
        count: (finalCount = Number(previous.count) + 1)
      })),
      host.config.update('config-counter', (previous) => ({
        count: (finalCount = Number(previous.count) + 1)
      }))
    ])
    expect(finalCount).toBe(2)
  })

  it('commits config without update hook and calls hook for empty patches', async () => {
    const host = new Host()
    let calls = 0
    await host.use(
      plugin('config-hooks', () => ({}), {
        config: { enabled: false },
        update: () => {
          calls += 1
        }
      })
    )
    await host.config.update('config-hooks', () => ({}))
    expect(calls).toBe(1)
    await host.use(plugin('config-no-hook', () => ({}), { config: { enabled: false } }))
    await expect(
      host.config.update('config-no-hook', () => ({ enabled: true }))
    ).resolves.toBeUndefined()
  })

  it('exposes initial config to install through provisional core', async () => {
    const host = new Host()
    let observed: unknown
    await host.use(
      plugin(
        'config-visible',
        (core) => {
          observed = (core as unknown as { config: { get: () => unknown } }).config.get()
          return {}
        },
        { config: { enabled: true } }
      )
    )
    expect(observed).toEqual({ enabled: true })
  })

  it('rejects prototype-polluting config patch keys', async () => {
    const host = new Host()
    await host.use(plugin('safe-config', () => ({}), { config: {} }))
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    await expect(host.config.update('safe-config', () => patch)).rejects.toThrow('config patch key')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects missing unUse and missing config updates', async () => {
    const host = new Host()
    await expect(host.unUse('missing')).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginNotInstalled
    })
    await expect(host.config.update('missing', () => ({}))).rejects.toBeInstanceOf(PluginHostError)
  })
})
