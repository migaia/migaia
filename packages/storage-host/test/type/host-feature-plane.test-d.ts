import {
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../../src/index.js'
import type { ICapabilityInstallPort, IKeyValueStore } from '@migaia/storage-contract'

/** The backend kind and installer retain this native surface without lifecycle authority. */
type IExactStore = IKeyValueStore & { readonly custom: <TValue>(value: TValue) => TValue }
declare const exactStore: IExactStore
declare const installer: ICapabilityInstallPort
const exactKind = defineStorageBackendKind<IExactStore, undefined>()('exact')

/** Feature factories receive only reserved exposure and their declared dependencies. */
const reservedFeature = defineFeature(exactKind, (core, dependencies) => {
  // @ts-expect-error cross-plugin capabilities arrive through declared Feature dependencies.
  void core.features
  // @ts-expect-error Store transfer belongs to Plugin install, not Feature factories.
  void core.registerStore
  // @ts-expect-error resource ownership belongs to Plugin install, not Feature factories.
  void core.onDispose
  // @ts-expect-error undeclared dependencies do not confer capability authority.
  void dependencies.missing
  const store: IExactStore = core.featureExpose.getStore()
  void store
  return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
})
void reservedFeature

/** Kind identity and the admitted installer carry the exact backend through public installation. */
const exactDescriptor = (core: IStoragePluginCore) => ({
  kind: exactKind,
  featureExpose: () => ({ getClient: () => undefined }),
  capabilityInstaller: (_store: IExactStore) => installer,
  install: () => {
    core.registerStore(exactStore)
    return { echo: <TValue>(value: TValue): TValue => exactStore.custom(value) }
  },
  expose: () => ({ installed: () => true })
})
const exactPlugin = definePlugin('exact', exactDescriptor)
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
// @ts-expect-error unknown extension keys do not appear through a merger index signature.
void exactHost.extensions.missing
// @ts-expect-error Store-only methods do not become Host extensions.
exactHost.extensions.custom('literal')
// @ts-expect-error Extension methods do not become Store methods.
exactHost.backend('exact').installed()

/** A descriptor without a typed installer retains the base admission contract. */
const baseKind = defineStorageBackendKind()('base')
const basePlugin = definePlugin('base', (core: IStoragePluginCore) => ({
  kind: baseKind,
  featureExpose: () => ({ getClient: () => undefined }),
  install: () => {
    core.registerStore(exactStore)
    return {}
  }
}))
const baseHost = await createStorageHost({ plugins: [basePlugin] as const })
// @ts-expect-error Store transfer alone cannot manufacture a custom static backend surface.
baseHost.backend('base').custom('literal')
