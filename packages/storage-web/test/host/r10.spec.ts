import { describe, expect, it, vi } from 'vitest'
import {
  createStorageHost,
  defineFeature,
  definePlugin,
  type IStoragePluginCore
} from '../../src/host/index.js'
import { defineBuiltInPlugin, defineNativeReactiveFeature } from '../../src/host/contracts.js'
import { localStorageBackendKind, memoryBackendKind } from '../../src/host/builtin-kinds.js'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { localStorageReactive } from '../../src/plugins/reactive/local-storage.js'
import { sessionStorageReactive } from '../../src/plugins/reactive/session-storage.js'
import { cookiesReactive } from '../../src/plugins/reactive/cookies.js'
import { indexedDbReactive } from '../../src/plugins/reactive/indexed-db.js'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import * as reactiveModule from '../../src/host/reactive.js'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'
import { memoryStorageHost } from '../../src/backends/memory.js'
import { defineReactiveAdapterFeature } from '../../src/reactive-adapter.js'

/** R10 proves the Host installs one exact adapter for each canonical fast-path plugin. */
describe('SWV4-B05 R10 reactive adapters', () => {
  it('snapshots custom adapter getters and subscriber before native Plugin construction', async () => {
    const originalSubscribe = vi.fn(() => () => undefined)
    const replacementSubscribe = vi.fn(() => () => undefined)
    let modeReads = 0
    let visibilityReads = 0
    let subscribeReads = 0
    const definition = {
      get mode() {
        modeReads += 1
        return 'push' as const
      },
      get visibility() {
        visibilityReads += 1
        return 'instance' as const
      },
      get subscribe() {
        subscribeReads += 1
        return originalSubscribe
      }
    }
    const reactive = defineReactiveAdapterFeature(definition)
    Object.defineProperty(definition, 'subscribe', { value: replacementSubscribe })
    const plugin = definePlugin(
      'snapshot-custom',
      (core) => ({
        install: () => {
          core.registerStore(memoryStorageHost())
          return {}
        }
      }),
      { reactive }
    )
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect([modeReads, visibilityReads, subscribeReads]).toEqual([1, 1, 1])
    expect(originalSubscribe).toHaveBeenCalledTimes(1)
    expect(replacementSubscribe).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('rejects invalid custom policy before Plugin construction and preserves getter cause', () => {
    const pluginFactory = vi.fn()
    expect(() =>
      defineReactiveAdapterFeature({
        mode: 'push',
        visibility: 'instance',
        pollIntervalMs: 1,
        subscribe: () => () => undefined
      })
    ).toThrow(expect.objectContaining({ code: 'REACTIVE_FEATURE_INVALID' }))
    expect(pluginFactory).not.toHaveBeenCalled()
    const cause = new Error('visibility getter failure')
    const invalid = Object.defineProperty(
      { mode: 'push', subscribe: () => () => undefined },
      'visibility',
      {
        get: () => {
          throw cause
        }
      }
    )
    expect(() => defineReactiveAdapterFeature(invalid as never)).toThrow(
      expect.objectContaining({ code: 'REACTIVE_FEATURE_INVALID', cause })
    )
  })

  it('publishes exact memory identity and reactive capability after the atomic batch', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'reactive-memory' })] as const
    })
    const store = host.backend('reactive-memory')
    expect(host.hasReactiveBackend('reactive-memory')).toBe(true)
    expect(host.reactiveBackend('reactive-memory')).toMatchObject({
      id: 'reactive-memory',
      store
    })
    await host.dispose()
  })

  it('uses each native Feature attach closure after both Stores and the singleton service exist', async () => {
    const attach = vi.spyOn(reactiveModule, 'registerReactiveAdapter')
    try {
      const host = await createStorageHost({
        plugins: [memoryReactive({ id: 'attach-a' }), memoryReactive({ id: 'attach-b' })] as const
      })
      expect(attach).toHaveBeenCalledTimes(2)
      expect(attach.mock.calls.map((call) => call[1])).toEqual(['attach-a', 'attach-b'])
      expect(host.hasReactiveBackend('attach-a')).toBe(true)
      expect(host.hasReactiveBackend('attach-b')).toBe(true)
      await host.dispose()
    } finally {
      attach.mockRestore()
    }
  })

  it('binds each native Feature attach closure to its own registered Store', async () => {
    const attach = vi.spyOn(reactiveModule, 'registerReactiveAdapter')
    try {
      const host = await createStorageHost({
        plugins: [memoryReactive({ id: 'bound-a' }), memoryReactive({ id: 'bound-b' })] as const
      })
      expect(attach.mock.calls.map((call) => call[2])).toEqual([
        host.backend('bound-a'),
        host.backend('bound-b')
      ])
      await host.dispose()
    } finally {
      attach.mockRestore()
    }
  })

  it('installs both Stores before native attach and disposes adapters before Stores in reverse order', async () => {
    const trace: string[] = []
    const firstStore = memoryStorageHost()
    const secondStore = memoryStorageHost()
    const firstDispose = firstStore.dispose
    const secondDispose = secondStore.dispose
    vi.spyOn(firstStore, 'dispose').mockImplementation(async () => {
      trace.push('dispose:store-a')
      return firstDispose()
    })
    vi.spyOn(secondStore, 'dispose').mockImplementation(async () => {
      trace.push('dispose:store-b')
      return secondDispose()
    })
    const createReactiveService = reactiveModule.createStorageReactiveService
    const service = vi
      .spyOn(reactiveModule, 'createStorageReactiveService')
      .mockImplementation(() => {
        trace.push('create:service')
        const value = createReactiveService()
        return {
          ...value,
          dispose: () => {
            trace.push('dispose:service')
            return value.dispose()
          }
        }
      })
    const registerReactiveAdapter = reactiveModule.registerReactiveAdapter
    const register = vi
      .spyOn(reactiveModule, 'registerReactiveAdapter')
      .mockImplementation((...args) => {
        trace.push(`attach:${args[1]}`)
        const adapter = registerReactiveAdapter(...args)
        return {
          ...adapter,
          startSource: () => {
            trace.push(`start:adapter-${args[1]}`)
            return adapter.startSource()
          },
          dispose: () => {
            trace.push(`dispose:adapter-${args[1]}`)
            return adapter.dispose()
          }
        }
      })
    try {
      const reactive = defineNativeReactiveFeature(
        { mode: 'push', visibility: 'instance' },
        memoryBackendKind
      )
      const createPlugin = <const TId extends string>(id: TId, store: typeof firstStore) =>
        defineBuiltInPlugin(
          memoryBackendKind,
          id,
          (core) => ({
            install: () => {
              trace.push(`install:store-${id.slice(-1)}`)
              core.registerStore(store)
              return {}
            }
          }),
          { reactive }
        )
      const host = await createStorageHost({
        plugins: [
          createPlugin('trace-a', firstStore),
          createPlugin('trace-b', secondStore)
        ] as const
      })
      expect(trace).toEqual([
        'install:store-a',
        'install:store-b',
        'create:service',
        'attach:trace-a',
        'start:adapter-trace-a',
        'attach:trace-b',
        'start:adapter-trace-b'
      ])
      await host.dispose()
      expect(trace).toEqual([
        'install:store-a',
        'install:store-b',
        'create:service',
        'attach:trace-a',
        'start:adapter-trace-a',
        'attach:trace-b',
        'start:adapter-trace-b',
        'dispose:adapter-trace-b',
        'dispose:adapter-trace-a',
        'dispose:service',
        'dispose:store-b',
        'dispose:store-a'
      ])
    } finally {
      register.mockRestore()
      service.mockRestore()
    }
  })

  it('releases a rolled-back service once and creates a fresh service for retry', async () => {
    const trace: string[] = []
    const originalCreateService = reactiveModule.createStorageReactiveService
    const service = vi
      .spyOn(reactiveModule, 'createStorageReactiveService')
      .mockImplementation(() => {
        const value = originalCreateService()
        trace.push('create:service')
        return {
          ...value,
          dispose: () => {
            trace.push('dispose:service')
            return value.dispose()
          }
        }
      })
    const originalRegisterAdapter = reactiveModule.registerReactiveAdapter
    const register = vi.spyOn(reactiveModule, 'registerReactiveAdapter').mockImplementation(() => {
      throw new Error('reactive attach failed')
    })
    const reactive = defineNativeReactiveFeature(
      { mode: 'push', visibility: 'instance' },
      memoryBackendKind
    )
    const createPlugin = <const TId extends string>(id: TId) => {
      const store = memoryStorageHost()
      return defineBuiltInPlugin(
        memoryBackendKind,
        id,
        (core) => ({
          install: () => {
            core.registerStore(store)
            return {}
          }
        }),
        { reactive }
      )
    }
    const host = await createStorageHost()
    try {
      await expect(host.use(createPlugin('failed-reactive'))).rejects.toMatchObject({
        code: 'BACKEND_INSTALL_FAILED'
      })
      expect(trace).toEqual(['create:service', 'dispose:service'])
      register.mockRestore()
      await host.use(createPlugin('retried-reactive'))
      expect(trace).toEqual(['create:service', 'dispose:service', 'create:service'])
      await host.dispose()
      expect(trace).toEqual([
        'create:service',
        'dispose:service',
        'create:service',
        'dispose:service'
      ])
    } finally {
      if (register.mock.calls.length > 0) register.mockRestore()
      service.mockRestore()
      await host.dispose()
      void originalRegisterAdapter
    }
  })

  it('YS29 accepts a short kind-hidden native definition with one shared Feature across exact stores', async () => {
    const cap = defineFeature((core) => ({
      readStore: () => core.featureExpose.getStore(),
      readBackendId: () => core.featureExpose.getBackendId()
    }))
    const firstStore = memoryStorageHost()
    const secondStore = memoryStorageHost()
    const first = definePlugin(
      'first',
      (core: IStoragePluginCore<typeof firstStore, { readonly cap: typeof cap }>) => ({
        install() {
          core.registerStore(firstStore)
          return {
            readFirst: () => core.features.cap.readStore(),
            readFirstId: () => core.features.cap.readBackendId()
          }
        },
        expose: () => ({ firstVisible: () => true })
      }),
      { cap }
    )
    const second = definePlugin(
      'second',
      (core: IStoragePluginCore<typeof secondStore, { readonly cap: typeof cap }>) => ({
        install() {
          core.registerStore(secondStore)
          return {
            readSecond: () => core.features.cap.readStore(),
            readSecondId: () => core.features.cap.readBackendId()
          }
        },
        expose: () => ({ secondVisible: () => true })
      }),
      { cap }
    )
    expect(first.id).toBe('first')
    expect(second.id).toBe('second')
    const host = await createStorageHost({ plugins: [first, second] as const })
    const extensions = host.extensions
    expect(host.backend('first')).toBe(firstStore)
    expect(host.backend('second')).toBe(secondStore)
    expect(host.backend('first')).not.toBe(host.backend('second'))
    expect(extensions.readFirst()).toBe(firstStore)
    expect(extensions.readSecond()).toBe(secondStore)
    expect(extensions.readFirstId()).toBe('first')
    expect(extensions.readSecondId()).toBe('second')
    expect(extensions.firstVisible()).toBe(true)
    expect(extensions.secondVisible()).toBe(true)
    expect(host.hasReactiveBackend('first')).toBe(false)
    expect(host.hasReactiveBackend('second')).toBe(false)
    if (process.env.NODE_ENV === 'typecheck') {
      // @ts-expect-error installed literal IDs do not widen to arbitrary backend names.
      host.backend('missing')
      // @ts-expect-error Host extensions remain exact callable contracts.
      extensions.readFirst('unexpected')
    }
    expect(host.backend('first')).not.toHaveProperty('readFirst')
    await host.dispose()
  })

  it('rejects a first-party reactive Feature bound to another backend kind before descriptor construction', async () => {
    const descriptor = vi.fn(() => ({ install: () => ({}) }))
    const reactive = defineNativeReactiveFeature(
      { mode: 'push', visibility: 'instance' },
      memoryBackendKind
    )
    const plugin = defineBuiltInPlugin(
      localStorageBackendKind,
      'mismatched-reactive-kind',
      descriptor,
      { reactive }
    )
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { code: 'REACTIVE_FEATURE_INVALID' }
    })
    expect(descriptor).not.toHaveBeenCalled()
  })

  it('rejects a dependency-only first-party reactive kind mismatch before descriptor construction', async () => {
    const descriptor = vi.fn(() => ({ install: () => ({}) }))
    const reactive = defineNativeReactiveFeature(
      { mode: 'push', visibility: 'instance' },
      memoryBackendKind
    )
    const wrapper = defineFeature(() => ({}), { reactive })
    const plugin = defineBuiltInPlugin(
      localStorageBackendKind,
      'dependency-mismatched-reactive-kind',
      descriptor,
      { wrapper }
    )
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { code: 'REACTIVE_FEATURE_INVALID' }
    })
    expect(descriptor).not.toHaveBeenCalled()
  })

  it('rejects reserved feature expose collisions before native commit', async () => {
    const store = memoryStorageHost()
    const install = vi.fn(() => ({}))
    const plugin = definePlugin('reserved-store', (core) => ({
      featureExpose: () => ({ getStore: () => store, getBackendId: () => 'forged' }),
      install: () => {
        core.registerStore(store)
        return install()
      }
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(install).not.toHaveBeenCalled()
  })

  it('rejects a native install that omits its required Store transfer before commit', async () => {
    const plugin = definePlugin('missing-store', () => ({ install: () => ({}) }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
  })

  it('preserves invalid native install descriptors for PluginHost rejection without reading getters', async () => {
    const getter = vi.fn(() => memoryStorageHost())
    const output = Object.defineProperty({}, 'hostile', {
      enumerable: true,
      configurable: true,
      get: getter
    })
    const plugin = definePlugin('hostile-install-output', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return output as never
      }
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(getter).not.toHaveBeenCalled()
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
      const plugin = definePlugin(`invalid-output-${index}`, (core) => ({
        install: () => {
          core.registerStore(memoryStorageHost())
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
    const first = definePlugin('symbol-first', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return { [visible]: 'visible' }
      }
    }))
    const second = definePlugin('symbol-second', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
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
    const first = definePlugin('stable-first', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return { stable: true }
      }
    }))
    const failed = definePlugin('stable-failed', () => ({ install: () => ({}) }))
    const host = await createStorageHost({ plugins: [first] as const })
    const snapshot = host.extensions
    await expect(host.use(failed)).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect(host.extensions).toBe(snapshot)
    await host.dispose()
    expect(() => host.extensions).toThrowError('storage host is disposed')
  })

  it('rejects duplicate Store transfer within one native registration', async () => {
    const first = memoryStorageHost()
    const second = memoryStorageHost()
    /** Captures the first transfer disposer while preserving the Store's actual cleanup behavior. */
    const firstDispose = first.dispose
    /** Shows whether the failed registration reached the accepted Store's release path. */
    const transferTrace: string[] = []
    const disposeFirst = vi.spyOn(first, 'dispose').mockImplementation(async () => {
      transferTrace.push('dispose:first')
      return firstDispose()
    })
    const disposeSecond = vi.spyOn(second, 'dispose')
    const plugin = definePlugin('duplicate-store', (core) => ({
      install: () => {
        core.registerStore(first)
        transferTrace.push('registered:first')
        core.registerStore(second)
        return {}
      }
    }))
    let failure: unknown
    try {
      await createStorageHost({ plugins: [plugin] as const })
    } catch (error) {
      failure = error
    }
    const pluginFailure = (failure as Error).cause as Error
    expect(pluginFailure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(pluginFailure.cause).toMatchObject({ code: 'BACKEND_PLUGIN_INVALID' })
    await Promise.resolve()
    await Promise.resolve()
    expect(transferTrace).toEqual(['registered:first', 'dispose:first'])
    expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect((failure as Error).cause).toBeInstanceOf(Error)
    expect(disposeFirst).toHaveBeenCalledTimes(1)
    expect(disposeSecond).not.toHaveBeenCalled()
  })

  it('forwards native shared capability only to a later Plugin install', async () => {
    const producerStore = memoryStorageHost()
    const consumerStore = memoryStorageHost()
    const producer = definePlugin('shared-producer', (core) => ({
      install: () => {
        core.registerStore(producerStore)
        return {}
      },
      shared: () => ({ storageSharedCapability: { read: () => 'shared' } })
    }))
    const consumer = definePlugin('shared-consumer', (core) => ({
      install: () => {
        const shared = core.getShared('storageSharedCapability')
        expect(shared).toMatchObject({ read: expect.any(Function) })
        core.registerStore(consumerStore)
        return { readShared: () => (shared as { readonly read: () => string }).read() }
      }
    }))
    const host = await createStorageHost({ plugins: [producer, consumer] as const })
    expect(host.extensions.readShared()).toBe('shared')
    await host.dispose()
  })

  it('preserves a rejected shared Promise for PluginHost synchronous rejection', async () => {
    const original = new Error('storage shared rejection')
    const rejected = Promise.reject(original)
    const plugin = definePlugin('shared-promise', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      },
      shared: () => rejected as never
    }))
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
    expect(pluginFailure.cause).toMatchObject({ cause: original })
  })

  it('keeps a non-callable shared then data property while injecting Storage capabilities', async () => {
    const producerStore = memoryStorageHost()
    const consumerStore = memoryStorageHost()
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    const shared = Object.freeze(
      Object.defineProperty({ storageSharedCapability: { read: () => 'shared-data' } }, thenKey, {
        value: false,
        enumerable: true
      })
    )
    const producer = definePlugin('shared-data-then', (core) => ({
      install: () => {
        core.registerStore(producerStore)
        return {}
      },
      shared: () => shared
    }))
    const consumer = definePlugin('shared-data-consumer', (core) => ({
      install: () => {
        const shared = core.getShared('storageSharedCapability') as { readonly read: () => string }
        core.registerStore(consumerStore)
        return { readShared: shared.read }
      }
    }))
    const host = await createStorageHost({ plugins: [producer, consumer] as const })
    expect(host.extensions.readShared()).toBe('shared-data')
    expect(host.backends().get('shared-data-then')).toBe(producerStore)
    await host.dispose()
  })

  it('normalizes an undefined shared result before injecting Storage capabilities', async () => {
    const store = memoryStorageHost()
    const plugin = definePlugin('shared-undefined', (core) => ({
      install: () => {
        core.registerStore(store)
        return {}
      },
      shared: () => undefined as never
    }))
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect(host.backends().get('shared-undefined')).toBe(store)
    await host.dispose()
  })

  it('leaves a shared then accessor unread until PluginHost observes it once', async () => {
    const original = new Error('storage shared accessor rejection')
    let thenReads = 0
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    const shared = Object.defineProperty({}, thenKey, {
      enumerable: true,
      get: () => {
        thenReads += 1
        return (_resolve: unknown, reject: (error: unknown) => void) => reject(original)
      }
    })
    const plugin = definePlugin('shared-then-accessor', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      },
      shared: () => shared as never
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    await Promise.resolve()
    expect(thenReads).toBe(1)
  })

  it('forwards a dynamic shared Proxy then getter to PluginHost once', async () => {
    const original = new Error('storage dynamic shared rejection')
    let thenReads = 0
    const shared = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key !== 'then') return undefined
          thenReads += 1
          return (_resolve: unknown, reject: (error: unknown) => void) => reject(original)
        }
      }
    )
    const plugin = definePlugin('shared-dynamic-then', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      },
      shared: () => shared
    }))
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    await Promise.resolve()
    expect(thenReads).toBe(1)
  })

  it('keeps the original featureExpose receiver through the native projection', async () => {
    const expose = {
      receiver() {
        return this === expose
      }
    }
    const feature = defineFeature((core) => ({
      read: () => (core.featureExpose as unknown as { readonly receiver: () => boolean }).receiver()
    }))
    const plugin = definePlugin(
      'feature-expose-receiver',
      (core) => ({
        install: () => {
          core.registerStore(memoryStorageHost())
          return { receiver: core.features.feature.read }
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
    const feature = defineFeature((core) => ({ read: core.featureExpose.getStore }))
    const featurePlugin = definePlugin(
      'feature-expose-promise',
      (core) => ({
        install: () => {
          core.registerStore(memoryStorageHost())
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

  it('reuses the Host service for a later adapter batch without changing caller order', async () => {
    const host = await createStorageHost()
    await host.use(memoryReactive({ id: 'one' }))
    await host.use(memoryReactive({ id: 'two' }))
    expect(host.hasReactiveBackend('one')).toBe(true)
    expect(host.hasReactiveBackend('two')).toBe(true)
    expect([...host.backends().keys()]).toEqual(['one', 'two'])
    await host.dispose()
  })

  it('exposes the five canonical fast-path factories without aliases', () => {
    expect(typeof memoryReactive).toBe('function')
    expect(typeof localStorageReactive).toBe('function')
    expect(typeof sessionStorageReactive).toBe('function')
    expect(typeof cookiesReactive).toBe('function')
    expect(typeof indexedDbReactive).toBe('function')
  })

  it('seals a hostile thenable source without awaiting it and releases active queries once', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const reports: unknown[] = []
    let stopped = 0
    let observedSignal: { readonly aborted: boolean } | undefined
    const adapter = service.registerAdapter({
      backendId: 'hostile',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: ({ signal }) => {
        observedSignal = signal
        const hostile = Object.create(null) as PromiseLike<unknown>
        const thenKey = ['t', 'h', 'e', 'n'].join('')
        Object.defineProperty(hostile, thenKey, {
          value: (resolve: (value: () => void) => void) => {
            resolve(() => {
              stopped += 1
            })
          }
        })
        return hostile
      },
      report: (error) => reports.push(error)
    })
    const query = adapter.acquireQuery()
    expect(() => adapter.startSource()).toThrowError('reactive feature is invalid')
    expect(observedSignal?.aborted).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(stopped).toBe(1)
    const firstDispose = adapter.dispose()
    expect(adapter.dispose()).toBe(firstDispose)
    query.release()
    await firstDispose
    expect(reports).toHaveLength(0)
    await service.dispose()
  })

  it('reports D79 sync admission failures as native coded TypeErrors with the original cause', () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const cause = new Error('source admission failed')
    const adapter = service.registerAdapter({
      backendId: 'coded-admission',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => {
        throw cause
      },
      report: () => undefined
    })

    let failure: unknown
    try {
      adapter.startSource()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: '@migaia/storage-web',
      code: 'REACTIVE_FEATURE_INVALID',
      message: 'reactive feature is invalid',
      cause
    })
    expect((failure as Error).stack).toContain('TypeError')
  })

  it('rejects a service adapter whose store/controller pair is not the private registry pair', () => {
    const store = memoryStorageHost()
    const service = createStorageReactiveService()
    const controller = getBackendReactiveController(store)!
    const forgedController = { ...controller }
    expect(() =>
      service.registerAdapter({
        backendId: 'forged-provider',
        store,
        controller: forgedController,
        consistency: { mode: 'push', visibility: 'instance' },
        subscribe: undefined,
        report: () => undefined
      })
    ).toThrowError('reactive feature is invalid')
    expect(controller).toBe(getBackendReactiveController(store))
  })

  it('invokes source stop and active query terminals in one synchronous ordered pass', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const order: string[] = []
    const reports: unknown[] = []
    const adapter = service.registerAdapter({
      backendId: 'terminal-order',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => () => {
        order.push('source-stop')
        return Promise.reject(new Error('source-stop-failed'))
      },
      report: (error) => reports.push(error)
    })
    const first = new Error('first-query-failed')
    const second = new Error('second-query-failed')
    const firstQuery = adapter.acquireQuery(() => {
      order.push('query-1')
      return Promise.reject(first)
    })
    const secondQuery = adapter.acquireQuery(() => {
      order.push('query-2')
      return Promise.reject(second)
    })
    adapter.startSource()

    const disposal = adapter.dispose()
    expect(adapter.dispose()).toBe(disposal)
    expect(order).toEqual(['source-stop', 'query-1', 'query-2'])
    expect(firstQuery.terminate()).toBe(firstQuery.terminate())
    expect(secondQuery.terminate()).toBe(secondQuery.terminate())
    await disposal
    expect(reports).toHaveLength(3)
    expect(reports[0]).toBeInstanceOf(Error)
    expect(reports[1]).toBeInstanceOf(AggregateError)
    expect(reports[2]).toBeInstanceOf(AggregateError)
    expect((reports[1] as AggregateError).errors).toEqual([first])
    expect((reports[2] as AggregateError).errors).toEqual([second])
    await service.dispose()
  })

  it('contains source-stop rejection even when the reporter itself throws', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const adapter = service.registerAdapter({
      backendId: 'reporter-failure',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => () => Promise.reject(new Error('source-stop-failed')),
      report: () => {
        throw new Error('reporter-failed')
      }
    })
    adapter.startSource()
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(adapter.dispose()).resolves.toBeUndefined()
      expect(fallback).toHaveBeenCalledWith(
        '[storage-web] operation reporter failed',
        expect.objectContaining({ message: 'reporter-failed' })
      )
      await service.dispose()
    } finally {
      fallback.mockRestore()
    }
  })
})
