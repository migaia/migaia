import { describe, expect, it, vi } from 'vitest'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  memoryBackendKind,
  memoryBackendPlugin,
  type IStoragePluginCore
} from '../../src/index.js'
import { catalog } from '../helpers/catalog.js'

/** The shared definition retains one kind while every installed native resource stays distinct. */
const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
  'catalog'
)

describe('moved native Feature boundaries', () => {
  it('keeps one shared Feature bound to each exact store, backend id and extension plane', async () => {
    const shared = defineFeature(kind, ({ featureExpose }) => ({
      capabilities: [],
      chain: {},
      api: {
        store: {
          async identity() {
            return { store: featureExpose.getStore(), id: featureExpose.getBackendId() }
          }
        },
        transaction: {}
      }
    }))
    let first!: ReturnType<typeof catalog>
    let second!: ReturnType<typeof catalog>
    const firstDescriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => first.client }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => first.installer,
      install: () => {
        first = catalog(core)
        core.registerStore(first.store)
        return { readFirst: () => core.getStore(), readFirstId: () => core.getBackendId() }
      },
      expose: () => ({ firstVisible: () => true })
    })
    const secondDescriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => second.client }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => second.installer,
      install: () => {
        second = catalog(core)
        core.registerStore(second.store)
        return { readSecond: () => core.getStore(), readSecondId: () => core.getBackendId() }
      },
      expose: () => ({ secondVisible: () => true })
    })
    const firstPlugin = definePlugin('first', firstDescriptor, { shared })
    const secondPlugin = definePlugin('second', secondDescriptor, { shared })
    expect(firstPlugin.id).toBe('first')
    expect(secondPlugin.id).toBe('second')
    await using host = await createStorageHost({ plugins: [firstPlugin, secondPlugin] })
    const firstStore = host.backend('first')
    const secondStore = host.backend('second')
    expect(firstStore).toBe(first.store)
    expect(secondStore).toBe(second.store)
    expect(firstStore).not.toBe(secondStore)
    expect(await firstStore.api.identity()).toEqual({ store: firstStore, id: 'first' })
    expect(await secondStore.api.identity()).toEqual({ store: secondStore, id: 'second' })
    expect(host.extensions.readFirst()).toBe(firstStore)
    expect(host.extensions.readSecond()).toBe(secondStore)
    expect(host.extensions.readFirstId()).toBe('first')
    expect(host.extensions.readSecondId()).toBe('second')
    expect(host.extensions.firstVisible()).toBe(true)
    expect(host.extensions.secondVisible()).toBe(true)
    expect(firstStore).not.toHaveProperty('readFirst')
    expect(secondStore).not.toHaveProperty('readSecond')
  })

  it('rejects a dependency-only wrong kind before any descriptor or Feature factory runs', () => {
    const foreignKind = defineStorageBackendKind()('foreign')
    const dependencyFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const dependency = defineFeature(foreignKind, dependencyFactory)
    const wrapperFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const descriptor = vi.fn(() => ({ install: () => ({}) }))
    expect(() => {
      /** Bypass only static rejection to exercise the actual public dependency admission. */
      const wrapper = Reflect.apply(defineFeature, undefined, [
        kind,
        wrapperFactory,
        { dependency }
      ])
      Reflect.apply(definePlugin, undefined, ['wrong-dependency', descriptor, { wrapper }])
    }).toThrowError(expect.objectContaining({ code: 'BACKEND_KIND_MISMATCH' }))
    expect(dependencyFactory).not.toHaveBeenCalled()
    expect(wrapperFactory).not.toHaveBeenCalled()
    expect(descriptor).not.toHaveBeenCalled()
  })

  it('inspects the original native Feature closure without executing either factory', () => {
    const sourceFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const source = defineFeature(kind, sourceFactory)
    const derivedFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const derived = defineFeature(kind, derivedFactory, { source })
    expect(inspectFeatures({ derived }).ordered).toEqual([source, derived])
    expect(sourceFactory).not.toHaveBeenCalled()
    expect(derivedFactory).not.toHaveBeenCalled()
  })

  it('materializes a native Feature with the original Host scheduler', async () => {
    const scheduler = createManualScheduler()
    let receivedScheduler: IScheduler | undefined
    const feature = defineFeature(memoryBackendKind, ({ featureExpose }) => {
      receivedScheduler = featureExpose.getScheduler()
      return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
    })
    await using host = await createStorageHost({ scheduler })
    await host.use(memoryBackendPlugin(undefined, { feature }))
    expect(receivedScheduler).toBeDefined()
    let scheduled = false
    receivedScheduler!.schedule(() => {
      scheduled = true
    }, 5)
    scheduler.advance(5)
    expect(scheduled).toBe(true)
  })
})
