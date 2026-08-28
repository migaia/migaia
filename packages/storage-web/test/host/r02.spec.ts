import { describe, expect, it } from 'vitest'
import {
  STORAGE_LIVE_QUERY_SERVICE_NAME,
  compileStorageFeatureTopology,
  createStorageHost,
  defineStorageBackendFeature,
  defineStorageBackendKind,
  defineStorageBackendPlugin,
  pluginNameFromBackendId,
  reactiveAdapterNameFromBackendId
} from '../../src/host/index.js'
import { memoryStorage } from '../../src/backends/memory.js'
import type { IKeyValueStore } from '@migaia/storage-contract'

/** Minimal valid store used only to exercise opaque type identity and R02 admission. */
const store = memoryStorage() as IKeyValueStore

describe('SWV4-B02 R02 shell', () => {
  it('keeps names canonical and topology output filters synthetic providers', () => {
    expect(pluginNameFromBackendId('a.b')).toBe('storage-backend:612E62')
    expect(reactiveAdapterNameFromBackendId('a-b')).toBe('storage-reactive-adapter:612D62')
    expect(STORAGE_LIVE_QUERY_SERVICE_NAME).toBe('storage-live-query-service')

    const kind = defineStorageBackendKind<IKeyValueStore>()('memory')
    const feature = defineStorageBackendFeature(kind, 'reactive')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'primary',
      features: [feature] as const,
      create: () => store
    })
    const compilation = compileStorageFeatureTopology({
      installedProviderIds: ['storage-live-query-service'],
      plugins: [plugin]
    })

    expect(compilation.ordered.map((node) => node.id)).toEqual([
      'storage-live-query-service',
      'primary',
      'primary:reactive'
    ])
    expect(compilation.materialized.map((node) => node.id)).toEqual(['primary', 'primary:reactive'])

    type ICustomStore = IKeyValueStore & { readonly custom: () => void }
    const customKind = defineStorageBackendKind<ICustomStore>()('custom')
    const customFeature = defineStorageBackendFeature(customKind, 'reactive')
    const customPlugin = defineStorageBackendPlugin({
      backendKind: customKind,
      id: 'custom-backend',
      features: [customFeature] as const,
      create: () => ({ ...store, custom: () => {} }) as ICustomStore
    })
    expect(customPlugin.id).toBe('custom-backend')

    const firstProviderOrder = ['z', 'a'] as const
    const secondProviderOrder = ['a', 'z'] as const
    const firstCompilation = compileStorageFeatureTopology({
      installedProviderIds: firstProviderOrder,
      plugins: []
    })
    const secondCompilation = compileStorageFeatureTopology({
      installedProviderIds: secondProviderOrder,
      plugins: []
    })
    expect(firstCompilation.ordered.map((node) => node.id)).toEqual(['a', 'z'])
    expect(secondCompilation.ordered.map((node) => node.id)).toEqual(['a', 'z'])
    expect(firstProviderOrder).toEqual(['z', 'a'])
  })

  it('rejects concurrent facade batches and allows explicit retry after settlement', async () => {
    const host = await createStorageHost()
    const kind = defineStorageBackendKind<IKeyValueStore>()('memory')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'one',
      create: () => store
    })
    const retryPlugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'two',
      create: () => store
    })
    const first = host.use(plugin)
    expect(() => host.use(plugin)).toThrowError('storage host is busy installing plugins')
    await first
    await host.use(retryPlugin)
    await host.dispose()
  })

  it('rejects a use batch when disposal wins before preflight', async () => {
    const host = await createStorageHost()
    const kind = defineStorageBackendKind<IKeyValueStore>()('memory')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'late',
      create: () => store
    })
    const installing = host.use(plugin)
    const disposing = host.dispose()
    await expect(installing).rejects.toMatchObject({
      code: 'STORAGE_HOST_DISPOSED'
    })
    await disposing
    expect(host.dispose()).toBe(disposing)
  })
})
