import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'
import { createBackendChangeController } from '../../src/core/change-controller.js'
import {
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  memoryBackendPlugin,
  type IStoragePluginCore
} from '../../src/index.js'
import type { ICapabilityInstallPort, IKeyValueStore } from '@migaia/storage-contract'

/** Built-in installation retains memory's record and synchronous native surface. */
const builtInHost = await createStorageHost({
  plugins: [
    memoryBackendPlugin(
      { id: 'cache' },
      {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      }
    )
  ] as const
})
const builtInMemory = builtInHost.backend('cache')
void builtInMemory.getRecord
void builtInMemory.sync.clearValues()

/** Exact literal IDs contribute one backend key; runtime unions and wide IDs contribute none. */
const kind = defineStorageBackendKind()('native')
declare const store: IKeyValueStore
const descriptor = (core: IStoragePluginCore) => ({
  kind,
  featureExpose: () => ({ getClient: () => undefined }),
  install: () => {
    core.registerStore(store)
    return {}
  }
})
const exactPlugin = definePlugin('exact', descriptor)
const exactHost = await createStorageHost({ plugins: [exactPlugin] as const })
exactHost.backend('exact')

declare const unionId: 'present' | 'absent'
const unionPlugin = definePlugin(unionId, descriptor)
const unionHost = await createStorageHost({ plugins: [unionPlugin] as const })
// @ts-expect-error union IDs cannot contribute absent static backend authority.
unionHost.backend('absent')
// @ts-expect-error neither union member is a statically installed singleton.
unionHost.backend('present')

declare const wideId: string
const widePlugin = definePlugin(wideId, descriptor)
const wideHost = await createStorageHost({ plugins: [widePlugin] as const })
// @ts-expect-error widened IDs cannot contribute a guessed static backend key.
wideHost.backend('anything')

/** Exact kind targets replace the retired Plugin-core Store type parameter. */
type ICustomStore = IKeyValueStore & { readonly custom: () => void }
declare const customStore: ICustomStore
declare const installer: ICapabilityInstallPort
const customKind = defineStorageBackendKind<ICustomStore, undefined>()('custom')
const customFeature = defineFeature(customKind, (core) => {
  core.featureExpose.getStore().custom()
  return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
})
const customDescriptor = (core: IStoragePluginCore) => ({
  kind: customKind,
  featureExpose: () => ({ getClient: () => undefined }),
  capabilityInstaller: (_store: ICustomStore) => installer,
  install: () => {
    core.registerStore(customStore)
    return {}
  }
})
definePlugin('custom-store', customDescriptor, { customFeature })
definePlugin<
  'incompatible-store',
  typeof descriptor,
  { readonly customFeature: typeof customFeature }
>(
  'incompatible-store',
  descriptor,
  // @ts-expect-error a base Store kind cannot satisfy a Feature requiring ICustomStore.
  { customFeature }
)

/** Only the original backend installation can capture late physical-child construction authority. */
declare const authorCore: IStoragePluginCore
const childAuthoring = authorCore.createOrgAuthoringPort()
childAuthoring.createChangeController({ backend: 'native' }, createBackendChangeController)
childAuthoring.createKeyLockPort()
// @ts-expect-error organization authoring grants no capability provider or installer.
childAuthoring.registerStore(store)
// @ts-expect-error business organization views cannot construct physical children.
builtInHost.org('00000000-0000-0000-0000-000000000001').createOrgAuthoringPort()
