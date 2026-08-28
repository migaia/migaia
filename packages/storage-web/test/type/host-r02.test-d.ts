import {
  createStorageHost,
  defineStorageBackendFeature,
  defineStorageBackendKind,
  defineStorageBackendPlugin
} from '../../src/host/index.js'
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
const exactKind = defineStorageBackendKind<IKeyValueStore>()('exact-kind')
const exactPlugin = defineStorageBackendPlugin({
  backendKind: exactKind,
  id: 'exact',
  create: () => ({}) as IKeyValueStore
})
const exactHost = await createStorageHost({ plugins: [exactPlugin] as const })
exactHost.backend('exact')

/** Union plugin IDs are runtime-only and must not widen static backend authority. */
declare const unionId: 'present' | 'absent'
const unionKind = defineStorageBackendKind<IKeyValueStore>()('union-kind')
const unionFeature = defineStorageBackendFeature(unionKind, 'reactive')
const unionPlugin = defineStorageBackendPlugin({
  backendKind: unionKind,
  id: unionId,
  features: [unionFeature] as const,
  create: () => ({}) as IKeyValueStore
})
const unionHost = await createStorageHost({ plugins: [unionPlugin] as const })
// @ts-expect-error union IDs cannot contribute absent static backend authority
unionHost.backend('absent')
// @ts-expect-error union IDs cannot contribute absent reactive capability authority
unionHost.liveQuery({ backendId: 'absent', runtime, query: () => undefined })
const backendBoundHandle = unionHost.reactiveBackend('present')
backendBoundHandle?.liveQuery({ runtime, query: ({ store }) => store })

/** Widened string IDs must not contribute any static backend or reactive authority. */
const wideKind = defineStorageBackendKind<IKeyValueStore>()('wide-kind')
const wideFeature = defineStorageBackendFeature(wideKind, 'reactive')
declare const wideId: string
const widePlugin = defineStorageBackendPlugin({
  backendKind: wideKind,
  id: wideId,
  features: [wideFeature] as const,
  create: () => ({}) as IKeyValueStore
})
const wideHost = await createStorageHost({ plugins: [widePlugin] as const })
// @ts-expect-error widened IDs cannot contribute static backend authority
wideHost.backend('anything')
// @ts-expect-error widened IDs cannot contribute reactive capability authority
wideHost.liveQuery({ backendId: 'anything', runtime, query: () => undefined })
