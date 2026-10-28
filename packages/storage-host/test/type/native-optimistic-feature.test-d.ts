import {
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../../src/index.ts'
import { ConcurrencyPolicy } from '../../src/authoring/concurrency.ts'
import {
  rdf,
  type IStorageStore,
  type ITransactionRdfApi,
  type IOptimisticTransactionBuilder,
  type ICapabilityInstallPort
} from '@migaia/storage-contract'

/** The native RDF-only scope has no KV methods or key-lock surface to manufacture. */
type INativeScope = {
  use(capability: typeof rdf): ITransactionRdfApi
  nativeOnly(): 'native'
}
/** Native augmentation and scope are retained independently of selected Feature methods. */
type INativeStore = IStorageStore<typeof rdf> & {
  transaction<R>(run: (scope: INativeScope) => R): Promise<Awaited<R>>
  tx(): IOptimisticTransactionBuilder<INativeScope, { nativeBuilder(): 'native-builder' }>
}
declare const nativeStore: INativeStore
declare const installer: ICapabilityInstallPort
const nativeKind = defineStorageBackendKind<
  INativeStore,
  undefined,
  { getTransactionClient(scope: INativeScope): undefined }
>()('native-rdf')
const feature = defineFeature(nativeKind, () => ({
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
    },
    tx: {
      mark<T>(this: T): T {
        return this
      }
    }
  },
  api: {
    store: {},
    transaction: {
      async scopeName() {
        return this.scope.nativeOnly()
      }
    }
  }
}))
const plugin = definePlugin(
  'native-rdf',
  (core: IStoragePluginCore) => ({
    kind: nativeKind,
    featureExpose: () => ({
      getClient: () => undefined,
      getTransactionClient: (_scope: INativeScope) => undefined
    }),
    capabilityInstaller: (_store: INativeStore) => installer,
    install: () => {
      core.registerStore(nativeStore)
      return {}
    }
  }),
  { feature }
)
const host = await createStorageHost({ plugins: [plugin] })
const builder = host.backend('native-rdf').tx().mark()
const nativeLiteral: 'native-builder' = builder.nativeBuilder()
void nativeLiteral
await builder
  .concurrency(ConcurrencyPolicy.optimistic())
  .timeout(100)
  .run(async (scope) => {
    const native: 'native' = scope.nativeOnly()
    const featureLiteral: 'native' = await scope.api.scopeName()
    const queryLiteral: 'rdf' = scope.use(rdf).match({}).rdfOnly()
    void native
    void featureLiteral
    void queryLiteral
    // @ts-expect-error the native RDF-only scope has no KV read authority.
    scope.get('key')
    // @ts-expect-error record augmentation cannot appear on RDF query chains.
    scope.use(rdf).match({}).recordOnly()
  })
// @ts-expect-error selected Features cannot add native key locking.
builder.lock()
// @ts-expect-error native optimistic admission does not accept a pessimistic policy.
builder.concurrency(ConcurrencyPolicy.fail())
