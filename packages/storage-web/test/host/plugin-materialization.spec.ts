import { invokeCaptured } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/lifecycle'
import { snapshotKeyValueStoreDetailed } from '@migaia/storage-contract'
import { describe, expect, it } from 'vitest'
import {
  assertStorageBackendId,
  createStorageHost,
  definePlugin,
  StorageHostFacade
} from '../../src/host/index.js'
import { cookieBackendPlugin } from '../../src/plugins/cookies.js'
import { localStorageBackendPlugin } from '../../src/plugins/local-storage.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { sessionStorageBackendPlugin } from '../../src/plugins/session-storage.js'
import { memoryStorageHost } from '../../src/backends/memory.js'
import type { IKeyValueStore, IWebStorageLike } from '../../src/types/storage.js'

/** Minimal injected Web Storage implementation for the two browser-backed built-ins. */
const createWebStorage = (): IWebStorageLike => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null
  }
}

/** Deferred Store settlement proves Host deadline ownership after native installation times out. */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  return { promise, resolve, reject }
}

/** Builds a store whose disposer requires the original receiver and private state. */
const createReceiverDependentStore = () => {
  const source = memoryStorageHost()
  const counts = { getterReads: 0, calls: 0 }
  class ReceiverDependentStore {
    /** Tracks whether this store has already completed its one allowed disposal. */
    #disposed = false
    readonly backend = source.backend
    readonly capabilities = source.capabilities
    readonly get = source.get
    readonly set = source.set
    readonly remove = source.remove
    readonly has = source.has
    readonly keys = source.keys
    readonly clearValues = source.clearValues
    readonly clearAll = source.clearAll

    /** Counts hostile getter reads while returning the method that needs this receiver. */
    get dispose(): () => Promise<void> {
      counts.getterReads += 1
      return this.disposeMethod
    }

    /** Uses private state to prove cleanup was invoked with this exact store receiver. */
    disposeMethod(): Promise<void> {
      if (this.#disposed) return Promise.resolve()
      this.#disposed = true
      counts.calls += 1
      return source.dispose()
    }
  }
  return { store: new ReceiverDependentStore() as IKeyValueStore, counts }
}

describe('SWV4-B02 R03 PluginHost materialization', () => {
  it('materializes custom and four canonical synchronous backends with exact identities', async () => {
    const localStorageHost = createWebStorage()
    const sessionStorageHost = createWebStorage()
    const cookieDocument = { cookie: '' }
    const customStore = memoryStorageHost()
    const customPlugin = definePlugin('custom', (core) => ({
      install: () => {
        core.registerStore(customStore)
        return {}
      }
    }))
    const host = await createStorageHost({
      plugins: [
        customPlugin,
        memoryBackendPlugin({ id: 'memory' }),
        localStorageBackendPlugin({ id: 'local', storage: localStorageHost }),
        sessionStorageBackendPlugin({ id: 'session', storage: sessionStorageHost }),
        cookieBackendPlugin({ id: 'cookiesHost', document: cookieDocument })
      ] as const
    })

    expect(host.backends().size).toBe(5)
    expect(host.backend('custom')).toBe(customStore)
    expect(host.hasBackend('memory')).toBe(true)
    expect(host.hasBackend('local')).toBe(true)
    expect(host.hasBackend('session')).toBe(true)
    expect(host.hasBackend('cookiesHost')).toBe(true)
    expect(host.hasReactiveBackend('memory')).toBe(false)
    await host.dispose()
  })

  it('keeps the prior registry intact and rolls back a failed dynamic batch', async () => {
    const host = await createStorageHost()
    const firstStore = memoryStorageHost()
    const failedStore = memoryStorageHost()
    let failedStoreDisposals = 0
    const trackedFailedStore = {
      ...failedStore,
      dispose: async () => {
        failedStoreDisposals += 1
        await failedStore.dispose()
      }
    } as IKeyValueStore
    const first = definePlugin('first', (core) => ({
      install: () => {
        core.registerStore(firstStore)
        return {}
      }
    }))
    const failed = definePlugin('failed', (core) => ({
      install: () => {
        core.registerStore(trackedFailedStore)
        return {}
      }
    }))
    const throws = definePlugin('throws', () => ({
      install: () => {
        throw new Error('factory failure')
      }
    }))
    const installed = await host.use(first)
    await expect(host.use(failed, throws)).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(installed.backend('first')).toBe(firstStore)
    expect(host.hasBackend('failed')).toBe(false)
    expect(host.hasBackend('throws')).toBe(false)
    expect(failedStoreDisposals).toBe(1)
    await host.dispose()
  })

  it('snapshots a hostile store once before publication and leaves failed batches absent', async () => {
    const source = memoryStorageHost()
    let backendReads = 0
    const hostileStore = Object.create(source) as IKeyValueStore
    Object.defineProperty(hostileStore, 'backend', {
      configurable: true,
      enumerable: true,
      get: () => {
        backendReads += 1
        if (backendReads > 1) throw new Error('post-commit backend reread')
        return source.backend
      }
    })
    const plugin = definePlugin('hostile', (core) => ({
      install: () => {
        core.registerStore(hostileStore)
        return {}
      }
    }))
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect(backendReads).toBe(1)
    expect(host.backend('hostile')).toBe(hostileStore)
    await host.dispose()
  })

  it('retains the exact cause from a hostile contract accessor as native coded TypeError', async () => {
    const source = memoryStorageHost()
    const cause = new Error('capabilities accessor failure')
    const hostileStore = Object.create(source) as IKeyValueStore
    Object.defineProperty(hostileStore, 'capabilities', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw cause
      }
    })
    const plugin = definePlugin('hostile-cause', (core) => ({
      install: () => {
        core.registerStore(hostileStore)
        return {}
      }
    }))
    const host = await createStorageHost()
    const failure = (await host.use(plugin).catch((error: unknown) => error)) as {
      readonly cause?: { readonly cause?: unknown }
    }
    expect(failure.cause?.cause).toBeInstanceOf(TypeError)
    expect(failure.cause?.cause).toMatchObject({
      source: '@migaia/storage-web',
      code: 'BACKEND_PLUGIN_INVALID'
    })
    const nativeFailure = failure.cause?.cause
    expect((nativeFailure as Error).cause).toBe(cause)
    await host.dispose()
  })

  it('snapshots Host option getters once with exact native causes', () => {
    const optionsCause = new Error('Host option accessor failure')
    const options = Object.defineProperty({}, 'installTimeoutMs', {
      configurable: true,
      get: () => {
        throw optionsCause
      }
    })
    let optionsError: unknown
    try {
      new StorageHostFacade(options as never)
    } catch (error) {
      optionsError = error
    }
    expect(optionsError).toBeInstanceOf(TypeError)
    expect(optionsError).toMatchObject({
      source: '@migaia/storage-web',
      code: 'BACKEND_PLUGIN_INVALID'
    })
    expect((optionsError as Error).cause).toBe(optionsCause)
  })

  it('uses the captured disposer exactly once during rollback and Host disposal', async () => {
    const rollbackStore = memoryStorageHost()
    let rollbackGetterReads = 0
    let rollbackCalls = 0
    const hostileRollbackStore = Object.create(rollbackStore) as IKeyValueStore
    Object.defineProperty(hostileRollbackStore, 'dispose', {
      configurable: true,
      enumerable: true,
      get: () => {
        rollbackGetterReads += 1
        return async () => {
          rollbackCalls += 1
          await rollbackStore.dispose()
        }
      }
    })
    const rollback = definePlugin('captured-rollback', (core) => ({
      install: () => {
        core.registerStore(hostileRollbackStore)
        return {}
      }
    }))
    const throws = definePlugin('captured-throws', () => ({
      install: () => {
        throw new Error('rollback')
      }
    }))
    const host = await createStorageHost()
    await expect(host.use(rollback, throws)).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(rollbackGetterReads).toBe(1)
    expect(rollbackCalls).toBe(1)
    await host.dispose()

    const disposeStore = memoryStorageHost()
    let disposeGetterReads = 0
    let disposeCalls = 0
    const hostileDisposeStore = Object.create(disposeStore) as IKeyValueStore
    Object.defineProperty(hostileDisposeStore, 'dispose', {
      configurable: true,
      enumerable: true,
      get: () => {
        disposeGetterReads += 1
        return async () => {
          disposeCalls += 1
          await disposeStore.dispose()
        }
      }
    })
    const installed = definePlugin('captured-dispose', (core) => ({
      install: () => {
        core.registerStore(hostileDisposeStore)
        return {}
      }
    }))
    const installedHost = await createStorageHost({ plugins: [installed] as const })
    await installedHost.dispose()
    expect(disposeGetterReads).toBe(1)
    expect(disposeCalls).toBe(1)
  })

  it('bounds a native async install and disposes its late Store exactly once', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = memoryStorageHost()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('late', (core) => ({
      install: async () => {
        core.registerStore(await late.promise)
        return {}
      }
    }))
    const host = await createStorageHost({ scheduler, installTimeoutMs: 1 })
    const installation = host.use(plugin)
    await Promise.resolve()
    scheduler.advance(1)
    await expect(installation).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    late.resolve(lateStore)
    await Promise.resolve()
    await Promise.resolve()
    expect(disposals).toBe(1)
    expect(host.hasBackend('late')).toBe(false)
    await host.dispose()
  })

  it('seals an initially failed native Host and cleans its late Store', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = memoryStorageHost()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('initial', (core) => ({
      install: async () => {
        core.registerStore(await late.promise)
        return {}
      }
    }))
    const creation = createStorageHost({
      plugins: [plugin] as const,
      scheduler,
      installTimeoutMs: 1
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    scheduler.advance(1)
    await expect(creation).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    late.resolve(lateStore)
    await Promise.resolve()
    await Promise.resolve()
    expect(disposals).toBe(1)
  })

  it('rolls back a registered Store when native install times out, then accepts a retry', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<void>()
    let disposals = 0
    const source = memoryStorageHost()
    const store = {
      ...source,
      dispose: async () => {
        disposals += 1
        await source.dispose()
      }
    } as IKeyValueStore
    const blocked = definePlugin('registered-timeout', (core) => ({
      install: async () => {
        core.registerStore(store)
        await late.promise
        return {}
      }
    }))
    const host = await createStorageHost({ scheduler, installTimeoutMs: 1 })
    const installation = host.use(blocked)
    await Promise.resolve()
    scheduler.advance(1)
    await expect(installation).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect(host.hasBackend('registered-timeout')).toBe(false)
    expect(disposals).toBe(1)
    const retry = definePlugin('retry', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      }
    }))
    await host.use(retry)
    expect(host.hasBackend('retry')).toBe(true)
    late.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(host.hasBackend('registered-timeout')).toBe(false)
    expect(disposals).toBe(1)
    await host.dispose()
  })

  it('keeps caller-owned Stores untouched after an ordinary native install failure', async () => {
    let capturedCore: { readonly registerStore: (store: IKeyValueStore) => void } | undefined
    let disposals = 0
    const source = memoryStorageHost()
    const callerStore = {
      ...source,
      dispose: async () => {
        disposals += 1
        await source.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('ordinary-failure', (core) => {
      capturedCore = core
      return {
        install: () => {
          throw new Error('ordinary failure')
        }
      }
    })
    const host = await createStorageHost()
    await expect(host.use(plugin)).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect(() => capturedCore!.registerStore(callerStore)).toThrow()
    expect(disposals).toBe(0)
    await host.dispose()
  })

  it('does not dispose a duplicate Store after an already-transferred install times out', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<void>()
    let capturedCore: { readonly registerStore: (store: IKeyValueStore) => void } | undefined
    let firstDisposals = 0
    let secondDisposals = 0
    const firstSource = memoryStorageHost()
    const secondSource = memoryStorageHost()
    const firstStore = {
      ...firstSource,
      dispose: async () => {
        firstDisposals += 1
        await firstSource.dispose()
      }
    } as IKeyValueStore
    const secondStore = {
      ...secondSource,
      dispose: async () => {
        secondDisposals += 1
        await secondSource.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('duplicate-after-timeout', (core) => {
      capturedCore = core
      return {
        install: async () => {
          core.registerStore(firstStore)
          await late.promise
          return {}
        }
      }
    })
    const host = await createStorageHost({ scheduler, installTimeoutMs: 1 })
    const installation = host.use(plugin)
    await Promise.resolve()
    scheduler.advance(1)
    await expect(installation).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect(() => capturedCore!.registerStore(secondStore)).toThrow()
    expect(firstDisposals).toBe(1)
    expect(secondDisposals).toBe(0)
    late.resolve()
    await host.dispose()
  })

  it('preserves the receiver for direct and Host-owned private-state disposal', async () => {
    const direct = createReceiverDependentStore()
    const directAdmission = snapshotKeyValueStoreDetailed(direct.store)
    expect(directAdmission.valid).toBe(true)
    if (directAdmission.valid)
      await invokeCaptured(directAdmission.dispose, directAdmission.receiver, [])
    expect(direct.counts.getterReads).toBe(1)
    expect(direct.counts.calls).toBe(1)

    const hostOwned = createReceiverDependentStore()
    const plugin = definePlugin('receiver-dependent', (core) => ({
      install: () => {
        core.registerStore(hostOwned.store)
        return {}
      }
    }))
    const host = await createStorageHost({ plugins: [plugin] as const })
    await host.dispose()
    expect(hostOwned.counts.getterReads).toBe(1)
    expect(hostOwned.counts.calls).toBe(1)
  })

  it('reports invalid admission as native coded TypeError', async () => {
    let invalidIdError: unknown
    try {
      assertStorageBackendId('bad id')
    } catch (error) {
      invalidIdError = error
    }
    expect(invalidIdError).toBeInstanceOf(TypeError)
    expect(invalidIdError).toMatchObject({
      source: '@migaia/storage-web',
      code: 'BACKEND_ID_INVALID'
    })

    const plugin = definePlugin('invalid', (core) => ({
      install: () => {
        core.registerStore({} as IKeyValueStore)
        return {}
      }
    }))
    const host = await createStorageHost()
    const failure = await host.use(plugin).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { cause: { source: '@migaia/storage-web', code: 'BACKEND_PLUGIN_INVALID' } }
    })
    await host.dispose()
  })
})
