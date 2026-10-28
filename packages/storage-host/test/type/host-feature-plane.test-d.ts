import {
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../../src/index.ts'
import {
  records,
  rdf,
  type IStorageStore,
  type ITransactionScope,
  type ITransactionBuilder,
  type ICapabilityInstallPort,
  type IKeyValueStore
} from '@migaia/storage-contract'
import type { IStorageFeatureClientResolver } from '@migaia/storage-host'

/** The public erased type grants client selection without exposing a store or installer. */
const resolver: IStorageFeatureClientResolver<
  Readonly<{ orgId: string }>,
  Readonly<{ scope: object }>
> = {
  getClient: (orgId) => ({ orgId }),
  getTransactionClient: (scope) => ({ scope })
}
void resolver

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
  // @ts-expect-error native client selection belongs to the original backend installation.
  void core.registerFeatureClientResolver
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
/** A valid raw backend without a Feature API projects the actual absent value. */
const noApi: undefined = exactHost.api.exact
void noApi
// @ts-expect-error an absent API cannot manufacture a callable method.
exactHost.api.exact.custom()
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

/** Host API projection preserves each selected backend's exact names and result types. */
const apiFeature = defineFeature(exactKind, () => ({
  capabilities: [],
  chain: {},
  api: {
    store: {
      async literal(): Promise<'literal'> {
        return 'literal'
      }
    },
    transaction: {}
  }
}))
const apiPlugin = definePlugin('with-api', exactDescriptor, { apiFeature })
const apiHost = await createStorageHost({ plugins: [apiPlugin] as const })
const apiLiteral: 'literal' = await apiHost.api['with-api'].literal()
void apiLiteral
// @ts-expect-error host APIs use exact installed singleton backend ids.
void apiHost.api.missing
// @ts-expect-error a method is not flattened across backend API namespaces.
void apiHost.api.literal
// @ts-expect-error unselected method names cannot gain authority through the host projection.
void apiHost.api['with-api'].missing

/** Organization views retain selected API inference while removing root resource authority. */
const apiOrg = apiHost.org('00000000-0000-0000-0000-000000000000')
const orgLiteral: 'literal' = await apiOrg.api['with-api'].literal()
void orgLiteral
// @ts-expect-error Organization views cannot install additional plugins.
apiOrg.use(apiPlugin)
// @ts-expect-error Organization views cannot delete organizations.
apiOrg.dropOrg('00000000-0000-0000-0000-000000000000')
// @ts-expect-error Organization views cannot close the root owner.
apiOrg.dispose()
// @ts-expect-error organization views cannot register native client routing.
apiOrg.registerFeatureClientResolver(exactStore, resolver)
// @ts-expect-error Borrowed native backends retain no close ownership.
apiOrg.backend('with-api').dispose()
// @ts-expect-error Borrowed native backends retain no symbol close ownership.
apiOrg.backend('with-api')[Symbol.asyncDispose]()

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

/** The actual host projection keeps record and RDF augmentation in their own native families. */
type IFamilyScope = ITransactionScope<unknown, typeof records | typeof rdf>
/** A declaration-only backend retains the existing real transaction and builder shapes. */
type IFamilyStore = IStorageStore<typeof records | typeof rdf> & {
  transaction<R>(run: (scope: IFamilyScope) => R): Promise<Awaited<R>>
  tx(): ITransactionBuilder<IFamilyScope>
}
declare const familyStore: IFamilyStore
/** Each family carries its own literal method result, without assertions or an alternate query API. */
const familyKind = defineStorageBackendKind<
  IFamilyStore,
  undefined,
  { getTransactionClient(scope: IFamilyScope): undefined }
>()('families')
const familyFeature = defineFeature(familyKind, () => ({
  capabilities: [],
  chain: {
    query: {
      recordOnly(): 'record' {
        return 'record'
      }
    },
    rdf: {
      rdfOnly(): 'rdf' {
        return 'rdf'
      }
    }
  },
  api: { store: {}, transaction: {} }
}))
const familyPlugin = definePlugin(
  'families',
  (core: IStoragePluginCore) => ({
    kind: familyKind,
    featureExpose: () => ({
      getClient: () => undefined,
      getTransactionClient: (_scope: IFamilyScope) => undefined
    }),
    capabilityInstaller: (_store: IFamilyStore) => installer,
    install: () => {
      core.registerStore(familyStore)
      return {}
    }
  }),
  { familyFeature }
)
const familyHost = await createStorageHost({ plugins: [familyPlugin] })
await familyHost.backend('families').transaction(async (scope) => {
  const recordQuery = scope.use(records).query()
  const rdfQuery = scope.use(rdf).match({})
  const recordLiteral: 'record' = recordQuery.recordOnly()
  const rdfLiteral: 'rdf' = rdfQuery.rdfOnly()
  void recordLiteral
  void rdfLiteral
  // @ts-expect-error RDF augmentation cannot appear on the record query family.
  recordQuery.rdfOnly()
  // @ts-expect-error Record augmentation cannot appear on the RDF query family.
  rdfQuery.recordOnly()
})
