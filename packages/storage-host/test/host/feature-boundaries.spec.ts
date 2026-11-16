import { describe, expect, it, vi } from 'vitest'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  createStorageHost,
  type IStoragePluginCore,
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageBackendPluginDefiner
} from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { catalog } from '../helpers/catalog.ts'
import { defineStorageFeature, defineBackendPlugin } from '../../src/sdk.ts'
import type { IMemoryBackend } from '../../src/plugins/memory.ts'

/** Feature definer typed for the imported backend. */
const defineMemoryFeature: IStorageFeatureDefiner<IMemoryBackend> = defineStorageFeature

/** The shared definition retains one kind while every installed native resource stays distinct. */
type IKindBackend = IStorageBackendType<ReturnType<typeof catalog>['store'], Map<string, string>>
/** Backend-plugin definer typed for this test backend. */
const defineKindBackend: IStorageBackendPluginDefiner<IKindBackend> = defineBackendPlugin
/** Feature definer typed for this test backend. */
const defineKindFeature: IStorageFeatureDefiner<IKindBackend> = defineStorageFeature

describe('moved native Feature boundaries', () => {
  it('keeps one shared Feature bound to each exact store, backend id and extension plane', async () => {
    const shared = defineKindFeature(({ featureExpose }) => ({
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
      featureExpose: () => ({ getClient: () => second.client }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => second.installer,
      install: () => {
        second = catalog(core)
        core.registerStore(second.store)
        return { readSecond: () => core.getStore(), readSecondId: () => core.getBackendId() }
      },
      expose: () => ({ secondVisible: () => true })
    })
    const firstPlugin = defineKindBackend({
      name: 'first',
      features: { shared },
      open: firstDescriptor
    })
    const secondPlugin = defineKindBackend({
      name: 'second',
      features: { shared },
      open: secondDescriptor
    })
    expect(firstPlugin.name).toBe('first')
    expect(secondPlugin.name).toBe('second')
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

  it('inspects the original native Feature closure without executing either factory', () => {
    const sourceFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const source = defineKindFeature(sourceFactory)
    const derivedFactory = vi.fn(() => ({
      capabilities: [],
      chain: {},
      api: { store: {}, transaction: {} }
    }))
    const derived = defineKindFeature(derivedFactory, { source })
    expect(inspectFeatures({ derived }).ordered).toEqual([source, derived])
    expect(sourceFactory).not.toHaveBeenCalled()
    expect(derivedFactory).not.toHaveBeenCalled()
  })

  it('materializes a native Feature with the original Host scheduler', async () => {
    const scheduler = createManualScheduler()
    let receivedScheduler: IScheduler | undefined
    const feature = defineMemoryFeature(({ featureExpose }) => {
      receivedScheduler = featureExpose.getScheduler()
      return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
    })
    await using host = await createStorageHost({ scheduler })
    await host.use(memoryBackendPlugin({ features: { feature } }))
    expect(receivedScheduler).toBeDefined()
    let scheduled = false
    receivedScheduler!.schedule(() => {
      scheduled = true
    }, 5)
    scheduler.advance(5)
    expect(scheduled).toBe(true)
  })
})
