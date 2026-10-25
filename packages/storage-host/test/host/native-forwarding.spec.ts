import { describe, expect, it, vi } from 'vitest'
import { defineFeature, type IFeatureReference } from '@migaia/plugin-host'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../../src/index.js'
import { readStorageNativePluginDefinition } from '../../src/contracts.js'
import { catalog } from '../helpers/catalog.js'

/** These native forwarding baselines use ordinary composition Features, not backend API publication. */
const kind = defineStorageBackendKind()('catalog')

describe('native host forwarding migration baselines', () => {
  it('rejects reserved feature expose collisions before native commit', async () => {
    const install = vi.fn(() => ({}))
    const plugin = definePlugin('reserved-store', (_core) => ({
      kind,
      featureExpose: () =>
        ({
          getClient: () => undefined,
          getStore: () => undefined,
          getBackendId: () => 'forged'
        }) as never,
      install: () => {
        return install()
      }
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(install).not.toHaveBeenCalled()
  })

  it('rejects a native install that omits its required Store transfer before commit', async () => {
    const plugin = definePlugin('missing-store', () => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => ({})
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
  })

  it('passes every non-canonical native install output through to PluginHost rejection', async () => {
    const outputs: readonly unknown[] = [
      null,
      1,
      () => ({}),
      [],
      Object.create({ inherited: true })
    ]
    for (const [index, output] of outputs.entries()) {
      const plugin = definePlugin(`invalid-output-${index}`, (_core) => ({
        install: () => {
          return output as never
        }
      }))
      await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
        code: 'BACKEND_INSTALL_FAILED'
      })
    }
  })

  it('preserves user symbols across a second use while hiding native Store symbols', async () => {
    const visible = Symbol('visible-extension')
    const first = definePlugin('symbol-first', (_core) => ({
      install: () => {
        return { [visible]: 'visible' }
      }
    }))
    const second = definePlugin('symbol-second', (_core) => ({
      install: () => {
        return {}
      }
    }))
    const host = await createStorageHost({ plugins: [first] as const })
    await host.use(second)
    expect(host.extensions[visible]).toBe('visible')
    expect(Object.getOwnPropertySymbols(host.extensions)).toEqual([visible])
    await host.dispose()
  })

  it('keeps the last public extension snapshot after a failed later native use and closes its getter', async () => {
    const first = definePlugin('stable-first', (_core) => ({
      install: () => {
        return { stable: true }
      }
    }))
    const failed = definePlugin('stable-failed', () => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => ({})
    }))
    const host = await createStorageHost({ plugins: [first] as const })
    const snapshot = host.extensions
    await expect(host.use(failed)).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect(host.extensions).toBe(snapshot)
    await host.dispose()
    expect(() => host.extensions).toThrowError('storage host is disposed')
  })

  it('rejects duplicate Store transfer within one original registration and releases only its accepted store', async () => {
    let first!: ReturnType<typeof catalog>
    let second!: ReturnType<typeof catalog>
    const descriptor = (_core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => {
        first = catalog(_core)
        second = catalog(_core)
        _core.registerStore(first.store)
        _core.registerStore(second.store)
        return {}
      }
    })
    await expect(
      createStorageHost({ plugins: [definePlugin('duplicate-store', descriptor)] })
    ).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { code: 'PLUGIN_INSTALL_FAILED', cause: { code: 'BACKEND_PLUGIN_INVALID' } }
    })
    expect(first.cleanup).toHaveBeenCalledTimes(1)
    expect(second.cleanup).not.toHaveBeenCalled()
    await second.store.dispose()
  })

  it('forwards a native feature capability only to a declared later dependency', async () => {
    const capability = defineFeature(() => ({ read: () => 'feature' }))
    const producer = definePlugin(
      'feature-producer',
      (_core) => ({
        install: () => {
          return {}
        }
      }),
      { capability }
    )
    const producerDefinition = readStorageNativePluginDefinition(producer)! as {
      getFeature(name: 'capability'): IFeatureReference<{ readonly read: () => string }, false>
    }
    const dependency = defineFeature((_core, dependencies) => dependencies.capability, {
      capability: producerDefinition.getFeature('capability')
    })
    const consumer = definePlugin(
      'feature-consumer',
      (_core) => ({
        install: () => {
          return { readFeature: () => _core.features.dependency.read() }
        }
      }),
      { dependency }
    )
    const host = await createStorageHost({ plugins: [producer, consumer] as const })
    expect(host.extensions.readFeature()).toBe('feature')
    await host.dispose()
  })

  it('preserves a rejected feature factory error through Host installation', async () => {
    const original = new Error('storage feature rejection')
    const rejected = defineFeature(() => {
      throw original
    })
    const plugin = definePlugin(
      'feature-rejection',
      (_core) => ({
        install: () => {
          return {}
        }
      }),
      { rejected }
    )
    let failure: unknown
    try {
      await createStorageHost({ plugins: [plugin] as const })
    } catch (error) {
      failure = error
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    const pluginFailure = (failure as Error).cause as Error
    expect(pluginFailure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(pluginFailure.cause).toBe(original)
  })

  it('keeps a non-callable feature then data property while injecting Storage capabilities', async () => {
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    const output = Object.defineProperty({ read: () => 'feature-data' }, thenKey, {
      value: false,
      enumerable: true
    })
    const capability = defineFeature(() => output)
    const plugin = definePlugin(
      'feature-data-then',
      (_core) => ({
        install: () => {
          return { readFeature: _core.features.capability.read }
        }
      }),
      { capability }
    )
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect(host.extensions.readFeature()).toBe('feature-data')
    await host.dispose()
  })

  it('rejects an undefined feature result before injecting Storage capabilities', async () => {
    const invalid = defineFeature(() => undefined as never)
    const plugin = definePlugin(
      'feature-undefined',
      (_core) => ({
        install: () => {
          return {}
        }
      }),
      { invalid }
    )
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
  })

  it('keeps the original featureExpose receiver through the native projection', async () => {
    const expose = {
      receiver() {
        return this === expose
      }
    }
    const feature = defineFeature((_core) => ({
      read: () =>
        (_core.featureExpose as unknown as { readonly receiver: () => boolean }).receiver()
    }))
    const plugin = definePlugin(
      'feature-expose-receiver',
      (_core) => ({
        install: () => {
          return { receiver: _core.features.feature.read }
        },
        featureExpose: () => expose
      }),
      { feature }
    )
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect(host.extensions.receiver()).toBe(true)
    await host.dispose()
  })

  it('preserves thenable descriptor and featureExpose outputs for PluginHost rejection', async () => {
    const descriptorOriginal = new Error('storage descriptor rejection')
    const rejectedDescriptor = Promise.reject(descriptorOriginal)
    const descriptorPlugin = definePlugin('descriptor-promise', () => rejectedDescriptor as never)
    await expect(createStorageHost({ plugins: [descriptorPlugin] as const })).rejects.toMatchObject(
      {
        code: 'BACKEND_INSTALL_FAILED'
      }
    )
    const featureOriginal = new Error('storage feature expose rejection')
    const rejectedFeatureExpose = Promise.reject(featureOriginal)
    const feature = defineFeature(() => ({ read: () => undefined }))
    const featurePlugin = definePlugin(
      'feature-expose-promise',
      (_core) => ({
        install: () => {
          return {}
        },
        featureExpose: () => rejectedFeatureExpose as never
      }),
      { feature }
    )
    await expect(createStorageHost({ plugins: [featurePlugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
  })
})
