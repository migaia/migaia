import { expect, it } from 'vitest'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { implement, kv, type IStorageBase, type IStorageChange } from '@migaia/storage-contract'
import { provideCapabilities } from '@migaia/storage-host/sdk'
import { cachePlugin } from '../src/index.js'

/**
 * A third-party lower tier whose plain change feed can send an unscoped reset. Text calls go to a
 * private memory store; the listener set lets the test emit the reset itself.
 */
async function resettableTier() {
  const inner = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'inner' })] })
  const store = inner.backend('inner')
  const listeners = new Set<(change: IStorageChange) => void>()
  const kind = defineStorageBackendKind<IStorageBase, undefined>()('resettable')
  const plugin = definePlugin('resettable', (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => undefined }),
    install() {
      /** One provided store per organization, each over that organization's private memory store. */
      const provide = (orgStore: { use: typeof store.use }) =>
        provideCapabilities(
          {
            backend: 'resettable',
            capabilities: {
              syncRead: false,
              binary: false,
              records: false,
              transactions: false,
              iteration: false,
              secondaryIndexes: false,
              changeFeed: true,
              maxValueBytes: undefined,
              opaqueEntries: false
            },
            subscribeChanges: (listener: (change: IStorageChange) => void) => {
              listeners.add(listener)
              return () => listeners.delete(listener)
            },
            dispose: async () => {},
            [Symbol.asyncDispose]: async () => {}
          },
          [implement(kv, orgStore.use(kv))] as const
        ) as never
      const root = provide(store)
      core.registerStore(root)
      core.registerOrgBinding(root, {
        backend: (orgId: string) => provide(inner.org(orgId).backend('inner') as never),
        drop: async () => {}
      } as never)
      return {}
    }
  }))
  return {
    inner,
    store,
    plugin,
    emit: (change: IStorageChange) => listeners.forEach((l) => l(change))
  }
}

it('invalidates every organization when a plain change feed sends an unscoped reset', async () => {
  const tier = await resettableTier()
  const base = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'fast' }), tier.plugin]
  })
  const host = await base.use(
    cachePlugin({ tiers: [{ backend: 'fast', ttlMs: 10000 }, { backend: 'resettable' }] })
  )
  await host.detect()
  try {
    const orgId = crypto.randomUUID()
    const root = host.backend('cache'),
      org = host.org(orgId).backend('cache'),
      fast = base.backend('fast'),
      orgFast = base.org(orgId).backend('fast')
    await root.set('a', 'root')
    await org.set('a', 'org')
    expect(await root.get('a')).toBe('root')
    expect(await org.get('a')).toBe('org')
    expect(await fast.get('cache:cache:a')).not.toBeNull()
    expect(await orgFast.get('cache:cache:a')).not.toBeNull()
    tier.emit({
      sequence: 1,
      origin: 'third-party',
      channel: 'all',
      kind: 'reset'
    } as IStorageChange)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await fast.get('cache:cache:a')).toBeNull()
    expect(await orgFast.get('cache:cache:a')).toBeNull()
  } finally {
    await host.dispose()
    await tier.inner.dispose()
  }
})
