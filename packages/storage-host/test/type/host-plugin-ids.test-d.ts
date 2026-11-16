import { memoryNotificationsFeature } from '../../src/features/memory-notifications.ts'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.ts'
import { createBackendChangeController } from '../../src/core/change-controller.ts'
import {
  createStorageHost,
  type IStoragePluginCore,
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageBackendPluginDefiner
} from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import type { ICapabilityInstallPort, IKeyValueStore } from '@migaia/storage-contract'
import { defineStorageFeature, defineBackendPlugin } from '../../src/sdk.ts'
import { type IStorageBase } from '@migaia/storage-contract'

/** Built-in installation retains memory's record and synchronous native surface. */
const builtInHost = await createStorageHost({
  plugins: [
    memoryBackendPlugin({
      name: 'cache',
      features: {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      }
    })
  ] as const
})
const builtInMemory = builtInHost.backend('cache')
void builtInMemory.getRecord
void builtInMemory.sync.clearValues()

/** Exact literal IDs contribute one backend key; runtime unions and wide IDs contribute none. */
type IKindBackend = IStorageBackendType<IStorageBase, undefined>
/** Backend-plugin definer typed for this test backend. */
const defineKindBackend: IStorageBackendPluginDefiner<IKindBackend> = defineBackendPlugin
declare const store: IKeyValueStore
const descriptor = (core: IStoragePluginCore) => ({
  featureExpose: () => ({ getClient: () => undefined }),
  install: () => {
    core.registerStore(store)
    return {}
  }
})
const exactPlugin = defineKindBackend({ name: 'exact', open: descriptor })
const exactHost = await createStorageHost({ plugins: [exactPlugin] as const })
exactHost.backend('exact')

declare const unionId: 'present' | 'absent'
const unionPlugin = defineKindBackend({ name: unionId, open: descriptor })
const unionHost = await createStorageHost({ plugins: [unionPlugin] as const })
// @ts-expect-error union IDs cannot contribute absent static backend authority.
unionHost.backend('absent')
// @ts-expect-error neither union member is a statically installed singleton.
unionHost.backend('present')

declare const wideId: string
const widePlugin = defineKindBackend({ name: wideId, open: descriptor })
const wideHost = await createStorageHost({ plugins: [widePlugin] as const })
// @ts-expect-error widened IDs cannot contribute a guessed static backend key.
wideHost.backend('anything')

/** Exact kind targets replace the retired Plugin-core Store type parameter. */
type ICustomStore = IKeyValueStore & { readonly custom: () => void }
declare const customStore: ICustomStore
declare const installer: ICapabilityInstallPort
type ICustomKindBackend = IStorageBackendType<ICustomStore, undefined>
/** Backend-plugin definer typed for this test backend. */
const defineCustomKindBackend: IStorageBackendPluginDefiner<ICustomKindBackend> =
  defineBackendPlugin
/** Feature definer typed for this test backend. */
const defineCustomKindFeature: IStorageFeatureDefiner<ICustomKindBackend> = defineStorageFeature
const customFeature = defineCustomKindFeature((core) => {
  core.featureExpose.getStore().custom()
  return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
})
const customDescriptor = (core: IStoragePluginCore) => ({
  featureExpose: () => ({ getClient: () => undefined }),
  capabilityInstaller: (_store: ICustomStore) => installer,
  install: () => {
    core.registerStore(customStore)
    return {}
  }
})
defineCustomKindBackend({
  name: 'custom-store',
  features: { customFeature },
  open: customDescriptor
})
defineKindBackend({
  name: 'incompatible-store',
  // @ts-expect-error a base Store cannot satisfy a Feature requiring ICustomStore.
  features: { customFeature },
  open: descriptor
})

/** Only the original backend installation can capture late physical-child construction authority. */
declare const authorCore: IStoragePluginCore
const childAuthoring = authorCore.createOrgAuthoringPort()
childAuthoring.createChangeController({ backend: 'native' }, createBackendChangeController)
childAuthoring.createKeyLockPort()
// @ts-expect-error organization authoring grants no capability provider or installer.
childAuthoring.registerStore(store)
// @ts-expect-error business organization views cannot construct physical children.
builtInHost.org('00000000-0000-0000-0000-000000000001').createOrgAuthoringPort()
