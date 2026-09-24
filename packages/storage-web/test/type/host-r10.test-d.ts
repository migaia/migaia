import {
  createStorageHost,
  defineFeature,
  definePlugin,
  type IStoragePluginCore
} from '../../src/host/index.js'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { createRuntime } from '@migaia/reactive'
import type { IKeyValueStore } from '@migaia/storage-contract'

const runtime = createRuntime()

/** Feature factories receive only the reserved exposure plane, never Plugin lifecycle authority. */
const reservedFeature = defineFeature((core) => {
  // @ts-expect-error cross-plugin capabilities arrive through declared Feature dependencies.
  void core.features
  // @ts-expect-error Store transfer belongs to Plugin install, not Feature factories.
  void core.registerStore
  // @ts-expect-error resource ownership belongs to Plugin install, not Feature factories.
  void core.onDispose
  return { readStore: () => core.featureExpose.getStore() }
})
void reservedFeature

/** Explicit Plugin-core annotation, not registerStore's callback body, carries an exact Store. */
type IExactStore = IKeyValueStore & { readonly custom: <TValue>(value: TValue) => TValue }
declare const exactStore: IExactStore
const exactPlugin = definePlugin('exact', (core: IStoragePluginCore<IExactStore>) => ({
  install: () => {
    core.registerStore(exactStore)
    return { echo: <TValue>(value: TValue): TValue => exactStore.custom(value) }
  },
  expose: () => ({ installed: () => true })
}))
const exactHost = await createStorageHost({ plugins: [exactPlugin] as const })
const exactBackend: IExactStore = exactHost.backend('exact')
const literalEcho: 'literal' = exactHost.extensions.echo('literal')
type IExactExtensionKeysStayLiteral = string extends keyof typeof exactHost.extensions
  ? false
  : true
const exactExtensionKeysStayLiteral: IExactExtensionKeysStayLiteral = true
void exactBackend
void literalEcho
void exactExtensionKeysStayLiteral
// @ts-expect-error unknown extension keys must not appear through a merger index signature.
void exactHost.extensions.missing
// @ts-expect-error Store-only methods do not become Host extensions.
exactHost.extensions.custom('literal')
// @ts-expect-error Extension methods do not become Store methods.
exactHost.backend('exact').installed()
const basePlugin = definePlugin('base', (core) => ({
  install: () => {
    core.registerStore(exactStore)
    return {}
  }
}))
const baseHost = await createStorageHost({ plugins: [basePlugin] as const })
// @ts-expect-error unannotated callbacks retain the base Store contract.
baseHost.backend('base').custom('literal')

/** Exact reactive plugin IDs add one backend-specific live-query authority. */
const host = await createStorageHost({
  plugins: [memoryReactive({ id: 'reactive' })] as const
})
void host.backend('reactive').get
const boundQuery = host.reactiveBackend('reactive')?.liveQuery({
  runtime,
  query: ({ store }) => store
})
const rootQuery = host.liveQuery({ backendId: 'reactive', runtime, query: ({ store }) => store })
// @ts-expect-error the live-query state projection is read-only
rootQuery.state.value = host.backend('reactive')
if (boundQuery !== undefined) {
  // @ts-expect-error the backend-bound state projection is read-only
  boundQuery.state.value = host.backend('reactive')
}

/** Widened IDs do not manufacture static capability authority. */
declare const widenedId: string
const widenedHost = await createStorageHost({
  plugins: [memoryReactive({ id: widenedId })] as const
})
// @ts-expect-error widened IDs must not expose a guessed backend key
widenedHost.backend('unknown')
// @ts-expect-error widened IDs must not expose a guessed reactive key
widenedHost.liveQuery({ backendId: 'unknown', runtime, query: () => undefined })
