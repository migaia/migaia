import { describe, expect, it, vi } from 'vitest'
import { openComposition } from '../src/composition-entry.js'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'
import { execution, createRequiredPair, SyncHost } from './dependency-lifecycle-fixtures.js'

describe('enablement prerequisites', () => {
  it('rejects enabling a dependent while its required provider stays disabled', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    await host.use(provider, consumer)
    await host.plugin.disable('A', { policy: 'cascade' })
    await expect(host.plugin.enable('B')).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteDisabled
    })
    expect(host.plugin.disabled()).toEqual(expect.arrayContaining(['A', 'B']))
  })
})

describe('dependency validation codes', () => {
  it('throws the dependency code itself rather than an install wrapper', async () => {
    const missing = createRequiredPair()
    await expect(
      new PluginHost<Record<string, never>>({ execution }).use(missing.consumer)
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteMissing
    })

    const disabled = createRequiredPair()
    const disabledHost = new PluginHost<Record<string, never>>({ execution })
    await disabledHost.use(disabled.provider)
    await disabledHost.plugin.disable('A')
    await expect(disabledHost.use(disabled.consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteDisabled
    })

    const removed = createRequiredPair()
    const removedHost = new PluginHost<Record<string, never>>({ execution })
    await removedHost.use(removed.provider)
    await removedHost.unUse('A')
    await expect(removedHost.use(removed.consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteRemoved
    })
    await removedHost.use(removed.provider)
    await expect(removedHost.use(removed.consumer)).resolves.toHaveLength(1)
  })

  it('names the missing Feature in the prerequisite message', async () => {
    const { consumer } = createRequiredPair()
    await expect(
      new PluginHost<Record<string, never>>({ execution }).use(consumer)
    ).rejects.toThrow(/value/)
  })
})

describe('post-install graph stays acyclic', () => {
  it('rejects a member that closes a cycle through a committed optional edge', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const bValue = defineFeature(() => ({ b: true }))
    const bSeed = definePlugin({ name: 'B', features: { value: bValue }, install: () => ({}) })
    const a = definePlugin({
      name: 'A',
      features: {
        value: defineFeature(() => ({ a: true }), {
          b: bSeed.getFeature('value', { optional: true })
        })
      },
      install: () => ({})
    })
    await host.use(a)
    const b = definePlugin({
      name: 'B',
      features: { value: defineFeature(() => ({ b: true }), { a: a.getFeature('value') }) },
      install: () => ({})
    })
    await expect(host.use(b)).rejects.toMatchObject({ code: PluginHostErrorCode.dependencyCycle })
    await expect(host.dispose()).resolves.toBeDefined()
  })

  it('rejects a replacement that closes a cycle and keeps the previous provider serving', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    const [providerHandle] = await host.use(provider, consumer)
    const cyclic = definePlugin({
      name: 'A',
      features: {
        value: defineFeature(() => ({ value: 2 }), { use: consumer.getFeature('use') })
      },
      install: () => ({ readA: () => 'A2' })
    })
    await expect(host.replace('A', cyclic)).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyCycle
    })
    expect(providerHandle.extensions.readA()).toBe('A')
  })
})

describe('dependency plans', () => {
  it('lists every transitive required dependent as blockers', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    const leaf = definePlugin({
      name: 'C',
      features: {
        leaf: defineFeature(() => ({ leaf: true }), { use: consumer.getFeature('use') })
      },
      install: () => ({})
    })
    await host.use(provider, consumer, leaf)
    await expect(host.unUse('A')).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyBlocked,
      detail: { blockedBy: ['C', 'B'] }
    })
    await expect(host.plugin.disable('A')).rejects.toMatchObject({
      detail: { blockedBy: ['C', 'B'] }
    })
  })

  it('labels optional edges and absent optional providers', async () => {
    const value = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
    const consumer = definePlugin({
      name: 'B',
      features: {
        use: defineFeature(
          (_core, dependencies) => ({ present: dependencies.value !== undefined }),
          {
            value: provider.getFeature('value', { optional: true })
          }
        )
      },
      install: () => ({})
    })
    const present = new PluginHost<Record<string, never>>({ execution })
    await present.use(provider, consumer)
    expect((await present.unUse('A', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true }
    ])
    const absent = new PluginHost<Record<string, never>>({ execution })
    await absent.use(consumer)
    expect((await absent.unUse('B', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true, status: 'optional-absent' }
    ])
  })
})

describe('managed removal respects dependency edges', () => {
  it('rejects a managed removal that leaves a required dependent behind', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const composition = openComposition(host)
    const { provider, consumer } = createRequiredPair()
    const prepared = await composition.prepareAdmissions([
      {
        admission: composition.createPluginAdmission(provider as never),
        slot: composition.createDataOrderSlot('A')
      },
      {
        admission: composition.createPluginAdmission(consumer as never),
        slot: composition.createDataOrderSlot('B')
      }
    ])
    const [providerReceipt, consumerReceipt] = composition.commitPreparedAdmissions(prepared)
    expect(() => composition.prepareUnUseBatch([providerReceipt!])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.dependencyBlocked })
    )
    const removal = await composition.commitPreparedUnUseBatch(
      composition.prepareUnUseBatch([providerReceipt!, consumerReceipt!]),
      { beforeCleanup: Promise.resolve() }
    )
    expect(removal.leaves.map((leaf) => leaf.name)).toEqual(['B', 'A'])
  })
})

describe('lazy activation boundaries', () => {
  it('does not activate a lazy provider when dependency validation fails', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const install = vi.fn(() => ({}))
    const value = defineFeature(() => ({ value: 1 }))
    const lazy = definePlugin({ name: 'L', activation: 'lazy', features: { value }, install })
    const absent = definePlugin({ name: 'X', features: { value }, install: () => ({}) })
    await host.use(lazy)
    const consumer = definePlugin({
      name: 'M',
      features: {
        use: defineFeature(() => ({ ok: true }), {
          lazy: lazy.getFeature('value'),
          absent: absent.getFeature('value')
        })
      },
      install: () => ({})
    })
    await expect(host.use(consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteMissing
    })
    expect(install).not.toHaveBeenCalled()
  })

  it('keeps lazy consumers lazy and activates lazy providers before explicit activation', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const order: string[] = []
    const value = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({
      name: 'L2',
      activation: 'lazy',
      features: { value },
      install: () => {
        order.push('L2')
        return {}
      }
    })
    const consumer = definePlugin({
      name: 'L1',
      activation: 'lazy',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: provider.getFeature('value')
        })
      },
      install: () => {
        order.push('L1')
        return {}
      }
    })
    await host.use(provider)
    await host.use(consumer)
    expect(order).toEqual([])
    await host.activate('L1')
    expect(order).toEqual(['L2', 'L1'])
  })

  it('keeps lazy batch members inactive when only lazy members require them', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider } = createRequiredPair({ lazyProvider: true })
    const lazyConsumer = definePlugin({
      name: 'B',
      activation: 'lazy',
      features: {
        use: defineFeature(() => ({ ok: true }), { value: provider.getFeature('value') })
      },
      install: () => ({})
    })
    const [providerHandle] = await host.use(provider, lazyConsumer)
    expect(() => providerHandle.extensions).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotActivated })
    )
  })

  it('reports an inactive committed lazy provider on the synchronous path', async () => {
    const host = new SyncHost({ execution })
    const { provider, consumer } = createRequiredPair({ lazyProvider: true })
    await host.use(provider)
    expect(() => host.installNow([consumer])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotActivated })
    )
  })
})
