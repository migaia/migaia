import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.ts'
import { PluginHostErrorCode } from '../src/error-code.ts'
import { type IExt, type IStageCore, Host, plugin } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('rejects duplicate names and invalid extension descriptors', async () => {
    const host = new Host()
    await host.use(plugin('a', () => ({})))
    await expect(host.use(plugin('a', () => ({})))).rejects.toBeInstanceOf(PluginHostError)
    const invalid = Object.defineProperty({}, 'value', {
      value: 1,
      configurable: false,
      enumerable: true
    })
    await expect(host.use(plugin('invalid', () => invalid))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
  })

  it('does not execute extension getters and rejects array results', async () => {
    const host = new Host()
    let read = false
    const getterExtension = {}
    Object.defineProperty(getterExtension, 'feature', {
      enumerable: true,
      configurable: true,
      get: () => {
        read = true
        throw new Error('getter should not run')
      }
    })
    await expect(host.use(plugin('getter', () => getterExtension))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
    expect(read).toBe(false)
    await expect(host.use(plugin('array', () => [] as never))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
  })

  it('does not execute Symbol.toStringTag getters on install results', async () => {
    const host = new Host()
    let read = false
    const extension = {}
    Object.defineProperty(extension, Symbol.toStringTag, {
      configurable: true,
      get: () => {
        read = true
        throw new Error('toStringTag getter should not run')
      }
    })

    await expect(host.use(plugin('to-string-tag', () => extension))).resolves.toHaveLength(1)
    expect(read).toBe(false)
  })

  it('does not execute config getters', async () => {
    const host = new Host()
    let configRead = false
    const config = {}
    Object.defineProperty(config, 'enabled', {
      enumerable: true,
      configurable: true,
      get: () => {
        configRead = true
        return true
      }
    })
    expect(() => host.use(plugin('config-getter', () => ({}), { config }))).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidConfigValue })
    )
    expect(configRead).toBe(false)
  })

  it('publishes handles without mutating non-extensible host instances', async () => {
    const noExtension = new Host()
    Object.preventExtensions(noExtension)
    await expect(noExtension.use(plugin('no-extension', () => ({})))).resolves.toHaveLength(1)
    const withExtension = new Host()
    Object.preventExtensions(withExtension)
    await expect(
      withExtension.use(plugin('with-extension', () => ({ feature: true })))
    ).resolves.toHaveLength(1)
  })

  it('reserves Promise-like extension names', async () => {
    const host = new Host()
    const thenExtension = {} as Record<string, unknown>
    const thenKey = String.fromCharCode(116, 104, 101, 110)
    Object.defineProperty(thenExtension, thenKey, { value: () => undefined, enumerable: true })
    await expect(host.use(plugin('reserved-then', () => thenExtension))).rejects.toBeInstanceOf(
      PluginHostError
    )
    await host.use(plugin('allowed-catch', () => ({ catch: () => undefined })))
    await host.use(plugin('allowed-finally', () => ({ finally: () => undefined })))
  })

  it('preflights an entire batch before running install', async () => {
    let installed = 0
    const host = new Host()
    const first = plugin('first', () => {
      installed += 1
      return {}
    })
    await host.use(first)
    await expect(
      host.use(
        plugin('new', () => {
          installed += 1
          return {}
        }),
        first
      )
    ).rejects.toBeInstanceOf(PluginHostError)
    expect(installed).toBe(1)
  })

  it('continues queue after a failed mutation', async () => {
    const host = new Host()
    await expect(
      host.use(
        plugin('bad', () => {
          throw new Error('bad')
        })
      )
    ).rejects.toThrow('bad')
    await expect(host.use(plugin('good', () => ({})))).resolves.toHaveLength(1)
  })

  it('does not expose config mutation through plugin core', async () => {
    const host = new Host()
    let coreConfig: Record<string, unknown> | undefined
    await host.use(
      plugin('config-cycle', () => ({}), {
        config: { enabled: false },
        update: (_next: IExt, core: IExt) => {
          coreConfig = (
            core as IExt & { config: { get: () => Record<string, unknown> } }
          ).config.get()
        }
      })
    )
    await host.config.update('config-cycle', () => ({ enabled: true }))
    expect(coreConfig).toEqual({ enabled: false })
  })

  it('reuses one valid core facade for a registration', async () => {
    const host = new Host()
    let installedCore: unknown
    let cachedCore: unknown
    await host.use(
      plugin(
        'stable-core',
        (core) => {
          installedCore = core
          cachedCore = core
          return {}
        },
        {
          config: { value: 1 },
          update: (_next: IExt, core: IExt) => {
            expect(core).toBe(installedCore)
            expect((cachedCore as IExt & { config: { get: () => unknown } }).config.get()).toEqual({
              value: 1
            })
          }
        }
      )
    )
    await host.config.update('stable-core', () => ({ value: 2 }))
    await host.unUse('stable-core')
    expect(() => (cachedCore as IExt & { config: { get: () => unknown } }).config.get()).toThrow()
  })

  it('rejects disposal symbols as extensions when available', async () => {
    const host = new Host()
    if (typeof (Symbol as typeof Symbol & { dispose?: symbol }).dispose === 'symbol') {
      const extension = {} as Record<PropertyKey, unknown>
      Object.defineProperty(extension, (Symbol as typeof Symbol & { dispose?: symbol }).dispose!, {
        value: () => undefined,
        enumerable: true
      })
      await expect(host.use(plugin('symbol-extension', () => extension))).rejects.toBeInstanceOf(
        PluginHostError
      )
    }
  })

  it('does not expose host topology through plugin core', async () => {
    let core: Record<string, unknown> | undefined
    const host = new Host()
    await host.use(
      plugin('boundary', (received) => {
        core = received as never
        return {}
      })
    )
    expect(core).not.toHaveProperty('use')
    expect(core).not.toHaveProperty('unUse')
    expect(core).not.toHaveProperty('dispose')
    expect(core).not.toHaveProperty('config.update')
  })

  it('removes provisional extensions when install fails after mounting part of its result', async () => {
    const host = new Host()
    const extension = {} as Record<string, unknown>
    Object.defineProperty(extension, 'marker', {
      value: 'x',
      enumerable: true,
      configurable: true
    })
    Object.defineProperty(extension, 'broken', {
      value: 'y',
      enumerable: true,
      configurable: false
    })
    await expect(host.use(plugin('broken', () => extension))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
    expect(host).not.toHaveProperty('marker')
    await expect(host.use(plugin('broken', () => ({})))).resolves.toHaveLength(1)
  })

  it('checks concurrent duplicate installs when each batch reaches the queue', async () => {
    const host = new Host()
    const sharedPlugin = plugin('same', () => ({}))
    const first = host.use(sharedPlugin)
    expect(() => host.use(sharedPlugin)).toThrow(PluginHostError)
    await expect(first).resolves.toHaveLength(1)
  })

  it('rejects plugin core writes outside install', async () => {
    const host = new Host()
    await host.use(
      plugin('update-write', () => ({}), {
        config: { enabled: false },
        update: (_next: IExt, core: IExt) => {
          ;(core as IStageCore).usePipeline((value, next) => next(value + 1))
        }
      })
    )
    await expect(host.config.update('update-write', () => ({ enabled: true }))).rejects.toThrow(
      'install'
    )
    expect(host.run(1)).toBe(1)
  })
})
