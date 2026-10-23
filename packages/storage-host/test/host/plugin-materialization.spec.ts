import { createManualScheduler } from '@migaia/utils/testing'
import { snapshotStorageBaseDetailed, type IKeyValueStore } from '@migaia/storage-contract'
import { describe, expect, it } from 'vitest'
import {
  assertStorageBackendId,
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  StorageHostFacade,
  STORAGE_HOST_SOURCE,
  type IStoragePluginCore
} from '../../src/index.js'
import { memoryBackend } from '../helpers/memory.js'

/** Admission baselines supply the same resource label without requiring memory-native ports. */
const kind = defineStorageBackendKind()('memory')

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
const createReceiverDependentStore = async () => {
  const source = await memoryBackend()
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
    readonly clearAll = source.clearAll;

    /** Symbolic cleanup follows the same private-state owner without re-reading dispose. */
    [Symbol.asyncDispose](): Promise<void> {
      return this.disposeMethod().catch(() => {})
    }

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

describe('PluginHost materialization', () => {
  it('keeps the prior registry intact and rolls back a failed dynamic batch', async () => {
    const host = await createStorageHost()
    const firstStore = await memoryBackend()
    const failedStore = await memoryBackend()
    let failedStoreDisposals = 0
    const trackedFailedStore = {
      ...failedStore,
      dispose: async () => {
        failedStoreDisposals += 1
        await failedStore.dispose()
      }
    } as IKeyValueStore
    const first = definePlugin('first', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => {
        core.registerStore(firstStore)
        return {}
      }
    }))
    const failed = definePlugin('failed', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
    const source = await memoryBackend()
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
    const plugin = definePlugin('hostile', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
    const source = await memoryBackend()
    const cause = new Error('capabilities accessor failure')
    const hostileStore = Object.create(source) as IKeyValueStore
    Object.defineProperty(hostileStore, 'capabilities', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw cause
      }
    })
    const plugin = definePlugin('hostile-cause', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
      source: STORAGE_HOST_SOURCE,
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
      source: STORAGE_HOST_SOURCE,
      code: 'BACKEND_PLUGIN_INVALID'
    })
    expect((optionsError as Error).cause).toBe(optionsCause)
  })

  it('uses the captured disposer exactly once during rollback and Host disposal', async () => {
    const rollbackStore = await memoryBackend()
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
    const rollback = definePlugin('captured-rollback', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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

    const disposeStore = await memoryBackend()
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
    const installed = definePlugin('captured-dispose', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
    /** Late failed handoff uses the original diagnostic channel after timeout wins. */
    const reported = deferred<unknown>()
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = await memoryBackend()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('late', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: async () => {
        core.registerStore(await late.promise)
        return {}
      }
    }))
    const host = await createStorageHost({
      scheduler,
      installTimeoutMs: 1,
      report: reported.resolve
    })
    const installation = host.use(plugin)
    await Promise.resolve()
    scheduler.advance(1)
    await expect(installation).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    late.resolve(lateStore)
    await Promise.resolve()
    await Promise.resolve()
    expect(await reported.promise).toMatchObject({
      source: STORAGE_HOST_SOURCE,
      code: 'STORAGE_HOST_DISPOSED'
    })
    expect(disposals).toBe(1)
    expect(host.hasBackend('late')).toBe(false)
    await host.dispose()
  })

  it('seals an initially failed native Host and cleans its late Store', async () => {
    const scheduler = createManualScheduler()
    /** Late failed handoff uses the original diagnostic channel after timeout wins. */
    const reported = deferred<unknown>()
    const late = deferred<IKeyValueStore>()
    let disposals = 0
    const store = await memoryBackend()
    const lateStore = {
      ...store,
      dispose: async () => {
        disposals += 1
        await store.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('initial', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: async () => {
        core.registerStore(await late.promise)
        return {}
      }
    }))
    const creation = createStorageHost({
      plugins: [plugin] as const,
      scheduler,
      installTimeoutMs: 1,
      report: reported.resolve
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
    expect(await reported.promise).toMatchObject({
      source: STORAGE_HOST_SOURCE,
      code: 'STORAGE_HOST_DISPOSED'
    })
    expect(disposals).toBe(1)
  })

  it('rolls back a registered Store when native install times out, then accepts a retry', async () => {
    const scheduler = createManualScheduler()
    const late = deferred<void>()
    let disposals = 0
    const source = await memoryBackend()
    const store = {
      ...source,
      dispose: async () => {
        disposals += 1
        await source.dispose()
      }
    } as IKeyValueStore
    const blocked = definePlugin('registered-timeout', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
    const retryStore = await memoryBackend()
    const retry = definePlugin('retry', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => {
        core.registerStore(retryStore)
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
    const source = await memoryBackend()
    const callerStore = {
      ...source,
      dispose: async () => {
        disposals += 1
        await source.dispose()
      }
    } as IKeyValueStore
    const plugin = definePlugin('ordinary-failure', (core: IStoragePluginCore) => {
      capturedCore = core
      return {
        kind,
        featureExpose: () => ({ getClient: () => undefined }),
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
    const firstSource = await memoryBackend()
    const secondSource = await memoryBackend()
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
    const plugin = definePlugin('duplicate-after-timeout', (core: IStoragePluginCore) => {
      capturedCore = core
      return {
        kind,
        featureExpose: () => ({ getClient: () => undefined }),
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
    const direct = await createReceiverDependentStore()
    const directAdmission = snapshotStorageBaseDetailed(direct.store)
    expect(directAdmission.valid).toBe(true)
    if (directAdmission.valid)
      await Reflect.apply(directAdmission.dispose, directAdmission.receiver, [])
    expect(direct.counts.getterReads).toBe(1)
    expect(direct.counts.calls).toBe(1)

    const hostOwned = await createReceiverDependentStore()
    const plugin = definePlugin('receiver-dependent', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
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
      source: STORAGE_HOST_SOURCE,
      code: 'BACKEND_ID_INVALID'
    })

    const plugin = definePlugin('invalid', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => {
        core.registerStore({} as IKeyValueStore)
        return {}
      }
    }))
    const host = await createStorageHost()
    const failure = await host.use(plugin).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { cause: { source: STORAGE_HOST_SOURCE, code: 'BACKEND_PLUGIN_INVALID' } }
    })
    await host.dispose()
  })
})
