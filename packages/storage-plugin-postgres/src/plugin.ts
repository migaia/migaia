import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import type { ICapabilityInstallPort } from '@migaia/storage-contract'
import { createPostgresStore, type IPostgresConstruction } from './store.ts'
import type {
  IPostgresStore,
  IPgDriver,
  IPostgresTransactionScope,
  IPostgresOptions,
  IPgServer,
  IPgConnection,
  IPgNativeOperation
} from './types.ts'
import { PgNames } from './constants.ts'
import type { IPgQuantizedOptions } from './features/quantized.ts'
import type { IPgReplicationSelection } from './logical-replication.ts'
/** Exact backend identity gates each selected Feature before any native client can be borrowed. */
export const postgresBackendKind = defineStorageBackendKind<
  IPostgresStore<IPgServer>,
  IPgDriver,
  {
    getTransactionClient(scope: IPostgresTransactionScope): IPgConnection
    readonly runNative: IPgNativeOperation
    selectVector(): void
    selectQuantized(mode: IPgQuantizedOptions['mode']): void
    selectReplication(options: IPgReplicationSelection): void
    getReplicationRoute(): import('./types.ts').IPgLogicalReplicationRoute
    getServer(): IPgServer
    createDurableApi(): import('@migaia/storage-contract').IDurableChangeFeedApi
    reportReplication(facts: import('./types.ts').IPgReplicationHealth): void
    assertNativeRoot(value: object): void
    createVectorApi(): import('@migaia/storage-contract').IVectorApi<true>
  }
>()(PgNames.backend)
/** Caller options are read once because installation may begin after the plugin is defined. */
type IPgPluginOptions<TServer extends IPgServer> = Pick<
  IPostgresOptions<TServer>,
  'driver' | 'server' | 'schema' | 'prefix' | 'concurrency' | 'owner' | 'maxLockMs'
>
/** One installation owns selected features and the resulting native construction. */
class PgBackendInstallation<TValue, TServer extends IPgServer, F extends IStorageFeatureRecord> {
  /** Deferred native installation uses the original captured deployment options. */
  readonly #options: IPgPluginOptions<TServer>
  /** Original installation authority registers the store, resources and native ports. */
  readonly #core: IStoragePluginCore<F>
  /** Feature callbacks become usable only after the original native construction completes. */
  #construction!: IPostgresConstruction<TValue>
  /** Vector selection belongs to this installation and every organization it creates. */
  #vectorSelected = false
  /** One selected native quantization mode applies to the shared layout. */
  #quantized: IPgQuantizedOptions['mode'] | undefined
  /** The selected replication feature owns one installation's native feed resources. */
  #replication: IPgReplicationSelection | undefined
  /** Separate feature selection state from the public plugin descriptor. */
  constructor(options: IPgPluginOptions<TServer>, core: IStoragePluginCore<F>) {
    this.#options = options
    this.#core = core
  }
  /** Return own descriptor ports because plugin projection captures own properties. */
  open() {
    return {
      kind: postgresBackendKind,
      install: async () => {
        this.#construction = await createPostgresStore<TValue>(
          this.#options,
          this.#core,
          () => this.#vectorSelected,
          () => this.#replication,
          () => this.#quantized
        )
        this.#core.registerStore(this.#construction.store)
        this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
        this.#core.registerOrgBinding(this.#construction.store, this.#construction.orgBinding)
        this.#core.registerDetect(async (signal) => {
          if (signal.aborted) return
          await this.#options.driver.query('SELECT 1', [], { signal })
        })
        return {}
      },
      journalBinding: () => this.#construction.journalBinding,
      capabilityInstaller: (_store: IPostgresStore<TServer, TValue>): ICapabilityInstallPort =>
        this.#construction.installer,
      featureExpose: () => ({
        getClient: () => this.#options.driver,
        getTransactionClient: (scope: IPostgresTransactionScope) =>
          this.#construction.getTransactionClient(scope),
        runNative: ((...args) =>
          this.#construction.runNative(...args)) satisfies IPgNativeOperation,
        selectVector: () => {
          this.#vectorSelected = true
        },
        selectQuantized: (mode: IPgQuantizedOptions['mode']) => {
          this.#quantized = mode
        },
        selectReplication: (options: IPgReplicationSelection) => {
          this.#replication = options
        },
        getServer: () => this.#construction.configuration.server,
        getReplicationRoute: () => ({
          schema: this.#construction.configuration.schema,
          prefix: this.#construction.configuration.prefix
        }),
        createDurableApi: () => this.#construction.createDurableApi(),
        reportReplication: (facts: import('./types.ts').IPgReplicationHealth) =>
          this.#construction.reportReplication(facts),
        assertNativeRoot: (value: object) => this.#construction.assertNativeRoot(value),
        createVectorApi: () => this.#construction.createVectorApi()
      })
    }
  }
}
/** Definition is pure; installation alone probes the real server and initializes native tables. */
export function postgresBackendPlugin<
  TValue = unknown,
  const TServer extends IPgServer = 'postgres',
  const TId extends string = 'postgres',
  const F extends IStorageFeatureRecord = {}
>(
  options: IPostgresOptions<TServer> & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<
      typeof postgresBackendKind,
      NoInfer<F>,
      IPostgresStore<NoInfer<TServer>, TValue>
    >
): IStorageBackendPlugin<
  typeof postgresBackendKind,
  NoInfer<TId>,
  F,
  IPostgresStore<NoInfer<TServer>, TValue>
> {
  const captured = {
    driver: options.driver,
    server: options.server,
    schema: options.schema,
    prefix: options.prefix,
    concurrency: options.concurrency,
    owner: options.owner,
    maxLockMs: options.maxLockMs
  }
  const id = (options.id ?? PgNames.backend) as TId
  const factory = (core: IStoragePluginCore<F>) =>
    new PgBackendInstallation<TValue, TServer, F>(captured, core).open()
  return definePlugin<TId, typeof factory, F>(id, factory, features) as IStorageBackendPlugin<
    typeof postgresBackendKind,
    NoInfer<TId>,
    F,
    IPostgresStore<NoInfer<TServer>, TValue>
  >
}
