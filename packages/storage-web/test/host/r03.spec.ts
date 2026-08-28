import { invokeCaptured } from '@migaia/plugin-host'
import { snapshotKeyValueStoreDetailed } from '@migaia/storage-contract'
import { describe, expect, it } from 'vitest'
import {
  createStorageHost,
  defineStorageBackendKind,
  defineStorageBackendPlugin,
  StorageHostFacade
} from '../../src/host/index.js'
import { cookieBackendPlugin } from '../../src/plugins/cookies.js'
import { localStorageBackendPlugin } from '../../src/plugins/local-storage.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { sessionStorageBackendPlugin } from '../../src/plugins/session-storage.js'
import { memoryStorage } from '../../src/backends/memory.js'
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

/** Deferred promise used to prove bounded factory settlement and late-store ownership. */
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
  const source = memoryStorage()
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
    const localStorage = createWebStorage()
    const sessionStorage = createWebStorage()
    const cookieDocument = { cookie: '' }
    const customKind = defineStorageBackendKind<IKeyValueStore>()('custom')
    const customStore = memoryStorage()
    const customPlugin = defineStorageBackendPlugin({
      backendKind: customKind,
      id: 'custom',
      create: () => customStore
    })
    const host = await createStorageHost({
      plugins: [
        customPlugin,
        memoryBackendPlugin({ id: 'memory' }),
        localStorageBackendPlugin({ id: 'local', storage: localStorage }),
        sessionStorageBackendPlugin({ id: 'session', storage: sessionStorage }),
        cookieBackendPlugin({ id: 'cookies', document: cookieDocument })
      ] as const
    })

    expect(host.backends().size).toBe(5)
    expect(host.backend('custom')).toBe(customStore)
    expect(host.hasBackend('memory')).toBe(true)
    expect(host.hasBackend('local')).toBe(true)
    expect(host.hasBackend('session')).toBe(true)
    expect(host.hasBackend('cookies')).toBe(true)
    expect(host.hasReactiveBackend('memory')).toBe(false)
    await host.dispose()
  })

  it('keeps the prior registry intact and rolls back a failed dynamic batch', async () => {
    const host = await createStorageHost()
    const kind = defineStorageBackendKind<IKeyValueStore>()('rollback')
    const firstStore = memoryStorage()
    const failedStore = memoryStorage()
    let failedStoreDisposals = 0
    const trackedFailedStore = {
      ...failedStore,
      dispose: async () => {
        failedStoreDisposals += 1
        await failedStore.dispose()
      }
    } as IKeyValueStore
    const first = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'first',
      create: () => firstStore
    })
    const failed = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'failed',
      create: () => trackedFailedStore
    })
    const throws = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'throws',
      create: () => {
        throw new Error('factory failure')
      }
    })
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
    const source = memoryStorage()
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
    const kind = defineStorageBackendKind<IKeyValueStore>()('hostile-snapshot')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'hostile',
      create: () => hostileStore
    })
    const host = await createStorageHost({ plugins: [plugin] as const })
    expect(backendReads).toBe(1)
    expect(host.backend('hostile')).toBe(hostileStore)
    await host.dispose()
  })

  it('retains the exact cause from a hostile contract accessor as native coded TypeError', async () => {
    const source = memoryStorage()
    const cause = new Error('capabilities accessor failure')
    const hostileStore = Object.create(source) as IKeyValueStore
    Object.defineProperty(hostileStore, 'capabilities', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw cause
      }
    })
    const kind = defineStorageBackendKind<IKeyValueStore>()('hostile-cause')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'hostile-cause',
      create: () => hostileStore
    })
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

  it('snapshots descriptor and Host option getters once with exact native causes', () => {
    const kind = defineStorageBackendKind<IKeyValueStore>()('descriptor-cause')
    const descriptorCause = new Error('descriptor accessor failure')
    const descriptor = new Proxy(
      {
        backendKind: kind,
        id: 'descriptor-cause',
        create: () => memoryStorage()
      },
      {
        get: (target, property, receiver) => {
          if (property === 'timeoutMs') throw descriptorCause
          return Reflect.get(target, property, receiver)
        }
      }
    )
    let descriptorError: unknown
    try {
      defineStorageBackendPlugin(descriptor as never)
    } catch (error) {
      descriptorError = error
    }
    expect(descriptorError).toBeInstanceOf(TypeError)
    expect(descriptorError).toMatchObject({
      source: '@migaia/storage-web',
      code: 'BACKEND_PLUGIN_INVALID'
    })
    expect((descriptorError as Error).cause).toBe(descriptorCause)

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
    const kind = defineStorageBackendKind<IKeyValueStore>()('captured-disposer')
    const rollbackStore = memoryStorage()
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
    const rollback = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'captured-rollback',
      create: () => hostileRollbackStore
    })
    const throws = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'captured-throws',
      create: () => {
        throw new Error('rollback')
      }
    })
    const host = await createStorageHost()
    await expect(host.use(rollback, throws)).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(rollbackGetterReads).toBe(1)
    expect(rollbackCalls).toBe(1)
    await host.dispose()

    const disposeStore = memoryStorage()
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
    const installed = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'captured-dispose',
      create: () => hostileDisposeStore
    })
    const installedHost = await createStorageHost({ plugins: [installed] as const })
    await installedHost.dispose()
    expect(disposeGetterReads).toBe(1)
    expect(disposeCalls).toBe(1)
  })

  it('bounds a factory and disposes a late store exactly once', async () => {
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = memoryStorage()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const kind = defineStorageBackendKind<IKeyValueStore>()('deadline')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'late',
      timeoutMs: 1,
      create: () => late.promise
    })
    const host = await createStorageHost()
    await expect(host.use(plugin)).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    late.resolve(lateStore)
    await Promise.resolve()
    await Promise.resolve()
    expect(disposals).toBe(1)
    expect(host.hasBackend('late')).toBe(false)
    await host.dispose()
  })

  it('seals an initial failed host and cleans a late factory result', async () => {
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = memoryStorage()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const kind = defineStorageBackendKind<IKeyValueStore>()('initial-failure')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'initial',
      timeoutMs: 1,
      create: () => late.promise
    })
    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    late.resolve(lateStore)
    await Promise.resolve()
    await Promise.resolve()
    expect(disposals).toBe(1)
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
    const kind = defineStorageBackendKind<IKeyValueStore>()('receiver-dependent')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'receiver-dependent',
      create: () => hostOwned.store
    })
    const host = await createStorageHost({ plugins: [plugin] as const })
    await host.dispose()
    expect(hostOwned.counts.getterReads).toBe(1)
    expect(hostOwned.counts.calls).toBe(1)
  })

  it('reports invalid admission as native coded TypeError', async () => {
    let invalidIdError: unknown
    try {
      defineStorageBackendKind<IKeyValueStore>()('bad id')
    } catch (error) {
      invalidIdError = error
    }
    expect(invalidIdError).toBeInstanceOf(TypeError)
    expect(invalidIdError).toMatchObject({
      source: '@migaia/storage-web',
      code: 'BACKEND_ID_INVALID'
    })

    const kind = defineStorageBackendKind<IKeyValueStore>()('invalid-store')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'invalid',
      create: () => ({}) as IKeyValueStore
    })
    const host = await createStorageHost()
    const failure = await host.use(plugin).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { cause: { source: '@migaia/storage-web', code: 'BACKEND_PLUGIN_INVALID' } }
    })
    await host.dispose()
  })
})
