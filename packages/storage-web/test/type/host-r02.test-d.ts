import { createStorageHost, definePlugin, type IStoragePluginCore } from '../../src/host/index.js'
import { defineReactiveAdapterFeature } from '../../src/reactive-adapter.js'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()

/** Built-in plugin retains the memory factory's record and synchronous-store surface. */
const builtInHost = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'cache' })] as const
})
const builtInMemory = builtInHost.backend('cache')
void builtInMemory.getRecord
void builtInMemory.sync.clearValues()

/** Exact literal plugin ID must contribute one static backend key. */
const exactPlugin = definePlugin('exact', (core) => ({
  install: () => {
    core.registerStore({} as IKeyValueStore)
    return {}
  }
}))
const exactHost = await createStorageHost({ plugins: [exactPlugin] as const })
exactHost.backend('exact')

/** Union plugin IDs are runtime-only and must not widen static backend authority. */
declare const unionId: 'present' | 'absent'
const unionReactive = defineReactiveAdapterFeature<IKeyValueStore>({
  mode: 'push',
  visibility: 'instance',
  subscribe: () => () => undefined
})
const unionPlugin = definePlugin(
  unionId,
  (core) => ({
    install: () => {
      core.registerStore({} as IKeyValueStore)
      return {}
    }
  }),
  { reactive: unionReactive }
)
const unionHost = await createStorageHost({ plugins: [unionPlugin] as const })
// @ts-expect-error union IDs cannot contribute absent static backend authority
unionHost.backend('absent')
// @ts-expect-error union IDs cannot contribute absent reactive capability authority
unionHost.liveQuery({ backendId: 'absent', runtime, query: () => undefined })
const backendBoundHandle = unionHost.reactiveBackend('present')
backendBoundHandle?.liveQuery({ runtime, query: ({ store }) => store })

/** Widened string IDs must not contribute any static backend or reactive authority. */
declare const wideId: string
const widePlugin = definePlugin(
  wideId,
  (core) => ({
    install: () => {
      core.registerStore({} as IKeyValueStore)
      return {}
    }
  }),
  { reactive: unionReactive }
)
const wideHost = await createStorageHost({ plugins: [widePlugin] as const })
// @ts-expect-error widened IDs cannot contribute static backend authority
wideHost.backend('anything')
// @ts-expect-error widened IDs cannot contribute reactive capability authority
wideHost.liveQuery({ backendId: 'anything', runtime, query: () => undefined })

type ICustomStore = IKeyValueStore & { readonly custom: () => void }
const customReactive = defineReactiveAdapterFeature<ICustomStore>({
  mode: 'push',
  visibility: 'instance',
  subscribe: ({ store }) => {
    store.custom()
    return () => undefined
  }
})
type ICustomReactiveFeatures = { readonly reactive: typeof customReactive }
definePlugin(
  'custom-store',
  (core: IStoragePluginCore<ICustomStore, ICustomReactiveFeatures>) => ({
    install: () => {
      core.registerStore({} as ICustomStore)
      return {}
    }
  }),
  { reactive: customReactive }
)
definePlugin(
  'incompatible-store',
  (core: IStoragePluginCore<IKeyValueStore, ICustomReactiveFeatures>) => ({
    install: () => {
      core.registerStore({} as IKeyValueStore)
      return {}
    }
  }),
  // @ts-expect-error a base Store core cannot satisfy a Feature requiring ICustomStore.
  { reactive: customReactive }
)
