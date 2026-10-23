import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  createStorageHost,
  StorageHostFacade,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  StorageErrorCode
} from '../src/index.js'
import type { IStoragePluginCore } from '../src/index.js'
import {
  provideCapabilities,
  type ICapabilityInstallPort,
  type IStorageBase
} from '@migaia/storage-contract'
/** Each fixture owns one native map and one real pair of cleanup promises. */
function catalog(core: IStoragePluginCore, backend = 'catalog') {
  const client = new Map<string, string>()
  let primary: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  const cleanup = vi.fn(() => {
    client.clear()
  })
  const nativePromise = Promise.resolve('native')
  const base: IStorageBase & {
    get(key: string): Promise<string | undefined>
    original(): Promise<string>
    readSync(value: string): string
    voidSync(): void
  } = {
    backend,
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    get: (key: string) =>
      core.execution.run({ operation: 'catalog.get', input: key }, async (value) =>
        client.get(value)
      ),
    original: () =>
      core.execution.run({ operation: 'catalog.original', input: undefined }, () => nativePromise),
    readSync: (value) =>
      core.execution.runSync({ operation: 'catalog.sync', input: value }, (captured) => captured),
    voidSync: () =>
      core.execution.runSync({ operation: 'catalog.void', input: undefined }, () => undefined),
    dispose: () => (primary ??= Promise.resolve().then(cleanup)),
    [Symbol.asyncDispose]: (): Promise<void> => (symbolic ??= base.dispose().catch(() => {}))
  }
  let installer!: ICapabilityInstallPort
  const store = provideCapabilities(base, [], {
    onInstaller: (port) => {
      installer = port
    }
  })
  return { store, client, installer, cleanup, nativePromise }
}
/** The kind describes the real store and native client without granting either one. */
const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
  'catalog'
)
/** A named descriptor preserves the exact store returned by its actual provider. */
function plugin<const N extends string>(name: N, value: string) {
  let state!: ReturnType<typeof catalog>
  const descriptor = (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => state.client }),
    capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
    install: () => {
      state = catalog(core)
      state.client.set('name', value)
      core.registerStore(state.store)
      return {}
    }
  })
  return { plugin: definePlugin(name, descriptor), state: () => state }
}
describe('neutral storage installation', () => {
  it('keeps exact stores, isolated clients, extensions and detached registry snapshots', async () => {
    const left = plugin('left', 'one')
    const right = plugin('right', 'two')
    const host = await createStorageHost({ plugins: [left.plugin, right.plugin] })
    expect(host.backend('left')).toBe(left.state().store)
    expect(host.backend('right')).toBe(right.state().store)
    expect(await host.backend('left').get('name')).toBe('one')
    expect(await host.backend('right').get('name')).toBe('two')
    const snapshot = host.backends()
    expect(snapshot.size).toBe(2)
    Reflect.apply(Map.prototype.clear, snapshot, [])
    expect(host.hasBackend('left')).toBe(true)
    const first = host.dispose()
    expect(host.dispose()).toBe(first)
    const symbol = host[Symbol.asyncDispose]()
    expect(host[Symbol.asyncDispose]()).toBe(symbol)
    expect(symbol).not.toBe(first)
    await Promise.all([first, symbol])
    expect(left.state().cleanup).toHaveBeenCalledTimes(1)
    expect(right.state().cleanup).toHaveBeenCalledTimes(1)
  })
  it('keeps plain native extensions without treating an ordinary plugin as a backend', async () => {
    const ordinary = definePlugin('utility', () => ({ install: () => ({ ping: () => 42 }) }))
    await using host = await createStorageHost({ plugins: [ordinary] })
    expect(host.extensions.ping()).toBe(42)
    expect(host.hasBackend('utility')).toBe(false)
  })
  it('rejects a mismatched same-name token before a Feature factory or driver is used', async () => {
    const otherKind = defineStorageBackendKind<
      ReturnType<typeof catalog>['store'],
      Map<string, string>
    >()('catalog')
    const factory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const feature = defineFeature(otherKind, factory)
    const create = vi.fn()
    const descriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => new Map<string, string>() }),
      install: () => {
        create()
        core.registerStore(catalog(core).store)
        return {}
      }
    })
    const definition = Reflect.apply(definePlugin, undefined, [
      'mismatch',
      descriptor,
      { wrong: feature }
    ])
    await expect(createStorageHost({ plugins: [definition] })).rejects.toMatchObject({
      source: '@migaia/storage-host',
      code: StorageErrorCode.backendInstallFailed
    })
    expect(factory).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
  it('forwards both runners and preserves native Promise identity without stages', async () => {
    const item = plugin('values', 'one')
    await using host = await createStorageHost({ plugins: [item.plugin] })
    expect(host.backend('values').original()).toBe(item.state().nativePromise)
    expect(host.backend('values').readSync('text')).toBe('text')
    expect(host.backend('values').voidSync()).toBeUndefined()
  })
  it('uses the original fixed async runner and rejects its sync entry before effects', async () => {
    const item = plugin('values', 'one')
    let stages = 0
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          stages += 1
          await next({ ...input, input: 'name' })
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [item.plugin, intervention] })
    expect(() => host.backend('values').readSync('text')).toThrowError(
      expect.objectContaining({ code: 'ASYNC_STAGE_IN_SYNC_ENTRY' })
    )
    expect(stages).toBe(0)
    await expect(host.backend('values').get('replaced')).resolves.toBe('one')
    expect(stages).toBe(1)
  })
  it('turns intercepted storage endpoints into the existing aborted error', async () => {
    const item = plugin('values', 'one')
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.usePipeline(() => undefined)
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [item.plugin, intervention] })
    expect(() => host.backend('values').voidSync()).toThrowError(
      expect.objectContaining({ source: '@migaia/storage-contract', code: 'ABORTED' })
    )
    await expect(host.backend('values').original()).rejects.toMatchObject({
      source: '@migaia/storage-contract',
      code: 'ABORTED'
    })
  })
  it('binds selected root Feature API to its own lazy native client', async () => {
    const upper = defineFeature(kind, (_core) => ({
      capabilities: [],
      chain: {},
      api: {
        store: {
          async uppercase(key: string) {
            return this.client.get(key)?.toUpperCase()
          }
        },
        transaction: {}
      }
    }))
    let state!: ReturnType<typeof catalog>
    const descriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => state.client }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
      install: () => {
        state = catalog(core)
        state.client.set('name', 'one')
        core.registerStore(state.store)
        return {}
      }
    })
    const definition = definePlugin('feature', descriptor, { upper })
    const host = await createStorageHost({ plugins: [definition] })
    expect(await host.backend('feature').api.uppercase('name')).toBe('ONE')
    const retained = host.backend('feature').api.uppercase
    await host.dispose()
    await expect(retained('name')).rejects.toBeInstanceOf(Error)
  })
  it('keeps explicit cleanup failure while resource syntax reports one stable projection', async () => {
    /** Original cleanup failure must remain reachable without being replaced by reporting. */
    const original = new Error('cleanup failed')
    /** Reporting is separate from the explicit rejecting cleanup promise. */
    const report = vi.fn()
    /** An ordinary plugin still uses the same native resource ownership as backend plugins. */
    const resource = definePlugin('resource', (core) => ({
      install: () => {
        core.onDispose(() => {
          throw original
        })
        return {}
      }
    }))
    /** One host owns one real cleanup and two cached public promise projections. */
    const host = await createStorageHost({ plugins: [resource], report })
    const primary = host.dispose()
    const failure = await primary.catch((error) => error)
    expect(failure).toMatchObject({
      source: '@migaia/storage-host',
      code: 'STORAGE_HOST_DISPOSE_FAILED'
    })
    expect(failure.errors[0].cause).toBe(original)
    const symbolic = host[Symbol.asyncDispose]()
    expect(host[Symbol.asyncDispose]()).toBe(symbolic)
    await expect(symbolic).resolves.toBeUndefined()
    expect(host.dispose()).toBe(primary)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
  })
  it.each([false, true])(
    'cleans an admitted mismatched store once when cleanup rejects: %s',
    async (failCleanup) => {
      /** Secondary cleanup failure must reach the existing reporter without replacing admission. */
      const cleanupError = new Error('rollback cleanup failed')
      /** The backend kind describes the intended store, independently of a wrong returned label. */
      const expected = defineStorageBackendKind<IStorageBase>()('expected')
      /** Original receiver and call count prove the actual admitted disposer was registered. */
      const cleanup = vi.fn(function (this: IStorageBase) {
        expect(this.backend).toBe('other')
        return failCleanup ? Promise.reject(cleanupError) : Promise.resolve()
      })
      /** The host owns only resources handed over after shape admission. */
      const report = vi.fn()
      /** A fresh base shape deliberately has a valid but mismatched backend label. */
      const descriptor = (core: IStoragePluginCore) => ({
        kind: expected,
        featureExpose: () => ({ getClient: () => undefined }),
        install: () => {
          core.registerStore({
            backend: 'other',
            capabilities: {
              syncRead: false,
              binary: false,
              records: false,
              transactions: false,
              iteration: false,
              secondaryIndexes: false,
              changeFeed: false,
              maxValueBytes: undefined,
              opaqueEntries: false
            },
            dispose: cleanup,
            [Symbol.asyncDispose]: () => Promise.resolve()
          })
          return {}
        }
      })
      /** Installation must remain atomic even though the constructed resource is valid. */
      const failure = await createStorageHost({
        plugins: [definePlugin('wrong', descriptor)],
        report
      }).catch((error) => error)
      expect(failure).toMatchObject({
        source: '@migaia/storage-host',
        code: 'BACKEND_INSTALL_FAILED'
      })
      /** Walk only the bounded existing cause chain to identify the primary semantic rejection. */
      let cursor: unknown = failure
      /** Native install and facade wrappers add a finite number of ownership boundaries. */
      const codes: string[] = []
      for (let depth = 0; depth < 8 && cursor instanceof Error; depth += 1) {
        if ('code' in cursor) codes.push(String(cursor.code))
        cursor = cursor.cause
      }
      expect(codes).toContain('BACKEND_KIND_MISMATCH')
      expect(cleanup).toHaveBeenCalledTimes(1)
      if (failCleanup) expect(report).toHaveBeenCalledExactlyOnceWith(cleanupError)
      else expect(report).not.toHaveBeenCalled()
    }
  )
  it('uses the single captured disposer when a late store loses its batch', async () => {
    /** Pause the actual install before its ownership handoff. */
    const entered = deferred<void>()
    /** Resume only after the host has sealed the original batch. */
    const resume = deferred<void>()
    /** A changing getter would select the wrong cleanup if admission were repeated. */
    let reads = 0
    /** This is the original function and receiver captured by the successful base snapshot. */
    const original = vi.fn(function (this: IStorageBase) {
      expect(this.backend).toBe('late')
      return Promise.resolve()
    })
    /** A second read must never replace the original captured disposer. */
    const replacement = vi.fn(() => Promise.resolve())
    /** The test observes expected late rejection diagnostics without changing cleanup. */
    const report = vi.fn()
    /** The kind and returned store agree; only the closing batch invalidates handoff. */
    const lateKind = defineStorageBackendKind<IStorageBase>()('late')
    /** One host owns the actual asynchronous install and its cancellation signal. */
    const host = new StorageHostFacade({ report })
    /** The getter is legal input to contract single-read admission. */
    const store: IStorageBase = {
      backend: 'late',
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      },
      get dispose() {
        reads += 1
        return reads === 1 ? original : replacement
      },
      [Symbol.asyncDispose]: () => Promise.resolve()
    }
    /** The backend returns its actual resource after its original install has expired. */
    const descriptor = (core: IStoragePluginCore) => ({
      kind: lateKind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: async () => {
        entered.resolve()
        await resume.promise
        core.registerStore(store)
        return {}
      }
    })
    /** Observe the install failure immediately so cancellation cannot create an unhandled rejection. */
    const installing = host.use(definePlugin('late', descriptor)).catch((error) => error)
    await entered.promise
    /** Closing wins publication authority while the backend's actual work remains pending. */
    const closing = host.dispose()
    await installing
    resume.resolve()
    await closing
    expect(reads).toBe(1)
    expect(original).toHaveBeenCalledTimes(1)
    expect(replacement).not.toHaveBeenCalled()
  })
})
