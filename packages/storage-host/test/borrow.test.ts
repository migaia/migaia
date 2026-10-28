import { PLUGIN_HOST_SOURCE } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  defineStorageCapability,
  implement,
  type ICapabilityInstallPort,
  type IStorageBase
} from '@migaia/storage-contract'
import {
  createStorageHost,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  type IStoragePluginCore,
  type IStorageBorrowedBackend,
  type IStorageFeatureExpose,
  type IStorageBackendKind
} from '../src/index.ts'
import { catalog } from './helpers/catalog.ts'

/** One real map-backed catalog is admitted without requiring a capability provider. */
const kind = defineStorageBackendKind<IStorageBase, Map<string, string>>()('catalog')

/** Each descriptor owns the original catalog map and captures its actual installer. */
function source<const N extends string>(id: N, raw = false) {
  /** The published object remains the one resource handed to its original registration. */
  let state!: Omit<ReturnType<typeof catalog>, 'store'> & { readonly store: IStorageBase }
  /** Named factories preserve the exact native store shape for host typing. */
  const descriptor = (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => state.client }),
    install: () => {
      /** Keep the actual provider output available while selecting the raw variant. */
      const created = catalog(core)
      state = created
      /** A real receiver-sensitive method proves the view never substitutes its empty target. */
      Object.defineProperty(created.store, 'receiver', {
        value: function (this: IStorageBase) {
          return this === state.store
        },
        enumerable: true
      })
      state.client.set('name', id)
      if (raw) {
        /** A new raw resource identity has no provider entry and requires no token patching. */
        const { has: _has, use: _use, ...base } = created.store
        state = { ...state, store: Object.freeze(base) }
      } else Object.freeze(state.store)
      core.registerStore(state.store)
      return {}
    }
  })
  return { plugin: definePlugin(id, descriptor), state: () => state }
}

