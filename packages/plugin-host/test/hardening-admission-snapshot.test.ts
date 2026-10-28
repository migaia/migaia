import { describe, expect, it } from 'vitest'
import { asyncDisposeKey } from '../src/index.ts'
import { Host } from './hardening-fixtures.ts'

describe('resource disposer admission snapshot', () => {
  it('rejects native cleanup methods published as extension capabilities', async () => {
    /** Cleanup symbols belong to resource admission, so a view cannot publish them as methods. */
    const host = new Host()
    await expect(
      host.use({
        name: 'reserved-native-cleanup',
        install: () => ({ [Symbol.dispose]: () => undefined })
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: { code: 'EXTENSION_RESERVED' }
    })
    await host.dispose()
  })

  it('只读取一次 disposer，保留 receiver，并忽略 admission 后的替换', async () => {
    const host = new Host()
    const resource: Record<PropertyKey, unknown> = {}
    let getterReads = 0
    let firstCalls = 0
    let secondCalls = 0
    let receiverMatched = false
    const first = function (this: object): void {
      firstCalls += 1
      receiverMatched = this === resource
    }
    const second = function (): void {
      secondCalls += 1
    }

    Object.defineProperty(resource, Symbol.dispose, {
      configurable: true,
      get: () => {
        getterReads += 1
        return getterReads === 1 ? first : second
      }
    })

    await host.use({
      name: 'p',
      install: (core: { onDispose(value: object): void }) => {
        core.onDispose(resource)
        return {}
      }
    } as any)

    Object.defineProperty(resource, Symbol.dispose, {
      configurable: true,
      value: second,
      writable: true
    })
    await host.unUse('p')

    expect(getterReads).toBe(1)
    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })
})

describe('plugin admission snapshot and disposer boundary', () => {
  it('每个 plugin getter 只读取一次，mutation 后仍执行已捕获 hook 与 receiver', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    const reads = new Map<PropertyKey, number>()
    const calls = { install: 0, update: 0, dispose: 0 }
    const receivers = { install: false, update: false, dispose: false }
    const count = (key: PropertyKey): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1)
    }
    const install = function (this: object): Record<string, never> {
      calls.install += 1
      receivers.install = this === plugin
      return {}
    }
    const update = function (this: object): void {
      calls.update += 1
      receivers.update = this === plugin
    }
    const dispose = function (this: object): void {
      calls.dispose += 1
      receivers.dispose = this === plugin
    }
    const replacement = (): void => undefined
    Object.defineProperties(plugin, {
      name: {
        configurable: true,
        get: () => {
          count('name')
          return 'snapshot'
        }
      },
      config: {
        configurable: true,
        get: () => {
          count('config')
          return { enabled: true }
        }
      },
      install: {
        configurable: true,
        get: () => {
          count('install')
          return install
        }
      },
      update: {
        configurable: true,
        get: () => {
          count('update')
          return update
        }
      },
      dispose: {
        configurable: true,
        get: () => {
          count('dispose')
          return dispose
        }
      },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          count(asyncDisposeKey)
          return replacement
        }
      },
      [Symbol.dispose]: {
        configurable: true,
        get: () => {
          count(Symbol.dispose)
          return replacement
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      config: { configurable: true, value: { enabled: false } },
      install: { configurable: true, value: replacement },
      update: { configurable: true, value: replacement },
      dispose: { configurable: true, value: replacement },
      [asyncDisposeKey]: { configurable: true, value: replacement },
      [Symbol.dispose]: { configurable: true, value: replacement }
    })

    await host.config.update('snapshot', () => ({ enabled: false }))
    await host.unUse('snapshot')

    expect(reads.get('name')).toBe(1)
    expect(reads.get('config')).toBe(1)
    expect(reads.get('install')).toBe(1)
    expect(reads.get('update')).toBe(1)
    expect(reads.get('dispose')).toBe(1)
    expect(reads.get(asyncDisposeKey)).toBe(1)
    expect(reads.get(Symbol.dispose)).toBe(1)
    expect(calls).toEqual({ install: 1, update: 1, dispose: 1 })
    expect(receivers).toEqual({ install: true, update: true, dispose: true })
  })

  it('symbol disposer admission 保持 async precedence、receiver 与 captured identity', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    let asyncReads = 0
    let disposeReads = 0
    let asyncCalls = 0
    let syncCalls = 0
    let receiverMatched = false
    const firstAsync = function (this: object): void {
      asyncCalls += 1
      receiverMatched = this === plugin
    }
    const replacementAsync = (): void => {
      asyncCalls += 100
    }
    const sync = (): void => {
      syncCalls += 1
    }
    Object.defineProperties(plugin, {
      name: { configurable: true, value: 'symbol-snapshot' },
      install: { configurable: true, value: () => ({}) },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          asyncReads += 1
          return firstAsync
        }
      },
      [Symbol.dispose]: {
        configurable: true,
        get: () => {
          disposeReads += 1
          return sync
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      [asyncDisposeKey]: { configurable: true, value: replacementAsync },
      [Symbol.dispose]: { configurable: true, value: replacementAsync }
    })
    await host.unUse('symbol-snapshot')

    expect(asyncReads).toBe(1)
    expect(disposeReads).toBe(1)
    expect(asyncCalls).toBe(1)
    expect(syncCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })

  it('hostile plugin getter becomes plugin-host INVALID_OPTION with original cause', () => {
    const host = new Host()
    const cause = new Error('install getter boom')
    const plugin = { name: 'hostile' } as Record<PropertyKey, unknown>
    Object.defineProperty(plugin, 'install', {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    let caught: unknown
    try {
      host.use(plugin as any)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      source: 'plugin.host',
      code: 'INVALID_OPTION',
      cause
    })
  })

  it('hostile resource disposer getter remains tagged inside install failure cause chain', async () => {
    const host = new Host()
    const cause = new Error('resource disposer getter boom')
    const resource = {} as Record<PropertyKey, unknown>
    Object.defineProperty(resource, Symbol.dispose, {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    await expect(
      host.use({
        name: 'hostile-resource',
        install: (core: { onDispose(value: object): void }) => {
          core.onDispose(resource)
          return {}
        }
      } as any)
    ).rejects.toMatchObject({
      source: 'plugin.host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: {
        source: 'plugin.host',
        code: 'INVALID_OPTION',
        cause
      }
    })
  })
})