describe('installation-scoped backend borrowing', () => {
  it('borrows three earlier committed resources from both core and Feature without close authority', async () => {
    /** Three actual source instances distinguish dependency lookup from an alias or copied map. */
    const sources = [source('left'), source('middle', true), source('right')]
    /** Only the borrower retains these close-free views; no source disposer is acquired. */
    const views: IStorageBorrowedBackend[] = []
    /** Retain the original core solely to prove its existing installation admission. */
    let installedCore!: Pick<IStoragePluginCore, 'getPublishedBackend'>
    /** Feature construction uses the same installation port on its own original expose. */
    let expose!: IStorageFeatureExpose<IStorageBackendKind>
    /** All selected Feature construction runs through the native Feature graph. */
    const feature = defineFeature(kind, (core) => {
      expose = core.featureExpose
      for (const id of ['left', 'middle', 'right'])
        views.push(core.featureExpose.getPublishedBackend(id))
      return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
    })
    await using host = await createStorageHost({ plugins: sources.map((item) => item.plugin) })
    /** An ordinary plugin borrows through the same core without claiming a backend. */
    const ordinary = definePlugin('consumer', (core) => {
      installedCore = core
      for (const id of ['left', 'middle', 'right']) views.push(core.getPublishedBackend(id))
      return { install: () => ({ ping: () => 42 }) }
    })
    /** The Feature-bearing backend owns only its own newly constructed map. */
    let own!: ReturnType<typeof catalog>
    const descriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => own.client }),
      install: () => {
        own = catalog(core)
        core.registerStore(own.store)
        return {}
      }
    })
    await host.use(ordinary, definePlugin('featureConsumer', descriptor, { feature }))
    expect(views).toHaveLength(6)
    for (const [index, view] of views.entries()) {
      expect(view).not.toBe(sources[index % 3]!.state().store)
      expect('dispose' in view).toBe(false)
      expect(Symbol.asyncDispose in view).toBe(false)
      expect(Reflect.ownKeys(view)).not.toContain('dispose')
      expect(Reflect.ownKeys(view)).not.toContain(Symbol.asyncDispose)
      expect(Object.getOwnPropertyDescriptor(view, 'dispose')).toBeUndefined()
      expect(Reflect.get(view, Symbol.asyncDispose)).toBeUndefined()
      /** Native methods retain their exact result and original source-map receiver. */
      const read = Reflect.get(view, 'get') as (key: string) => Promise<string>
      await expect(read('name')).resolves.toBe(sources[index % 3]!.plugin.id)
      /** Original native Promise identity survives the borrowing projection. */
      const original = Reflect.get(view, 'original') as () => Promise<string>
      expect(original()).toBe(sources[index % 3]!.state().nativePromise)
      expect(Reflect.get(view, 'receiver')()).toBe(true)
      expect(Object.getOwnPropertyDescriptor(view, 'original')!.value).toBe(original)
    }
    expect(() => installedCore.getPublishedBackend('left')).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    expect(() => expose.getPublishedBackend('left')).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    for (const item of sources) expect(item.state().cleanup).not.toHaveBeenCalled()
  })

  it('reads the original live provider table while preserving raw and frozen bases', async () => {
    /** An authentic token and implementation are owned only by the original contract provider. */
    const token = defineStorageCapability<{ read(): number }>()('borrowed-read')
    /** Late publication must return this exact backend API without rebinding it. */
    const api = { read: () => 7, native: () => 8 }
    /** Capture real installation authority directly from the original catalog fixture. */
    let installer!: ICapabilityInstallPort
    /** The raw and provided instances remain independent resources. */
    const provided = source('provided')
    const raw = source('raw', true)
    await using host = await createStorageHost({ plugins: [provided.plugin, raw.plugin] })
    installer = provided.state().installer
    /** Capture views only during their own original registration's installation phase. */
    let view!: IStorageBorrowedBackend
    let rawView!: IStorageBorrowedBackend
    await host.use(
      definePlugin('reads', (core) => {
        view = core.getPublishedBackend('provided')
        rawView = core.getPublishedBackend('raw')
        return {}
      })
    )
    expect(view.has(token)).toBe(false)
    expect(rawView.has(token)).toBe(false)
    expect(() => rawView.use(token)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    /** The same published table stays live through later publication and release. */
    const publication = installer.prepare([implement(token, api)])
    publication.publish()
    expect(view.has(token)).toBe(true)
    expect(view.use(token)).toBe(api)
    expect(() => view.use({ name: token.name } as typeof token)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    publication.release()
    expect(view.has(token)).toBe(false)
    expect(() => view.use(token)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(Object.hasOwn(raw.state().store, 'has')).toBe(false)
    expect(Object.hasOwn(raw.state().store, 'use')).toBe(false)
    expect(Object.isFrozen(raw.state().store)).toBe(true)
  })

  it('rejects current-batch, future and unknown dependencies without closing an earlier resource', async () => {
    /** This original resource is already committed before each failed consumer batch. */
    const original = source('original')
    await using host = await createStorageHost({ plugins: [original.plugin] })
    for (const id of ['sameBatch', 'future', 'unknown']) {
      /** Capture the exact admission error through the original batch rollback boundary. */
      const consumer = definePlugin(`consumer-${id}`, (core) => ({
        install: () => {
          core.getPublishedBackend(id)
          return {}
        }
      }))
      /** Original PluginHost wrapping remains intact, so inspect the bounded original cause chain. */
      const failure = await host.use(source('sameBatch').plugin, consumer).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
      expect(walkErrorCauses(failure)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'BACKEND_NOT_INSTALLED' })])
      )
      expect(original.state().cleanup).not.toHaveBeenCalled()
    }
  })

  it('invalidates captured business methods through the original registration after disposal', async () => {
    /** A real source method remains callable only while both original owners remain current. */
    const original = source('original')
    const host = await createStorageHost({ plugins: [original.plugin] })
    /** Capture one method independently from the view to exercise the invocation guard. */
    let call!: () => Promise<string>
    await host.use(
      definePlugin('consumer', (core) => {
        call = Reflect.get(core.getPublishedBackend('original'), 'original')
        return {}
      })
    )
    expect(call()).toBe(original.state().nativePromise)
    await host.dispose()
    expect(() => call()).toThrowError(expect.objectContaining({ source: PLUGIN_HOST_SOURCE }))
    expect(original.state().cleanup).toHaveBeenCalledOnce()
  })
})
